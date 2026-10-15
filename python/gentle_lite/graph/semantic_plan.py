"""Deterministic half of the in-session semantic pass: python3 -P -m gentle_lite.graph.semantic_plan <plan|validate|merge>.

The orchestrator (a Claude Code session, see assets/skills/graphify-semantic) does the one non-deterministic step:
dispatching one Haiku subagent per chunk. Everything around it lives here:

  plan      `graphify update` (local AST), list the documents/papers/images still needing extraction (graphify's own
            cache decides), split them into chunks and render one ready-to-use prompt file per chunk from graphify's
            bundled extraction-spec.md.
  validate  check every chunk file a subagent wrote (schema, ids, confidence rules, known edge endpoints).
  merge     fold the valid chunks (+ cached results) into graph.json through graphify's own build/cluster/to_json
            (its shrink guard is never bypassed), save graphify's semantic cache, then mirror into memory.db.

graphify is never imported here: its APIs run in graphify's own interpreter (`<python> -I -c WORKER`), found from the
`graphify` executable's shebang. No network, no API key.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from .. import paths
from ..memory import store as mstore
from . import sync
from .lock import LockHeld, graphify_lock

DEFAULT_MODEL = "claude-haiku-5-5"
DEFAULT_CHUNK_SIZE = 25
SEMANTIC_KINDS = ("document", "paper", "image")  # code is covered by the AST pass
FILE_TYPES = {"code", "document", "paper", "image", "rationale", "concept"}
CONFIDENCES = {"EXTRACTED", "INFERRED", "AMBIGUOUS"}
ID_RE = re.compile(r"^[a-z0-9_]+$")
MAX_CHUNK_BYTES = 16 * 1024 * 1024
CHUNK_GLOB, PROMPT_GLOB = ".graphify_chunk_*.json", ".gentle_semantic_prompt_*.md"
HINT_MAX_IDS = 200
UPDATE_TIMEOUT = 900
WORKER_TIMEOUT = 900

EXIT_ERROR, EXIT_NO_VALID, EXIT_REFUSED = 2, 3, 4


class SemanticError(Exception):
    pass


# --------------------------------------------------------------------------------------------- graphify discovery

def find_graphify(graphify_bin: str | None = None) -> tuple[str, str]:
    """(executable, interpreter). The interpreter is the one graphify itself runs with, read from the shebang."""
    exe = graphify_bin or shutil.which("graphify")
    if not exe or not Path(exe).is_file():
        raise SemanticError("graphify is not on PATH (install it with `pipx install graphifyy`) and --graphify-bin was not given")
    override = os.environ.get("GENTLE_LITE_GRAPHIFY_PYTHON")
    candidate = override
    if not candidate:
        try:
            with Path(exe).open("rb") as fh:
                first = fh.readline().decode("utf-8", "replace").strip()
        except OSError as err:
            raise SemanticError(f"cannot read {exe}: {err}") from None
        parts = shlex.split(first[2:]) if first.startswith("#!") else []
        if parts and Path(parts[0]).is_absolute() and Path(parts[0]).name.startswith("python"):
            candidate = parts[0]
    if not candidate or not Path(candidate).is_file():
        raise SemanticError(f"cannot tell which Python interpreter runs {exe} (no absolute python shebang); set GENTLE_LITE_GRAPHIFY_PYTHON")
    return str(exe), str(candidate)


WORKER = r'''
import json, sys
from pathlib import Path
payload = json.load(sys.stdin)
op = sys.argv[1]
sys.stdout = sys.stderr  # graphify prints progress/warnings; the result travels through the out file only
import graphify
package = Path(graphify.__file__).parent
spec = package / "skills" / "claude" / "references" / "extraction-spec.md"
if op == "inputs":
    from graphify.detect import detect
    from graphify.cache import check_semantic_cache
    root = Path(payload["repo"])
    found = detect(root)["files"]
    files = sorted({str(Path(f)) for kind in payload["kinds"] for f in found.get(kind, [])})
    kw = {"mode": payload["mode"]} if payload.get("mode") else {}
    nodes, edges, hyper, uncached = check_semantic_cache(files, root, prompt_file=spec, **kw)
    result = {"package": str(package), "spec": str(spec), "files": files, "uncached": sorted(uncached),
              "cached": {"nodes": nodes, "edges": edges, "hyperedges": hyper}}
elif op == "merge":
    from graphify.build import build_from_json
    from graphify.cluster import cluster
    from graphify.export import to_json
    from graphify.cache import save_semantic_cache
    repo = Path(payload["repo"])
    G = build_from_json(payload["extraction"], root=repo)
    communities = cluster(G)
    written = bool(to_json(G, communities, payload["graph"]))
    saved = 0
    if written and payload["semantic"]["nodes"]:
        kw = {"mode": payload["mode"]} if payload.get("mode") else {}
        s = payload["semantic"]
        saved = save_semantic_cache(s["nodes"], s["edges"], s["hyperedges"], root=repo,
                                    allowed_source_files=payload["allowed"], prompt_file=spec, **kw)
    result = {"written": written, "nodes": G.number_of_nodes(), "edges": G.number_of_edges(), "cache_entries": saved}
else:
    raise SystemExit("unknown op " + op)
Path(payload["out"]).write_text(json.dumps(result))
'''


def run_worker(python: str, op: str, payload: dict) -> dict:
    with tempfile.TemporaryDirectory(prefix="gentle-lite-sem-") as tmp:
        out = Path(tmp) / "out.json"
        env = {**os.environ, "GRAPHIFY_QUERY_LOG_DISABLE": "1"}
        try:
            proc = subprocess.run([python, "-I", "-c", WORKER, op], input=json.dumps({**payload, "out": str(out)}), capture_output=True,
                                  text=True, env=env, timeout=WORKER_TIMEOUT)
        except (OSError, subprocess.TimeoutExpired) as err:
            raise SemanticError(f"graphify interpreter failed: {err}") from None
        if proc.returncode != 0 or not out.exists():
            raise SemanticError(f"graphify {op} step failed ({proc.returncode}): {proc.stderr.strip()[-1500:]}")
        return json.loads(out.read_text())


# ------------------------------------------------------------------------------------------------------ paths/IO

def out_dir(repo: Path) -> Path:
    return repo / "graphify-out"


def plan_file(repo: Path) -> Path:
    return out_dir(repo) / ".gentle_semantic_plan.json"


def cached_file(repo: Path) -> Path:
    return out_dir(repo) / ".gentle_semantic_cached.json"


def chunk_file(repo: Path, num: int) -> Path:
    return out_dir(repo) / f".graphify_chunk_{num:02d}.json"


def prompt_file_of(repo: Path, num: int) -> Path:
    return out_dir(repo) / f".gentle_semantic_prompt_{num:02d}.md"


def _read_json(path: Path, what: str):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SemanticError(f"{what} not found at {path}") from None
    except (OSError, ValueError) as err:
        raise SemanticError(f"cannot read {what} {path}: {err}") from None


def load_existing(repo: Path) -> tuple[dict, int]:
    """graph.json as {nodes, edges, hyperedges} plus its node count."""
    data = _read_json(out_dir(repo) / "graph.json", "graph.json (run `plan` first)")
    if not isinstance(data, dict) or not isinstance(data.get("nodes"), list):
        raise SemanticError("graph.json is not a graphify graph")
    links = data.get("links") if "links" in data else data.get("edges", [])
    hyper = data.get("hyperedges")
    if hyper is None and isinstance(data.get("graph"), dict):
        hyper = data["graph"].get("hyperedges")
    return {"nodes": list(data["nodes"]), "edges": list(links or []), "hyperedges": list(hyper or [])}, len(data["nodes"])


def ast_sql_ids(existing: dict) -> list[str]:
    ids = [n["id"] for n in existing["nodes"] if isinstance(n, dict) and isinstance(n.get("id"), str)
           and str(n.get("source_file") or "").lower().endswith(".sql") and n.get("_origin") != "semantic"]
    return sorted(set(ids))[:HINT_MAX_IDS]


# ----------------------------------------------------------------------------------------------------- planning

def chunk_files(files: list[str], size: int) -> list[list[str]]:
    """Group by directory (sort), then split into the fewest chunks of at most `size`, as evenly as possible."""
    ordered = sorted(files, key=lambda f: (str(Path(f).parent), f))
    if not ordered:
        return []
    count = math.ceil(len(ordered) / size)
    base, extra = divmod(len(ordered), count)
    chunks, start = [], 0
    for i in range(count):
        end = start + base + (1 if i < extra else 0)
        chunks.append(ordered[start:end])
        start = end
    return chunks


def prompt_block(spec_text: str) -> str:
    m = re.search(r"^```[^\n]*\n(.*?)^```[ \t]*$", spec_text, re.DOTALL | re.MULTILINE)
    if not m:
        raise SemanticError("the bundled extraction-spec.md has no fenced prompt block (graphify layout changed?)")
    return m.group(1).rstrip("\n")


REPLY_ONLY = ("Reply with only the JSON object: no prose before or after it, no Markdown, no code fences. You have no Write tool and "
              "must not write any file; your final message is saved for you.")


def render_prompt(block: str, files: list[str], num: int, total: int, deep: bool, sql_ids: list[str]) -> str:
    """The spec verbatim except its final instruction: the extractor has only `Read`, so it replies with the JSON instead of
    writing it (the orchestrator saves the reply with `save-chunk`)."""
    lines, replied = [], False
    for line in block.split("\n"):
        if line == "FILE_LIST":
            lines.append("\n".join(files))
            if sql_ids:
                lines.append("")
                lines.append("Known AST node ids (SQL tables and columns; they already exist in the graph): " + ", ".join(sql_ids) + ".")
                lines.append("When a document refers to one of these entities, point the edge at exactly that id; do not create a duplicate node for it.")
        elif line.startswith("Then write the JSON to disk"):
            lines.append(REPLY_ONLY)
            replied = True
        elif line == "CHUNK_PATH":
            continue
        elif "CHUNK_NUM" in line and "TOTAL_CHUNKS" in line:
            lines.append(line.replace("CHUNK_NUM", str(num)).replace("TOTAL_CHUNKS", str(total)))
        elif deep and line.startswith("DEEP_MODE (if --mode deep was given)"):
            lines.append(line.replace("(if --mode deep was given)", "(--mode deep WAS given: apply it)"))
        else:
            lines.append(line)
    if not replied:
        lines += ["", REPLY_ONLY]
    return "\n".join(lines) + "\n"


def _remove_leftovers(repo: Path) -> None:
    """Chunk and prompt files of an earlier run: a subagent that fails this time must not leave a stale result to merge."""
    out = out_dir(repo)
    if out.is_dir():
        for pattern in (CHUNK_GLOB, PROMPT_GLOB):
            for old in out.glob(pattern):
                old.unlink(missing_ok=True)


def cmd_plan(args) -> dict:
    repo = Path(args.repo).resolve()
    created_ns = time.time_ns()  # taken before anything is written: a chunk older than this belongs to an earlier run
    exe, python = find_graphify(args.graphify_bin)
    if not args.skip_update:
        try:
            proc = subprocess.run([exe, "update", str(repo)], capture_output=True, text=True, timeout=UPDATE_TIMEOUT,
                                  env={**os.environ, "GRAPHIFY_QUERY_LOG_DISABLE": "1"})
        except (OSError, subprocess.TimeoutExpired) as err:
            raise SemanticError(f"graphify update failed: {err}") from None
        if proc.returncode != 0:
            raise SemanticError(f"graphify update failed ({proc.returncode}): {(proc.stderr or proc.stdout).strip()[-800:]}")
    mode = "deep" if args.deep else None
    found = run_worker(python, "inputs", {"repo": str(repo), "kinds": list(SEMANTIC_KINDS), "mode": mode})
    try:
        existing, _ = load_existing(repo)
    except SemanticError:
        existing = {"nodes": [], "edges": [], "hyperedges": []}
    sql_ids = ast_sql_ids(existing)
    block = prompt_block(Path(found["spec"]).read_text(encoding="utf-8"))
    groups = chunk_files(found["uncached"], args.chunk_size)
    out = out_dir(repo)
    out.mkdir(parents=True, exist_ok=True)
    _remove_leftovers(repo)
    plan_file(repo).unlink(missing_ok=True)
    chunks = []
    for i, files in enumerate(groups, start=1):
        prompt_path = prompt_file_of(repo, i)
        prompt_path.write_text(render_prompt(block, files, i, len(groups), args.deep, sql_ids), encoding="utf-8")
        chunks.append({"num": i, "files": files, "chunk_path": str(chunk_file(repo, i)), "prompt_file": str(prompt_path)})
    cached_file(repo).write_text(json.dumps(found["cached"]), encoding="utf-8")
    plan = {"plan_id": uuid.uuid4().hex, "created_ns": created_ns, "repo": str(repo), "graphify": exe, "graphify_python": python,
            "spec": found["spec"], "deep": bool(args.deep), "mode": mode, "all_files": found["files"], "ast_sql_ids": sql_ids,
            "chunks": chunks, "total_chunks": len(chunks)}
    plan_file(repo).write_text(json.dumps(plan, indent=1), encoding="utf-8")
    cached_files = len(found["files"]) - len(found["uncached"])
    return {"repo": str(repo), "plan": str(plan_file(repo)), "plan_id": plan["plan_id"], "spec": found["spec"], "chunks": len(chunks),
            "files": len(found["uncached"]), "cached_files": cached_files, "prompt_files": [c["prompt_file"] for c in chunks],
            "chunk_paths": [c["chunk_path"] for c in chunks]}


# ----------------------------------------------------------------------------------------------- untrusted input

def _str_list(value) -> bool:
    return isinstance(value, list) and all(isinstance(v, str) for v in value)


def load_plan(repo: Path) -> dict:
    """The plan file, type-checked. It lives in a repo-local directory that a hostile repo can pre-populate, so nothing in it
    is trusted: every field is checked and every path is re-derived from the chunk number and compared."""
    plan = _read_json(plan_file(repo), "semantic plan (run `plan` first)")

    def bad(field: str, why: str):
        raise SemanticError(f"semantic plan is not usable: `{field}` {why} (run `plan` again)")

    if not isinstance(plan, dict):
        bad("plan", "is not an object")
    if plan.get("repo") != str(repo):
        raise SemanticError("semantic plan belongs to another repository (run `plan` again)")
    for field in ("plan_id", "graphify_python"):
        if not isinstance(plan.get(field), str) or not plan[field]:
            bad(field, "must be a non-empty string")
    created = plan.get("created_ns")
    if not isinstance(created, int) or isinstance(created, bool):
        bad("created_ns", "must be an integer")
    if plan.get("mode") not in (None, "deep"):
        bad("mode", "must be null or \"deep\"")
    if not _str_list(plan.get("all_files")):
        bad("all_files", "must be a list of strings")
    chunks = plan.get("chunks")
    if not isinstance(chunks, list):
        bad("chunks", "must be a list")
    for i, c in enumerate(chunks, start=1):
        if not isinstance(c, dict) or c.get("num") != i or isinstance(c.get("num"), bool):
            bad("chunks", f"entry {i} must be an object numbered {i}")
        if not _str_list(c.get("files")):
            bad("chunks", f"entry {i} `files` must be a list of strings")
        if c.get("chunk_path") != str(chunk_file(repo, i)):
            bad("chunks", f"entry {i} `chunk_path` must be {chunk_file(repo, i)}")
        if c.get("prompt_file") != str(prompt_file_of(repo, i)):
            bad("chunks", f"entry {i} `prompt_file` must be {prompt_file_of(repo, i)}")
    return plan


def clean_cached(raw) -> dict:
    """graphify-out/.gentle_semantic_cached.json is repo-local too: keep only well-formed node/edge/hyperedge objects."""
    out = {"nodes": [], "edges": [], "hyperedges": []}
    if not isinstance(raw, dict):
        return out
    for key in out:
        items = raw.get(key)
        if isinstance(items, list):
            out[key] = [i for i in items if isinstance(i, dict)]
    out["nodes"] = [n for n in out["nodes"] if isinstance(n.get("id"), str) and ID_RE.match(n["id"])]
    return out


# ---------------------------------------------------------------------------------------------------- validation

def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _node_ids(data) -> set:
    return {n["id"] for n in data["nodes"] if isinstance(n, dict) and isinstance(n.get("id"), str)}


def check_shape(data) -> list[str]:
    """Everything about a chunk that does not depend on other chunks: types, ids, enums, confidence rules."""
    if not isinstance(data, dict) or not isinstance(data.get("nodes"), list):
        return ["not an object with a `nodes` list"]
    errors = []
    edges, hyper = data.get("edges", []), data.get("hyperedges")
    if not isinstance(edges, list):
        errors.append("`edges` must be a list")
        edges = []
    if hyper is not None and not isinstance(hyper, list):
        errors.append("`hyperedges` must be a list")
        hyper = []
    for i, n in enumerate(data["nodes"]):
        if not isinstance(n, dict):
            errors.append(f"nodes[{i}] is not an object")
            continue
        nid = n.get("id")
        if not isinstance(nid, str) or not ID_RE.match(nid):
            errors.append(f"nodes[{i}] id {nid!r} must match [a-z0-9_]+")
        if n.get("file_type") not in FILE_TYPES:
            errors.append(f"nodes[{i}] file_type {n.get('file_type')!r} must be one of {sorted(FILE_TYPES)}")
        if not isinstance(n.get("label"), str) or not n.get("label"):
            errors.append(f"nodes[{i}] needs a label")
        if n.get("source_file") is not None and not isinstance(n.get("source_file"), str):
            errors.append(f"nodes[{i}] source_file must be a string")
    for i, e in enumerate(edges):
        if not isinstance(e, dict):
            errors.append(f"edges[{i}] is not an object")
            continue
        for end in ("source", "target"):
            if not isinstance(e.get(end), str):
                errors.append(f"edges[{i}] {end} must be a node id string")
        if e.get("relation") is not None and not isinstance(e.get("relation"), str):
            errors.append(f"edges[{i}] relation must be a string")
        conf, score = e.get("confidence"), e.get("confidence_score")
        if conf not in CONFIDENCES:
            errors.append(f"edges[{i}] confidence {conf!r} must be one of {sorted(CONFIDENCES)}")
        if not _number(score) or not 0 <= score <= 1:
            errors.append(f"edges[{i}] confidence_score {score!r} is required and must be within 0..1")
        elif conf == "EXTRACTED" and score != 1.0:
            errors.append(f"edges[{i}] EXTRACTED edges need confidence_score 1.0, got {score}")
        elif score == 0.5:
            errors.append(f"edges[{i}] confidence_score must never be the 0.5 default")
    for i, h in enumerate(hyper or []):
        members = h.get("nodes") if isinstance(h, dict) else None
        if not isinstance(members, list) or len(members) < 3 or not all(isinstance(m, str) for m in members):
            errors.append(f"hyperedges[{i}] needs a `nodes` list of at least 3 id strings")
        if isinstance(h, dict) and h.get("id") is not None and not isinstance(h.get("id"), str):
            errors.append(f"hyperedges[{i}] id must be a string")
    return errors


def check_endpoints(data, known: set) -> list[str]:
    """Edge and hyperedge endpoints must be known node ids. Only meaningful for a chunk that passed `check_shape`."""
    errors = []
    for i, e in enumerate(data.get("edges", [])):
        errors.extend(f"edges[{i}] {end} {e[end]!r} is not a known node id" for end in ("source", "target") if e[end] not in known)
    for i, h in enumerate(data.get("hyperedges") or []):
        errors.extend(f"hyperedges[{i}] member {m!r} is not a known node id" for m in h["nodes"] if m not in known)
    return errors


def check_chunk(data, known: set) -> list[str]:
    errors = check_shape(data)
    return errors or check_endpoints(data, known | _node_ids(data))


def read_chunks(repo: Path, plan: dict) -> list[dict]:
    """One report per planned chunk: parsed data (None when unreadable) and structural errors."""
    reports = []
    for c in plan["chunks"]:
        path = Path(c["chunk_path"])
        entry = {"num": c["num"], "path": str(path), "data": None, "errors": []}
        try:
            st = path.stat()
            if st.st_mtime_ns < plan["created_ns"]:
                entry["errors"].append(f"chunk file {path} was saved before the plan (a leftover of an earlier run, not this plan's result)")
            elif st.st_size > MAX_CHUNK_BYTES:
                entry["errors"].append(f"chunk file {path} is larger than {MAX_CHUNK_BYTES} bytes")
            else:
                entry["data"] = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            entry["errors"].append(f"chunk file missing: {path} (the subagent did not write it)")
        except (OSError, ValueError) as err:
            entry["errors"].append(f"not valid JSON: {err}")
        reports.append(entry)
    return reports


def validate_plan(repo: Path, plan: dict) -> list[dict]:
    existing, _ = load_existing(repo)
    known = {n["id"] for n in existing["nodes"] if isinstance(n, dict) and isinstance(n.get("id"), str)}
    try:
        known |= _node_ids(clean_cached(_read_json(cached_file(repo), "cached results")))
    except SemanticError:
        pass
    reports = read_chunks(repo, plan)
    for r in reports:
        if r["data"] is not None:
            r["errors"] = check_shape(r["data"])
        d = r["data"] if isinstance(r["data"], dict) and not r["errors"] else {}
        r["counts"] = (len(d.get("nodes") or []), len(d.get("edges") or []), len(d.get("hyperedges") or []))
        r["valid"] = r["data"] is not None and not r["errors"]
    # Only ids of chunks that stay valid count as known endpoints; dropping a chunk can orphan a neighbour's edges, so repeat.
    changed = True
    while changed:
        changed = False
        pool = known.union(*(_node_ids(r["data"]) for r in reports if r["valid"]))
        for r in reports:
            if r["valid"]:
                errs = check_endpoints(r["data"], pool)
                if errs:
                    r["errors"], r["valid"], changed = errs, False, True
    return reports


def cmd_validate(args) -> tuple[dict, int]:
    repo = Path(args.repo).resolve()
    plan = load_plan(repo)
    reports = validate_plan(repo, plan)
    chunks = [{"num": r["num"], "path": r["path"], "valid": r["valid"], "errors": r["errors"][:20], "nodes": r["counts"][0],
               "edges": r["counts"][1], "hyperedges": r["counts"][2]} for r in reports]
    code = EXIT_NO_VALID if chunks and not any(c["valid"] for c in chunks) else 0
    return {"repo": str(repo), "chunks": chunks, "valid": sum(c["valid"] for c in chunks), "invalid": sum(not c["valid"] for c in chunks)}, code


# ---------------------------------------------------------------------------------------------------------- merge

def _stamp(items) -> list[dict]:
    return [{**i, "_origin": "semantic"} for i in items if isinstance(i, dict)]


def _edge_key(e: dict):
    return (e.get("source"), e.get("target"), e.get("relation"))


def merge_extraction(existing: dict, semantic: dict) -> dict:
    """AST/existing graph first; semantic nodes deduped by id (the existing node wins), edges by (source, target, relation)."""
    nodes = {n["id"]: n for n in existing["nodes"] if isinstance(n, dict) and "id" in n}
    for n in semantic["nodes"]:
        nodes.setdefault(n["id"], n)
    edges = {_edge_key(e): e for e in existing["edges"] if isinstance(e, dict)}
    for e in semantic["edges"]:
        edges.setdefault(_edge_key(e), e)
    hyper = {h.get("id", i): h for i, h in enumerate(existing["hyperedges"]) if isinstance(h, dict)}
    for h in semantic["hyperedges"]:
        hyper.setdefault(h.get("id", f"semantic_{len(hyper)}"), h)
    return {"nodes": list(nodes.values()), "edges": list(edges.values()), "hyperedges": list(hyper.values())}


def cmd_merge(args) -> tuple[dict, int]:
    repo = Path(args.repo).resolve()
    plan = load_plan(repo)
    # The interpreter that runs graphify's code is never taken from the plan file: it is re-resolved and must match.
    _, python = find_graphify(args.graphify_bin)
    if python != plan["graphify_python"]:
        raise SemanticError(f"the plan was made with a different graphify interpreter ({plan['graphify_python']}) than the one found now ({python}); run `plan` again")
    reports = validate_plan(repo, plan)
    sem_nodes, sem_edges, sem_hyper, merged_nums, skipped = [], [], [], [], []
    for r in reports:
        if not r["valid"]:
            skipped.append(r["num"])
            sys.stderr.write(f"gentle_lite.graph.semantic_plan: skipping chunk {r['num']}: {'; '.join(r['errors'][:3])}\n")
            continue
        merged_nums.append(r["num"])
        sem_nodes += r["data"]["nodes"]
        sem_edges += r["data"].get("edges", [])
        sem_hyper += r["data"].get("hyperedges") or []
    try:
        cached = clean_cached(_read_json(cached_file(repo), "cached results"))
    except SemanticError:
        cached = clean_cached(None)
    existing, before = load_existing(repo)
    report = {"repo": str(repo), "chunks_merged": merged_nums, "chunks_skipped": skipped, "nodes_before": before,
              "edges_before": len(existing["edges"]), "nodes_after": before, "edges_after": len(existing["edges"]), "written": False, "synced": False}
    if not merged_nums and not cached.get("nodes"):
        return report, EXIT_NO_VALID if skipped else 0
    semantic = {"nodes": _stamp(sem_nodes), "edges": _stamp(sem_edges), "hyperedges": _stamp(sem_hyper)}
    extra = {"nodes": _stamp(cached["nodes"]), "edges": _stamp(cached["edges"]), "hyperedges": _stamp(cached["hyperedges"])}
    extraction = merge_extraction(merge_extraction(existing, extra), semantic)
    result = run_worker(python, "merge", {
        "repo": str(repo), "graph": str(out_dir(repo) / "graph.json"), "extraction": extraction, "semantic": semantic,
        "allowed": plan["all_files"], "mode": plan.get("mode")})
    report.update(written=result["written"], nodes_after=result["nodes"] if result["written"] else before,
                  edges_after=result["edges"] if result["written"] else report["edges_before"], cache_entries=result["cache_entries"])
    if not result["written"]:
        sys.stderr.write("gentle_lite.graph.semantic_plan: graphify refused to overwrite graph.json (shrink guard); nothing else was changed\n")
        return report, EXIT_REFUSED
    if not args.no_sync:
        conn = mstore.connect(paths.db_path())
        try:
            sync.sync_repo(conn, str(repo), None, args.semantic_model)
        finally:
            conn.close()
        report["synced"] = True
        report["semantic_model"] = args.semantic_model
    return report, 0


# ------------------------------------------------------------------------------------------------------------ CLI

def build_parser():
    p = argparse.ArgumentParser(prog="gentle_lite.graph.semantic_plan", description="Plan, validate and merge an in-session semantic pass.")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, text in (("plan", "run graphify update, chunk the documents still needing extraction, render prompt files"),
                       ("validate", "check the chunk files the subagents wrote"), ("merge", "merge valid chunks into graph.json and sync")):
        s = sub.add_parser(name, help=text)
        s.add_argument("--repo", default=".")
        if name == "plan":
            s.add_argument("--graphify-bin", help="graphify executable (default: first on PATH)")
            s.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE, help="maximum files per chunk (default 25)")
            s.add_argument("--deep", action="store_true", help="aggressive INFERRED edges, separate cache namespace")
            s.add_argument("--skip-update", action="store_true", help="do not run `graphify update` first")
        if name == "merge":
            s.add_argument("--graphify-bin", help="graphify executable (default: first on PATH); must run the plan's interpreter")
            s.add_argument("--semantic-model", default=DEFAULT_MODEL, help="recorded in the sync (default claude-haiku-5-5)")
            s.add_argument("--no-sync", action="store_true", help="do not mirror into memory.db")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.cmd == "plan":
            if args.chunk_size < 1:
                raise SemanticError("--chunk-size must be at least 1")
            with graphify_lock(Path(args.repo).resolve()):
                result, code = cmd_plan(args), 0
        elif args.cmd == "validate":
            result, code = cmd_validate(args)
        else:
            with graphify_lock(Path(args.repo).resolve()):
                result, code = cmd_merge(args)
    except (SemanticError, sync.GraphError, LockHeld) as err:
        sys.stderr.write(f"gentle_lite.graph.semantic_plan: {err}\n")
        return EXIT_ERROR
    sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
