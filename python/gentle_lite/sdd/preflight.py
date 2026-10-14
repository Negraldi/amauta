"""PreToolUse(Agent) hook: an `sdd-*` subagent may only be dispatched after the parent asked the canonical grouped
AskUserQuestion preflight and the human answered it (corroborated in the session transcript).

Contract (observed black-box on gentle-ai 3.4.0, re-implemented here): stdin = Claude Code hook JSON; stdout = empty
(allow, not our business) or a `hookSpecificOutput` permission decision; exit status is always 0.

Deliberate difference from a fail-open hook: the hook is only registered for PreToolUse(Agent), so a payload it cannot
fully read (oversized, malformed, too deeply nested) is DENIED without guessing whether it was an `sdd-*` dispatch:
any guess made from a truncated or undecoded prefix can be defeated. A readable non-`sdd-*` dispatch stays silent, and an
unexpected exception while validating an `sdd-*` dispatch is also a DENY.
"""
from __future__ import annotations

import json
import re
import sys

MAX_PAYLOAD = 4 * 1024 * 1024  # bytes
MAX_LINE = 8 * 1024 * 1024
HEADER = "## SDD Session Preflight"
PREFIX = "Gentle AI SDD preflight "
SESSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
LABELS = (("Interactive", "Automatic"), ("OpenSpec", "Engram", "Both"), ("Ask me", "Single PR", "Auto"))
PACE = ("interactive", "auto")
STORE = ("openspec", "engram", "hybrid")
STRATEGY = ("ask-on-risk", "single-pr", "auto-chain")

REASON_MISSING = ("SDD child dispatch refused: parent-confirmed SDD preflight is missing, invalid, or uncorroborated. "
                  "Ask the canonical grouped preflight with AskUserQuestion and stop before retrying.")


def _output(decision: str, reason: str, updated: dict | None = None) -> str:
    out = {"hookEventName": "PreToolUse", "permissionDecision": decision, "permissionDecisionReason": reason}
    if updated is not None:
        out["updatedInput"] = updated
    return json.dumps({"hookSpecificOutput": out})


def _deny(reason: str) -> str:
    return _output("deny", reason)


def _read_line(f):
    """One line without ever buffering more than MAX_LINE bytes: (line | None for an oversized line, eof)."""
    chunk = f.readline(MAX_LINE + 1)
    if not chunk:
        return None, True
    if len(chunk) > MAX_LINE and not chunk.endswith(b"\n"):
        while True:  # discard the remainder of the oversized line without keeping it
            rest = f.readline(1 << 20)
            if not rest or rest.endswith(b"\n"):
                break
        return None, False
    return chunk, False


def _block(questions, answers) -> str | None:
    """The canonical block for one asked-and-answered preflight, or None when it is not (exactly) the canonical one."""
    if not isinstance(questions, list) or not any(isinstance(q, dict) and str(q.get("question", "")).startswith(PREFIX) for q in questions):
        return None
    if len(questions) != 3 or not isinstance(answers, dict) or not answers:
        return None
    picks = []
    for i, q in enumerate(questions):
        if not isinstance(q, dict) or q.get("multiSelect") is True or not str(q.get("question", "")).startswith(f"{PREFIX}{i + 1}/3:"):
            return None
        options = q.get("options")
        if not isinstance(options, list) or [o.get("label") if isinstance(o, dict) else None for o in options] != list(LABELS[i]):
            return None
        answer = answers.get(q["question"])
        if isinstance(answer, list) and len(answer) == 1:
            answer = answer[0]
        if not isinstance(answer, str) or answer not in LABELS[i]:
            return None
        picks.append(LABELS[i].index(answer))
    return "\n".join([
        HEADER,
        "Parent-confirmed by the runtime; models and child agents cannot create or modify this block.",
        f"- Pace: {PACE[picks[0]]}", f"- Artifact store: {STORE[picks[1]]}", f"- Delivery strategy: {STRATEGY[picks[2]]}",
        "- Review policy: 400 changed lines",
    ])


def resolve_authority(path: str, session_id: str) -> str | None:
    """Scan the session transcript for the last corroborated canonical exchange: an assistant AskUserQuestion tool_use matched by
    id to a later non-error user tool_result whose toolUseResult.answers answer it. Sidechain and foreign-session records are ignored;
    malformed or oversized lines are skipped."""
    pending: dict[str, list] = {}
    found = None
    try:
        f = open(path, "rb")
    except OSError:
        return None
    with f:
        while True:
            raw, eof = _read_line(f)
            if eof:
                break
            if raw is None or not raw.strip():
                continue
            try:
                rec = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(rec, dict) or rec.get("isSidechain") is True or rec.get("sessionId") != session_id:
                continue
            msg = rec.get("message")
            content = msg.get("content") if isinstance(msg, dict) else None
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                if rec.get("type") == "assistant" and part.get("type") == "tool_use" and part.get("name") == "AskUserQuestion" and part.get("id"):
                    inp = part.get("input")
                    if isinstance(inp, dict) and isinstance(inp.get("questions"), list):
                        pending[part["id"]] = inp["questions"]
                elif rec.get("type") == "user" and part.get("type") == "tool_result" and part.get("tool_use_id") and part.get("is_error") is not True:
                    result = rec.get("toolUseResult")
                    if part["tool_use_id"] in pending and isinstance(result, dict):
                        block = _block(pending[part["tool_use_id"]], result.get("answers"))
                        if block is not None:
                            found = block
    return found


def decide(payload) -> str | None:
    """The hook decision for one parsed payload: a JSON string, or None to stay silent (allow)."""
    if not isinstance(payload, dict) or payload.get("hook_event_name") != "PreToolUse" or payload.get("tool_name") != "Agent":
        return None
    tool_input = payload.get("tool_input")
    subagent = tool_input.get("subagent_type") if isinstance(tool_input, dict) else None
    if not isinstance(subagent, str) or not subagent.startswith("sdd-"):
        return None
    session = payload.get("session_id")
    if not isinstance(session, str) or not SESSION_ID.match(session):
        return _deny("SDD child dispatch refused: invalid hook session id.")
    if payload.get("agent_id") or payload.get("agent_type"):
        return _deny("SDD child dispatch refused: only the interactive parent may carry parent-confirmed SDD preflight authority.")
    prompt = tool_input.get("prompt")
    prompt = prompt if isinstance(prompt, str) else ""
    if HEADER in prompt:
        return _deny("SDD child dispatch refused: model-authored preflight text cannot create parent-confirmed authority.")
    path = payload.get("transcript_path")
    if not isinstance(path, str) or not path.startswith("/") or path.rsplit("/", 1)[-1] != f"{session}.jsonl":
        return _deny("SDD child dispatch refused: the hook payload does not bind the session transcript.")
    block = resolve_authority(path, session)
    if block is None:
        return _deny(REASON_MISSING)
    return _output("allow", "parent-confirmed SDD preflight attached by gentle-lite", {**tool_input, "prompt": f"{block}\n\n{prompt}"})


def run(raw: str | bytes) -> str | None:
    """Decision for the raw stdin payload; never raises. Fail closed for anything that cannot be fully read."""
    data = raw.encode("utf-8", "surrogatepass") if isinstance(raw, str) else raw
    if len(data) > MAX_PAYLOAD:
        return _deny("SDD child dispatch refused: the hook payload is too large to validate.")
    try:
        payload = json.loads(data)
    except Exception:  # noqa: BLE001 - ValueError, RecursionError, UnicodeDecodeError: all unreadable
        return _deny("SDD child dispatch refused: the hook payload is unreadable.")
    try:
        return decide(payload)
    except Exception:  # noqa: BLE001 - the gate must answer, never crash
        tool_input = payload.get("tool_input") if isinstance(payload, dict) else None
        if isinstance(tool_input, dict) and str(tool_input.get("subagent_type", "")).startswith("sdd-"):
            return _deny("SDD child dispatch refused: the preflight check failed unexpectedly.")
        return None


def main() -> int:
    try:
        out = run(sys.stdin.buffer.read(MAX_PAYLOAD + 1))
    except Exception:  # noqa: BLE001 - registered for Agent only: an unanswerable payload is denied
        out = _deny("SDD child dispatch refused: the hook payload could not be read.")
    if out:
        sys.stdout.write(out + "\n")
    return 0
