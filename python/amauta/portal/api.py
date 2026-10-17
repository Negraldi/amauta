"""Portal data layer. Every GET opens its source read-only; the only write path is `Portal.refresh`."""
from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..graph import query as graph_query
from ..memory import store as mstore
from ..telemetry import housekeeping
from ..usage import ingest
from . import archify, diagrams, wikifeature

MAX_TEXT = 200_000
DAY = re.compile(r"^\d{4}-\d\d-\d\d$")


class BadRequest(Exception):
    pass


def ro_connect(path):
    """Open read-only; None when the file does not exist. Never creates or migrates anything."""
    path = Path(path)
    if not path.is_file():
        return None
    try:
        conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=2)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON")
        return conn
    except sqlite3.Error:
        return None


def has_table(conn, name) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?", (name,)).fetchone() is not None


def columns(conn, table):
    return [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]


def _int(q, key, default, lo, hi):
    raw = q.get(key)
    if raw in (None, ""):
        return default
    try:
        v = int(raw)
    except ValueError:
        raise BadRequest(f"{key} must be an integer") from None
    if not lo <= v <= hi:
        raise BadRequest(f"{key} must be between {lo} and {hi}")
    return v


def _day(q, key):
    raw = q.get(key)
    if raw in (None, ""):
        return None
    if not DAY.match(raw):
        raise BadRequest(f"{key} must be YYYY-MM-DD")
    return raw


def _str(q, key, limit=200):
    v = q.get(key)
    return v[:limit] if v else None


class Portal:
    def __init__(self, cfg):
        self.cfg = cfg
        self._refresh_lock = threading.Lock()

    # ---- dispatch -------------------------------------------------------------------------
    def get(self, path, q):
        route = _ROUTES.get(path)
        if route is None:
            return 404, {"error": "not found"}
        try:
            return 200, getattr(self, route)(q)
        except NotFound:
            return 404, {"error": "not found"}
        except BadRequest as err:
            return 400, {"error": str(err)}
        except sqlite3.Error as err:
            return 200, {"available": False, "error": f"database unavailable: {type(err).__name__}"}
        except Exception:  # never leak details or drop the connection because of one broken view
            traceback.print_exc()  # the diagnostic stays on the server side (stderr), never in the response
            return 500, {"error": "internal error"}

    def repos(self):
        """Every repository the portal knows: --repo flags, portal.json and discovered git roots (see projects.py), deduplicated."""
        from . import projects
        return list(projects.collect(self)["repos"])

    def themes(self, q):
        from . import themes
        return themes.list_themes(self.cfg.state_dir)

    def projects(self, q):
        from . import projects
        return projects.summary(self, q)

    # ---- usage ----------------------------------------------------------------------------
    def _usage_conn(self):
        conn = ro_connect(self.cfg.db_path)
        if conn is not None and not has_table(conn, "usage_messages"):
            conn.close()
            return None
        return conn

    @staticmethod
    def _range(q):
        """(sql fragment, args) restricting usage_messages (alias u) by date range and project."""
        frm, to = _day(q, "from"), _day(q, "to")
        if frm is None and to is None:
            days = _int(q, "days", 30, 1, 3650)
            frm = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
        where, args = [], []
        if frm:
            where.append("substr(u.ts, 1, 10) >= ?")
            args.append(frm)
        if to:
            where.append("substr(u.ts, 1, 10) <= ?")
            args.append(to)
        project = _str(q, "project")
        if project:
            where.append("u.project = ?")
            args.append(project)
        return (" AND ".join(where) or "1=1"), args

    def overview(self, q):
        where, args = self._range(q)
        conn = self._usage_conn()
        out = {"available": False, "totals": {}, "daily": [], "models": [], "cache_hit_ratio": None,
               "events": 0, "dropped_events": housekeeping.dropped({"AMAUTA_STATE_DIR": str(self.cfg.state_dir)})}
        if conn is None:
            return out
        try:
            cw = "u.cache_write_5m + u.cache_write_1h"
            t = conn.execute(
                f"SELECT count(*) messages, count(DISTINCT u.session_id) sessions, coalesce(sum(u.input),0) input, coalesce(sum(u.output),0) output, "
                f"coalesce(sum(u.cache_read),0) cache_read, coalesce(sum({cw}),0) cache_write, coalesce(sum(u.thinking),0) thinking FROM usage_messages u WHERE {where}", args,
            ).fetchone()
            out["totals"] = dict(t)
            denom = t["input"] + t["cache_read"] + t["cache_write"]
            out["cache_hit_ratio"] = t["cache_read"] / denom if denom else None
            out["daily"] = [dict(r) for r in conn.execute(
                f"SELECT substr(u.ts,1,10) day, count(*) messages, count(DISTINCT u.session_id) sessions, sum(u.input) input, sum(u.output) output, "
                f"sum(u.cache_read) cache_read, sum({cw}) cache_write FROM usage_messages u WHERE {where} AND u.ts IS NOT NULL GROUP BY day ORDER BY day", args)]
            out["models"] = [dict(r) for r in conn.execute(
                f"SELECT coalesce(u.model,'unknown') model, count(*) messages, sum(u.input) input, sum(u.output) output, sum(u.cache_read) cache_read, "
                f"sum({cw}) cache_write FROM usage_messages u WHERE {where} GROUP BY model ORDER BY sum(u.input+u.output+u.cache_read+{cw}) DESC", args)]
            if has_table(conn, "events"):
                out["events"] = conn.execute("SELECT count(*) FROM events").fetchone()[0]
            out["available"] = True
        finally:
            conn.close()
        return out

    def tools(self, q):
        where, args = self._range(q)
        out = {"available": False, "tools": [], "skills": [], "subagents": [], "mcp_servers": [], "mcp_tools": []}
        conn = self._usage_conn()
        if conn is None:
            return out
        try:
            base = f"FROM tool_calls c JOIN usage_messages u ON u.message_id = c.message_id WHERE {where}"

            def table(col, extra="", cond="1=1"):
                return [dict(r) for r in conn.execute(
                    f"SELECT {col} name, count(*) count, count(DISTINCT c.session_id) sessions, max(c.ts) last_used {base} AND {cond} GROUP BY {col} ORDER BY count DESC, name LIMIT 500", args)]

            out["tools"] = table("c.tool")
            out["skills"] = table("c.skill", cond="c.skill IS NOT NULL")
            out["subagents"] = table("c.subagent_type", cond="c.subagent_type IS NOT NULL")
            out["mcp_servers"] = table("c.mcp_server", cond="c.mcp_server IS NOT NULL")
            out["mcp_tools"] = table("c.tool", cond="c.mcp_server IS NOT NULL")
            out["available"] = True
        finally:
            conn.close()
        return out

    def sessions(self, q):
        where, args = self._range(q)
        limit = _int(q, "limit", 200, 1, 1000)
        out = {"available": False, "sessions": [], "projects": []}
        conn = self._usage_conn()
        if conn is None:
            return out
        cw = "u.cache_write_5m + u.cache_write_1h"
        try:
            out["sessions"] = [dict(r) for r in conn.execute(
                f"SELECT u.session_id session_id, max(u.project) project, min(u.ts) first_ts, max(u.ts) last_ts, count(*) messages, sum(u.input) input, sum(u.output) output, "
                f"sum(u.cache_read) cache_read, sum({cw}) cache_write, max(u.model) model FROM usage_messages u WHERE {where} GROUP BY u.session_id ORDER BY last_ts DESC LIMIT ?", [*args, limit])]
            out["projects"] = [dict(r) for r in conn.execute(
                f"SELECT u.project project, count(DISTINCT u.session_id) sessions, count(*) messages, sum(u.input) input, sum(u.output) output, sum(u.cache_read) cache_read, "
                f"sum({cw}) cache_write FROM usage_messages u WHERE {where} GROUP BY u.project ORDER BY sum(u.input+u.output+u.cache_read+{cw}) DESC", args)]
            out["available"] = True
        finally:
            conn.close()
        return out

    def costs(self, q):
        label = "Estimate only: tokens x your own prices.json; not a bill."
        prices_file = self.cfg.state_dir / "prices.json"
        empty = {"enabled": False, "label": label, "models": [], "unpriced_models": [], "invalid_prices": []}
        try:
            text = prices_file.read_text()
        except FileNotFoundError:
            return empty  # costs stay off until the user creates the file
        except OSError:
            return {**empty, "error": "prices.json is unreadable"}
        try:
            prices = json.loads(text).get("models", {})
            if not isinstance(prices, dict):
                raise ValueError
        except (ValueError, AttributeError):
            return {**empty, "error": "prices.json is not valid: expected {\"models\": {...}}"}
        usage = self.overview(q)
        rows, unpriced, invalid = [], [], []
        for m in usage["models"]:
            p = prices.get(m["model"])
            if not isinstance(p, dict):
                unpriced.append(m["model"])
                rows.append({**m, "cost": None})
                continue
            bad = [k for k in _PRICE_KEYS if k in p and not _valid_price(p[k])]  # a missing key means price 0 (README)
            if bad:
                invalid.extend(f"{m['model']}: {k}" for k in bad)
                rows.append({**m, "cost": None})
                continue
            cost = sum(m[k] * p.get(k, 0) for k in _PRICE_KEYS) / 1_000_000
            rows.append({**m, "cost": cost})
        return {"enabled": True, "label": label, "models": rows, "unpriced_models": unpriced, "invalid_prices": invalid,
                "total": sum(r["cost"] for r in rows if r["cost"] is not None)}

    # ---- memories -------------------------------------------------------------------------
    def _memory_conn(self, q):
        source = q.get("source", "own")
        if source == "own":
            return source, ro_connect(self.cfg.db_path)
        if source == "engram":
            return source, ro_connect(self.cfg.engram_db) if self.cfg.engram_db else None
        raise BadRequest("source must be own or engram")

    @staticmethod
    def _revision_column(conn):
        """Name of the revision counter column ('revision' or 'revision_count'), or None when the table has neither."""
        cols = columns(conn, "observations")
        return "revision" if "revision" in cols else ("revision_count" if "revision_count" in cols else None)

    def memories(self, q):
        source, conn = self._memory_conn(q)
        out = {"source": source, "available": False, "items": [], "facets": {"projects": [], "types": []}}
        if conn is None:
            return out
        try:
            if not has_table(conn, "observations") or not _OBS_COLUMNS <= set(columns(conn, "observations")):
                return out  # not an engram-compatible schema
            rev = self._revision_column(conn)
            rev_expr = f"o.{rev}" if rev else "1"
            live = "o.deleted_at IS NULL" if "deleted_at" in columns(conn, "observations") else "1=1"
            limit = _int(q, "limit", 50, 1, 200)
            project, typ, text = _str(q, "project"), _str(q, "type"), _str(q, "q", 300)
            filt, fargs = "", []
            if project:
                filt += " AND o.project = ?"
                fargs.append(project)
            if typ:
                filt += " AND o.type = ?"
                fargs.append(typ)
            cols = f"o.id, o.title, o.type, o.project, o.topic_key, o.updated_at, {rev_expr} AS revision"
            rows = None
            if text:
                match = mstore.fts_query(text)
                if not match:
                    rows = []
                elif has_table(conn, "observations_fts"):
                    try:
                        rows = conn.execute(
                            f"SELECT {cols}, snippet(observations_fts, 1, '', '', '...', 24) AS snippet FROM observations_fts JOIN observations o ON o.id = observations_fts.rowid "
                            f"WHERE observations_fts MATCH ? AND {live}{filt} ORDER BY bm25(observations_fts) LIMIT ?", [match, *fargs, limit]).fetchall()
                    except sqlite3.Error:
                        rows = None
                if rows is None:
                    like = "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
                    rows = conn.execute(
                        f"SELECT {cols}, substr(o.content, 1, 160) AS snippet FROM observations o WHERE (o.title LIKE ? ESCAPE '\\' OR o.content LIKE ? ESCAPE '\\') AND {live}{filt} "
                        f"ORDER BY o.updated_at DESC LIMIT ?", [like, like, *fargs, limit]).fetchall()
            else:
                rows = conn.execute(f"SELECT {cols}, substr(o.content, 1, 160) AS snippet FROM observations o WHERE {live}{filt} ORDER BY o.updated_at DESC, o.id DESC LIMIT ?", [*fargs, limit]).fetchall()
            out["items"] = [dict(r) for r in rows]
            out["facets"] = {
                "projects": [r[0] for r in conn.execute(f"SELECT DISTINCT o.project FROM observations o WHERE {live} AND o.project IS NOT NULL ORDER BY 1 LIMIT 200")],
                "types": [r[0] for r in conn.execute(f"SELECT DISTINCT o.type FROM observations o WHERE {live} AND o.type IS NOT NULL ORDER BY 1 LIMIT 100")],
            }
            out["available"] = True
        finally:
            conn.close()
        return out

    def memory(self, q):
        source, conn = self._memory_conn(q)
        if conn is None:
            return {"available": False}
        try:
            rev = self._revision_column(conn)
            row = conn.execute(f"SELECT o.*, {'o.' + rev if rev else '1'} AS revision FROM observations o WHERE o.id = ?", (_int(q, "id", 0, 0, 2**62),)).fetchone() if has_table(conn, "observations") else None
        finally:
            conn.close()
        if row is None:
            raise NotFound()
        d = dict(row)
        return {"available": True, **{k: d.get(k) for k in ("id", "title", "content", "type", "project", "scope", "topic_key", "created_at", "updated_at", "revision", "deleted_at")}}

    def memory_history(self, q):
        source, conn = self._memory_conn(q)
        if conn is None:
            return {"available": False, "items": []}
        try:
            topic = _str(q, "topic_key")
            if not topic:
                return {"available": True, "items": []}
            rev = self._revision_column(conn)
            sql = (f"SELECT o.id, o.title, o.project, o.scope, o.type, o.created_at, o.updated_at, o.deleted_at, {'o.' + rev if rev else '1'} AS revision "
                   f"FROM observations o WHERE o.topic_key = ?")
            args = [topic]
            project = _str(q, "project")
            if project:
                sql += " AND o.project = ?"
                args.append(project)
            items = [dict(r) for r in conn.execute(sql + " ORDER BY o.created_at, o.id LIMIT 200", args)]
        finally:
            conn.close()
        return {"available": True, "items": items}

    def _memory_files(self):
        root = self.cfg.claude_home / "projects"
        if not root.is_dir():
            return []
        out = []
        for p in sorted(root.glob("*/memory/*.md")):
            if p.is_file() and not p.is_symlink() and not p.parent.is_symlink() and not p.parent.parent.is_symlink():
                out.append(p)
        return out

    def memory_files(self, q):
        root = self.cfg.claude_home / "projects"
        items = []
        for p in self._memory_files():
            st = p.stat()
            items.append({"id": p.relative_to(root).as_posix(), "name": p.name, "project": p.parent.parent.name, "size": st.st_size,
                          "mtime": datetime.fromtimestamp(st.st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
        return {"items": items}

    def memory_file(self, q):
        wanted = q.get("id", "")
        root = self.cfg.claude_home / "projects"
        for p in self._memory_files():  # only files that the listing itself would show can be read
            if p.relative_to(root).as_posix() == wanted:
                data = p.read_bytes()[:MAX_TEXT]
                return {"id": wanted, "content": data.decode("utf-8", "replace"), "truncated": p.stat().st_size > MAX_TEXT}
        raise NotFound()

    # ---- graph memory (graphify mirror in memory.db) ------------------------------------------
    def _graph_conn(self):
        conn = ro_connect(self.cfg.db_path)
        if conn is not None and not (has_table(conn, "graph_sync") and has_table(conn, "graph_nodes") and has_table(conn, "graph_edges")):
            conn.close()
            return None
        return conn

    def _graph_repo(self, q):
        """Only repositories given with --repo can be asked about; the value is matched, never used as a path."""
        wanted = q.get("repo")
        for repo in self.repos():
            if wanted == str(repo.resolve()):
                return wanted
        raise BadRequest("repo must be one of the configured --repo paths (see /api/graphify)")

    def graphify(self, q):
        conn = self._graph_conn()
        repos = []
        try:
            for repo in self.repos():
                key = str(repo.resolve())
                # A version-4 mirror has no semantic columns (the portal never migrates): select what exists, default the rest.
                have = set(columns(conn, "graph_sync")) if conn is not None else set()
                extra = [c for c in ("sql_tables", "semantic_pending", "semantic_at", "semantic_model") if c in have]
                row = conn.execute(f"SELECT graph_mtime, synced_at, nodes, edges{''.join(', ' + c for c in extra)} FROM graph_sync WHERE repo = ?", (key,)).fetchone() if conn is not None else None
                if row is None:
                    repos.append({"name": repo.name, "path": key, "available": False,
                                  "reason": "not mirrored yet: run `amauta graphify hook install --cwd <repo>` (or `graphify update .` then `python3 -P -m amauta.graph sync --repo .`)"})
                else:
                    repos.append({"name": repo.name, "path": key, "available": True, "nodes": row["nodes"], "edges": row["edges"], "synced_at": row["synced_at"],
                                  "graph_mtime": datetime.fromtimestamp(row["graph_mtime"] or 0, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                  "sql_tables": row["sql_tables"] if "sql_tables" in extra else 0,
                                  "semantic_pending": bool(row["semantic_pending"]) if "semantic_pending" in extra else False,
                                  "semantic_at": row["semantic_at"] if "semantic_at" in extra else None,
                                  "semantic_model": row["semantic_model"] if "semantic_model" in extra else None})
        finally:
            if conn is not None:
                conn.close()
        return {"repos": repos}

    def _graph_call(self, fn):
        conn = self._graph_conn()
        if conn is None:
            return {"available": False}
        try:
            return {"available": True, **fn(conn)}
        except graph_query.QueryError as err:
            raise BadRequest(str(err)) from None
        finally:
            conn.close()

    def graph_nodes(self, q):
        repo = self._graph_repo(q)
        limit = _int(q, "limit", 50, 1, 200)
        return self._graph_call(lambda conn: {"items": graph_query.search_nodes(conn, repo, _str(q, "q", 200) or "", limit)})

    def graph_neighbors(self, q):
        repo = self._graph_repo(q)
        node = _str(q, "node", 512)
        if not node:
            raise BadRequest("node is required")
        depth = _int(q, "depth", 1, 1, graph_query.MAX_DEPTH)
        return self._graph_call(lambda conn: graph_query.neighbors(conn, repo, node, depth))

    # ---- harness --------------------------------------------------------------------------
    @staticmethod
    def _read_json(path):
        try:
            data = json.loads(Path(path).read_text())
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def harness(self, q):
        state = self._read_json(self.cfg.state_dir / "state.json")
        if not state:
            return {"installed": False, "hooks": [], "mcp_servers": []}
        home = Path(state.get("claude_home") or self.cfg.claude_home)
        settings = self._read_json(home / "settings.json")
        hooks = []
        for event, entries in (settings.get("hooks") or {}).items():
            for entry in entries if isinstance(entries, list) else []:
                for h in (entry.get("hooks") or []) if isinstance(entry, dict) else []:
                    cmd = h.get("command", "") if isinstance(h, dict) else ""
                    hooks.append({"event": event, "kind": _hook_kind(cmd)})  # command text of other tools is never exposed
        cj = self._read_json(state.get("claude_json") or "")
        servers = []
        for name, spec in (cj.get("mcpServers") or {}).items():
            spec = spec if isinstance(spec, dict) else {}
            servers.append({"name": name, "type": spec.get("type") or ("stdio" if spec.get("command") else "unknown"),
                            "command": Path(str(spec.get("command", ""))).name or None})  # no args, no env
        managed = state.get("managed_files") or {}
        return {
            "installed": True, "version": state.get("version"), "installed_at": state.get("installed_at"), "persona": state.get("persona"),
            "components": state.get("components") or [], "rdd_mode": state.get("rdd_mode"), "telemetry": state.get("telemetry") is True,
            "memory_server_key": state.get("memory_server_key"), "managed_files": len(state.get("managed_files") or {}),
            "claude_home": str(home), "hooks": hooks, "mcp_servers": servers,
            "skills": sum(1 for rel in managed if re.fullmatch(r"skills/[^/]+/SKILL\.md", rel)),
            "agents": sum(1 for rel in managed if re.fullmatch(r"agents/[^/]+\.md", rel)),
        }

    def odd(self, q):
        repos = []
        for repo in self.repos():
            docs = []
            folder = repo / "odd" / "tasks"
            for f in sorted(folder.glob("*.md")) if folder.is_dir() else []:
                try:
                    text = f.read_text(errors="replace")[:MAX_TEXT]
                except OSError:
                    continue
                tasks = wikifeature.parse_tasks(text)
                docs.append({"id": f"{repo.name}/{f.stem}", "name": f.name, "done": sum(t["done"] for t in tasks), "total": len(tasks), "tasks": tasks})
            repos.append({"repo": repo.name, "documents": docs})
        return {"repos": repos}

    # ---- diagrams (Mermaid source is generated here, from the data the views above already use) --------------
    def archify_view(self, q):
        """Harness architecture drawn by the vendored archify CLI (rendered now, cached by input hash) plus the Mermaid text diagram as the fallback."""
        hs = self.harness({})
        fallback = diagrams.architecture(hs, self.cfg.state_dir)
        if not hs.get("installed"):
            return {"installed": False, "available": False, "reason": "amauta is not installed", "fallback": fallback}
        stores = [{"label": "memory.db", "detail": "memories, graph, usage"}] if self.cfg.db_path.exists() else []
        if hs.get("telemetry"):
            stores.append({"label": "telemetry", "detail": "hook events"})
        cli = archify.find_cli(hs.get("claude_home"))
        # The router sometimes refuses a crowded layout with region boundaries ("container-border-run"); the same diagram without them always fits.
        for boundaries in (True, False):
            ir = archify.build(hs, stores, boundaries=boundaries)
            key, why = archify.render(ir, cli)
            if key is not None:
                break
        if key is None:
            return {"installed": True, "available": False, "reason": why, "fallback": fallback}
        return {"installed": True, "available": True, "url": f"/archify/{key}.html", "components": len(ir["components"]), "fallback": fallback}

    def graph_diagram(self, q):
        repo = self._graph_repo(q)
        node = _str(q, "node", 512)
        if not node:
            raise BadRequest("node is required")
        depth = _int(q, "depth", 1, 1, graph_query.MAX_DEPTH)

        def build(conn):
            g = graph_query.neighbors(conn, repo, node, depth)
            return {"source": diagrams.graph_neighborhood(g), "nodes": len(g["nodes"]), "edges": len(g["edges"]), "truncated": g["truncated"]}
        return self._graph_call(build)

    # ---- wiki (page schema, recent changes, search) live in wiki.py; imported lazily because wiki.py imports this module ----
    def wiki_page(self, q):
        from . import wiki
        return wiki.page(self, q)

    def wiki_recent(self, q):
        from . import wiki
        return wiki.recent(self, q)

    def wiki_search(self, q):
        from . import wiki
        return wiki.search(self, q)

    def skills(self, q):
        from . import wikiskills
        return wikiskills.catalog(self, q)

    def wiki_lint(self, q):
        from . import wikilint
        return wikilint.lint(self, q)

    def wiki_home(self, q):
        from . import wikihome
        return wikihome.home(self, q)

    # ---- the only write ---------------------------------------------------------------------
    def refresh(self):
        if not self._refresh_lock.acquire(blocking=False):
            return 409, {"error": "a refresh is already running"}
        try:
            conn = mstore.connect(self.cfg.db_path)
            try:
                return 200, ingest.backfill(conn, self.cfg.claude_home, deadline=time.monotonic() + 120)
            finally:
                conn.close()
        except Exception as err:
            return 500, {"error": f"refresh failed: {type(err).__name__}"}
        finally:
            self._refresh_lock.release()


class NotFound(BadRequest):
    pass


_PRICE_KEYS = ("input", "output", "cache_read", "cache_write")


def _valid_price(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0


_OBS_COLUMNS = {"id", "title", "content", "type", "project", "topic_key", "updated_at"}


def _hook_kind(cmd: str) -> str:
    for kind, pat in (("telemetry", r"amauta\.telemetry"), ("usage", r"amauta\.usage"), ("skill-registry", r"amauta\.js\S*\s+hook\s+skill-registry"),
                      ("review-stop", r"amauta\.js\S*\s+hook\s+review-stop")):
        if re.search(pat, cmd):
            return kind
    return "other"


_ROUTES = {
    "/api/overview": "overview", "/api/tools": "tools", "/api/sessions": "sessions", "/api/costs": "costs",
    "/api/memories": "memories", "/api/memory": "memory", "/api/memory/history": "memory_history",
    "/api/memory-files": "memory_files", "/api/memory-file": "memory_file", "/api/graphify": "graphify",
    "/api/graph/nodes": "graph_nodes", "/api/graph/neighbors": "graph_neighbors",
    "/api/harness": "harness", "/api/odd": "odd", "/api/graph/diagram": "graph_diagram", "/api/archify": "archify_view",
    "/api/wiki/page": "wiki_page", "/api/wiki/recent": "wiki_recent", "/api/wiki/search": "wiki_search", "/api/wiki/home": "wiki_home", "/api/wiki/lint": "wiki_lint", "/api/skills": "skills", "/api/projects": "projects", "/api/themes": "themes",
}
