"""The shape of a pipeline (ADR 0011): step ids, `needs`, blocks, sub-pipeline steps, cycles and levels.

A step without `id` is `s<n>`; without `needs` it needs the step before it, so a pipeline written for 0.6 stays a
line. `needs: []` makes a step a root that may run beside others. A step `{"use": "<block>", ...}` starts from that
block of the file's `blocks` and overrides its fields. A step `{"type": "pipeline", "pipeline": "<id>"}` is replaced by
that pipeline's steps, ids prefixed with the step's id; its roots need what the step needs, and whoever needs the step
needs the expansion's last steps. The expanded steps take the modes of the step that uses them. Pure functions: the
caller validates each step's own fields (`make_step`) and turns GraphError into its own error.
"""

import re

STEP_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")


class GraphError(ValueError):
    pass


def apply_blocks(pid, raw, blocks):
    """Steps with `use` merged over their block (the step's own fields win)."""
    out = []
    for i, s in enumerate(raw):
        if isinstance(s, dict) and "use" in s:
            block = blocks.get(s["use"]) if isinstance(s["use"], str) else None
            if not isinstance(block, dict):
                raise GraphError(f"{pid}: step {i + 1} uses {s['use']!r}, which is not in blocks")
            if {"use", "id", "needs"} & set(block):
                raise GraphError(f"block {s['use']}: a block holds step fields only (no use, id or needs)")
            s = {**block, **{k: v for k, v in s.items() if k != "use"}}
        out.append(s)
    return out


def with_ids(pid, raw):
    """Every step gets an id, a name and its needs (by default the step before it)."""
    out, seen, prev = [], set(), None
    for i, s in enumerate(raw):
        if not isinstance(s, dict):
            raise GraphError(f"{pid}: step {i + 1} must be an object")
        sid = s.get("id", f"s{i + 1}")
        if not isinstance(sid, str) or not STEP_ID.match(sid):
            raise GraphError(f"{pid}: step {i + 1}: an id is lowercase letters, digits, '-' and '_'")
        if sid in seen:
            raise GraphError(f"{pid}: duplicate step id {sid}")
        needs = s.get("needs", [prev] if prev else [])
        if not isinstance(needs, list) or not all(isinstance(n, str) for n in needs):
            raise GraphError(f"{pid}: step {sid}: needs must be a list of step ids")
        name = s.get("name") or (sid if "id" in s else f"Step {i + 1}")
        out.append({**s, "id": sid, "name": name, "needs": list(dict.fromkeys(needs))})
        seen.add(sid)
        prev = sid
    return out


def _inline(s, inner):
    """The steps of a used pipeline, renamed under the step `s` that uses it, and the ids that end the expansion."""
    needed = {n for t in inner for n in t["needs"]}
    steps = [{**t, "id": f"{s['id']}.{t['id']}", "name": f"{s['name']} › {t['name']}", "modes": s.get("modes"),
              "needs": [f"{s['id']}.{n}" for n in t["needs"]] or list(s["needs"])} for t in inner]
    return steps, [f"{s['id']}.{t['id']}" for t in inner if t["id"] not in needed]


def expand(pid, by_id, make_step, stack=()):
    """The flat steps of pipeline `pid` (sub-pipeline steps replaced), each made by `make_step(index, raw)`."""
    if pid in stack:
        raise GraphError(f"pipelines use each other in a loop: {' > '.join([*stack, pid])}")
    if pid not in by_id:
        raise GraphError(f"{stack[-1] if stack else pid}: there is no pipeline {pid!r} to use")
    flat, ends = [], {}
    for i, s in enumerate(by_id[pid]):
        if s.get("type") == "pipeline":
            inner = expand(s.get("pipeline") if isinstance(s.get("pipeline"), str) else "", by_id, make_step, (*stack, pid))
            steps, ends[s["id"]] = _inline(s, inner)
            flat += steps
        else:
            flat.append({**make_step(i, s), "id": s["id"], "needs": s["needs"], "modes": s.get("modes")})
    for t in flat:  # a need on a sub-pipeline step means its last steps
        t["needs"] = list(dict.fromkeys(m for n in t["needs"] for m in ends.get(n, [n])))
    return flat


def levels(steps):
    """Step ids by level: every step of a level needs only steps of earlier levels. GraphError on a loop or unknown id."""
    ids = [s["id"] for s in steps]
    for s in steps:
        for n in s["needs"]:
            if n not in ids or n == s["id"]:
                raise GraphError(f"step {s['id']} needs {n!r}, which is not an earlier or other step of this pipeline")
    done, out = set(), []
    while len(done) < len(ids):
        level = [s["id"] for s in steps if s["id"] not in done and set(s["needs"]) <= done]
        if not level:
            raise GraphError(f"steps need each other in a loop: {', '.join(i for i in ids if i not in done)}")
        out.append(level)
        done |= set(level)
    return out
