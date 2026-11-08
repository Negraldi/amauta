"""The privacy hook: `PreToolUse` on reads asks before a data file reaches the model; `UserPromptSubmit` warns when a
prompt looks like it holds a secret. Never denies, never echoes, and fails open on bad input (empty stdout)."""

import json
import os
import sys

from ..detectors import scan
from . import paths

READ_TOOLS = {"Read": "file_path", "NotebookRead": "notebook_path", "NotebookEdit": "notebook_path"}


def _ask(path):
    reason = (f"amauta privacy: {os.path.basename(path)} looks like a data file. Its contents would be sent to the model; "
              "allow only if that is fine for this data, or work on a redacted or pseudonymized copy (amauta privacy).")
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask", "permissionDecisionReason": reason}}


def _warn(prompt):
    found = scan.scan(prompt, kinds={"secret"})
    if not found:
        return None
    n = len(found)
    return {"systemMessage": f"amauta privacy: the prompt seems to contain {n} secret{'s' if n != 1 else ''} (a key or token). "
                             "It was sent as written; rotate it if it is real."}


def decide(payload, state_dir):
    event = payload.get("hook_event_name")
    if event == "PreToolUse":
        key = READ_TOOLS.get(payload.get("tool_name"))
        target = (payload.get("tool_input") or {}).get(key) if key else None
        return _ask(target) if paths.is_data_file(target, paths.configured(state_dir)) else None
    if event == "UserPromptSubmit" and isinstance(payload.get("prompt"), str):
        return _warn(payload["prompt"])
    return None


def run(raw, state_dir):
    try:
        payload = json.loads(raw)
        decision = decide(payload, state_dir) if isinstance(payload, dict) else None
    except Exception:  # fail open: no decision
        return 0
    if decision:
        sys.stdout.write(json.dumps(decision) + "\n")
    return 0
