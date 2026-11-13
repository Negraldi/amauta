"""The one rule that names a session's project, used by every page that shows it (Today, Usage, search, project and session pages).

Applied to the cwd found in the session's transcript: the configured or discovered project whose folder holds it (the deepest
one), else the root of its git repository (a linked worktree counts as its main repository; a repository in $HOME itself, such
as dotfiles, never does), else the folder name. Without a transcript the usage table's own name is kept."""
from __future__ import annotations

import os
from pathlib import Path

from . import sesswhere

MAX_DEPTH = 24
UNKNOWN = "unknown project"


def _projects():
    from . import projects  # projects imports api, which imports this module
    return projects


def _real(path) -> Path:
    return Path(os.path.realpath(path))


def _configured(portal, here: Path):
    owners = [r for r in (_real(p) for p in _projects().collect(portal)["repos"]) if r == here or r in here.parents]
    return max(owners, key=lambda r: len(r.parts)) if owners else None


def _main_of_worktree(root: Path) -> Path:
    """The main repository of a linked worktree (`.git` file -> <main>/.git/worktrees/<name>); the root itself otherwise."""
    if not _projects().is_linked_worktree(root):
        return root
    try:
        gitdir = Path((root / ".git").read_text(errors="replace").splitlines()[0][len("gitdir:"):].strip())
    except (OSError, IndexError):
        return root
    return gitdir.parents[2] if len(gitdir.parents) > 2 and gitdir.parent.parent.name == ".git" else root


def repo_root(portal, cwd):
    """Nearest ancestor of `cwd` with a .git entry, never $HOME itself; linked worktrees map to their main repository."""
    if not cwd:
        return None
    home = _projects().home_dir(portal.cfg.home)
    here = _real(cwd)
    for d in [here, *here.parents][:MAX_DEPTH]:
        if d == home:
            return None
        try:
            if (d / ".git").exists():
                return _main_of_worktree(d)
        except OSError:
            return None
    return None


def owner(portal, cwd):
    """(name, folder) that owns `cwd` by the rule above; folder is the project or repository folder, or the cwd itself."""
    here = _real(cwd)
    configured = _configured(portal, here)
    if configured is not None:
        return configured.name, configured
    root = repo_root(portal, cwd)
    return (root.name, root) if root is not None else (here.name, here)


def _owner_cached(portal, cwd):
    """owner() memoised per cwd until the project list changes (projects.collect returns a new value)."""
    value = _projects().collect(portal)
    memo = getattr(portal, "_owner_memo", None)
    if memo is None or memo[0] is not value:
        memo = portal._owner_memo = (value, {})
    if cwd not in memo[1]:
        memo[1][cwd] = owner(portal, cwd)
    return memo[1][cwd]


def project_of(portal, cwd, fallback=None) -> str:
    name = _owner_cached(portal, cwd)[0] if cwd else ""
    return name or fallback or UNKNOWN


def session_project(portal, session_id, fallback=None) -> str:
    """The project name of a session: its transcript's cwd by the rule; without a transcript, the usage table's own name."""
    return project_of(portal, sesswhere.cwd(portal, session_id), fallback)


def session_folder(portal, session_id):
    """The folder that owns the session (project, repository or cwd), or None without a transcript."""
    cwd = sesswhere.cwd(portal, session_id)
    return _owner_cached(portal, cwd)[1] if cwd else None


# ---- the rule inside SQL: every usage query that filters or groups by project calls session_project() --------------
# Usage > Project filter: the sessions whose name (by the rule, stored name as the fallback) is the one asked for.
PROJECT_FILTER = ("u.session_id IN (SELECT v.session_id FROM usage_messages v GROUP BY v.session_id "
                  "HAVING session_project(v.session_id, max(v.project)) = ?)")


def register(portal, conn):
    """Adds session_project(session_id, stored_name) to a usage connection, memoised for the connection's life."""
    memo = {}

    def fn(sid, stored):
        key = (sid, stored)
        if key not in memo:
            memo[key] = session_project(portal, sid, stored) if sid else (stored or UNKNOWN)
        return memo[key]
    conn.create_function("session_project", 2, fn, deterministic=True)
    return conn


def project_totals(conn, where, args):
    """Usage > Projects: per-session sums first, then one session_project() call per session to group them."""
    cw = "u.cache_write_5m + u.cache_write_1h"
    inner = (f"SELECT u.session_id sid, max(u.project) stored, count(*) messages, sum(u.input) input, sum(u.output) output, "
             f"sum(u.cache_read) cache_read, sum({cw}) cache_write FROM usage_messages u WHERE {where} GROUP BY u.session_id")
    sql = (f"SELECT session_project(s.sid, s.stored) project, count(*) sessions, sum(s.messages) messages, sum(s.input) input, "
           f"sum(s.output) output, sum(s.cache_read) cache_read, sum(s.cache_write) cache_write FROM ({inner}) s "
           f"GROUP BY 1 ORDER BY sum(s.input + s.output + s.cache_read + s.cache_write) DESC")
    return [dict(r) for r in conn.execute(sql, args)]


def sessions_by_project(portal):
    """{name: {"ids": [session ids, newest first], "last": newest message ts, "folder": owning folder or None}} over every
    session in the usage tables: the one membership the Projects list, a project page and its Sessions tab share."""
    conn = portal._usage_conn()
    if conn is None:
        return {}
    try:
        rows = conn.execute("SELECT u.session_id sid, session_project(u.session_id, max(u.project)) name, max(u.ts) last "
                            "FROM usage_messages u WHERE u.session_id IS NOT NULL GROUP BY u.session_id ORDER BY last DESC").fetchall()
    finally:
        conn.close()
    out = {}
    for r in rows:
        entry = out.setdefault(r["name"], {"ids": [], "last": r["last"], "folder": None})
        entry["ids"].append(r["sid"])
        entry["folder"] = entry["folder"] or session_folder(portal, r["sid"])
    return out
