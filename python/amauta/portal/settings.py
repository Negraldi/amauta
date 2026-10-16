"""Settings editor backend: a CLOSED list of harness options, changed only by running the installer.

Nothing here edits a file of the harness. Preview = `amauta install --dry-run --json`, apply = the same arguments for
real, undo = `amauta restore --backup <id>`. Values come from fixed sets and reach the installer as separate argv
entries (no shell, no path built from input). Every apply is appended to a small log in the state dir, and only
backups named in that log can be undone.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

PERSONAS = ("gentleman", "neutral")
ONOFF = ("on", "off")
MODULES = ("sdd", "rea", "context7", "impeccable", "archify")
TOP_KEYS = {"persona", "review_mode", "telemetry", "modules", "repair"}
TOKEN_TTL = 300.0  # seconds an apply token stays valid
MAX_PENDING = 8
PREVIEW_TIMEOUT = 60
APPLY_TIMEOUT = 330  # impeccable's pinned npm engine can take minutes on a cold install
OUTPUT_CAP = 1_000_000
LOG_NAME = "portal-settings.log"
ENV_KEEP = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "AMAUTA_CLAUDE_HOME", "AMAUTA_CLAUDE_JSON", "AMAUTA_STATE_DIR")
REPO_ROOT = Path(__file__).resolve().parents[3]


class SettingsError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra

    def body(self):
        return {"error": self.message, **self.extra}


def _hash_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return "absent"


def _onoff(flag) -> str:
    return "on" if flag is True else "off"


def validate(body, current: dict) -> dict:
    """Closed schema: returns the full desired set (missing keys keep their current value) or raises SettingsError(400)."""
    if not isinstance(body, dict):
        raise SettingsError(400, "body must be a JSON object")
    unknown = sorted(set(body) - TOP_KEYS)
    if unknown:
        raise SettingsError(400, f"unknown setting: {unknown[0][:40]}")
    desired = {"persona": current["persona"], "review_mode": current["review_mode"], "telemetry": current["telemetry"], "modules": dict(current["modules"])}
    if "persona" in body:
        if body["persona"] not in PERSONAS:
            raise SettingsError(400, "persona must be gentleman or neutral")
        desired["persona"] = body["persona"]
    for key in ("review_mode", "telemetry"):
        if key in body:
            if body[key] not in ONOFF:
                raise SettingsError(400, f"{key} must be on or off")
            desired[key] = body[key]
    if "modules" in body:
        mods = body["modules"]
        if not isinstance(mods, dict):
            raise SettingsError(400, "modules must be an object")
        for name, value in mods.items():
            if name not in MODULES:
                raise SettingsError(400, f"unknown module: {str(name)[:40]}")
            if value not in ONOFF:
                raise SettingsError(400, f"module {name} must be on or off")
            desired["modules"][name] = value
    if "repair" in body and body["repair"] is not True and body["repair"] is not False:
        raise SettingsError(400, "repair must be true or false")
    desired["repair"] = body.get("repair") is True
    return desired


def _canonical(desired: dict) -> str:
    return json.dumps(desired, sort_keys=True, separators=(",", ":"))


class Settings:
    def __init__(self, cfg, installer=None, clock=time.monotonic):
        self.cfg = cfg
        self._installer = installer  # argv prefix; default = node + this checkout's bin/amauta.js
        self._clock = clock
        self._tokens: dict[str, tuple[str, str, float]] = {}
        self._tokens_lock = threading.Lock()
        self._apply_lock = threading.Lock()

    # ---- state ----------------------------------------------------------------------------
    @property
    def state_path(self) -> Path:
        return self.cfg.state_dir / "state.json"

    def _state(self):
        try:
            data = json.loads(self.state_path.read_text())
            return data if isinstance(data, dict) else None
        except (OSError, ValueError):
            return None

    def state_hash(self) -> str:
        return _hash_file(self.state_path)

    def current(self) -> dict:
        state = self._state()
        s = state or {}
        persona = s.get("persona") if s.get("persona") in PERSONAS else "gentleman"
        return {
            "persona": persona,
            "review_mode": "on" if s.get("rdd_mode") == "on" else "off",
            "telemetry": "off" if (state is not None and s.get("telemetry") is False) else "on",
            "modules": {m: _onoff(s.get(m)) for m in MODULES},
        }

    def describe(self) -> dict:
        eligible = self._undo_candidate()
        return {
            "installed": self._state() is not None,
            "current": self.current(),
            "allowed": {"persona": list(PERSONAS), "review_mode": list(ONOFF), "telemetry": list(ONOFF), "modules": list(MODULES), "module_values": list(ONOFF)},
            "undo": {"available": eligible is not None, "backup": eligible["backup"] if eligible else None, "ts": eligible["ts"] if eligible else None},
        }

    # ---- installer ------------------------------------------------------------------------
    def _argv(self, desired: dict, *, dry_run: bool) -> list:
        argv = [*self._installer_prefix(), "install", "--json", *self._targets(), "--persona", desired["persona"], "--review-mode", desired["review_mode"]]
        if dry_run:
            argv.append("--dry-run")
        if desired["telemetry"] == "off":
            argv.append("--no-telemetry")
        for name in MODULES:
            argv.append(f"--with-{name}" if desired["modules"][name] == "on" else f"--without-{name}")
        return argv

    def _targets(self) -> list:
        out = ["--claude-home", str(self.cfg.claude_home), "--state-dir", str(self.cfg.state_dir)]
        claude_json = os.environ.get("AMAUTA_CLAUDE_JSON") or (self._state() or {}).get("claude_json")
        if isinstance(claude_json, str) and claude_json:
            out += ["--claude-json", claude_json]
        return out

    def _run(self, argv: list, timeout: int) -> dict:
        env = {k: os.environ[k] for k in ENV_KEEP if k in os.environ}
        try:
            r = subprocess.run(argv, shell=False, env=env, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            raise SettingsError(504, f"the installer did not finish within {timeout} seconds") from None
        except OSError as err:
            raise SettingsError(503, f"the installer could not be started: {err.strerror or 'error'}") from None
        out = (r.stdout or "")[:OUTPUT_CAP]
        if r.returncode != 0:
            tail = ((r.stderr or "") or out).strip().splitlines()[-3:]
            raise SettingsError(502, "the installer reported a problem", detail=" | ".join(tail)[:600])
        try:
            data = json.loads(out.strip().splitlines()[-1])
        except (ValueError, IndexError):
            raise SettingsError(502, "the installer printed something unexpected") from None
        if not isinstance(data, dict):
            raise SettingsError(502, "the installer printed something unexpected")
        return data

    # ---- preview --------------------------------------------------------------------------
    def preview(self, body) -> dict:
        current = self.current()
        desired = validate(body, current)
        plan = self._run(self._argv(desired, dry_run=True), PREVIEW_TIMEOUT)
        state_hash = self.state_hash()
        token = secrets.token_urlsafe(32)
        with self._tokens_lock:
            now = self._clock()
            for t in [t for t, (_, _, exp) in self._tokens.items() if exp <= now]:
                del self._tokens[t]
            while len(self._tokens) >= MAX_PENDING:
                del self._tokens[min(self._tokens, key=lambda t: self._tokens[t][2])]
            self._tokens[token] = (_canonical(desired), state_hash, now + TOKEN_TTL)
        changes = [{"key": k, "from": current[k], "to": desired[k]} for k in ("persona", "review_mode", "telemetry") if current[k] != desired[k]]
        changes += [{"key": f"module:{m}", "from": current["modules"][m], "to": desired["modules"][m]} for m in MODULES if current["modules"][m] != desired["modules"][m]]
        return {
            "changes": changes,
            "repair": desired["repair"],
            "plan": {k: plan.get(k) for k in ("changed", "files", "removed", "skipped", "state_changes", "impeccable") if k in plan},
            "apply_token": token,
            "expires_in": int(TOKEN_TTL),
        }

    # ---- apply ----------------------------------------------------------------------------
    def _take_token(self, token) -> tuple[dict, str]:
        if not isinstance(token, str) or not token:
            raise SettingsError(400, "apply_token is required")
        with self._tokens_lock:
            entry = self._tokens.pop(token, None)  # one use: popped before anything else can fail
        if entry is None or entry[2] <= self._clock():
            raise SettingsError(400, "the preview expired or was already used, preview again")
        return json.loads(entry[0]), entry[1]

    def apply(self, body) -> dict:
        if not isinstance(body, dict) or set(body) - {"apply_token", "confirm"}:
            raise SettingsError(400, "body must be {apply_token, confirm}")
        if body.get("confirm") is not True:
            raise SettingsError(400, "confirm must be true")
        desired, preview_hash = self._take_token(body.get("apply_token"))
        desired = self._revalidate(desired)
        if not self._apply_lock.acquire(blocking=False):
            raise SettingsError(409, "another change is being applied, try again in a moment")
        try:
            if self.state_hash() != preview_hash:
                raise SettingsError(409, "settings changed since the preview, preview again")
            before = self.current()
            result = self._run(self._argv(desired, dry_run=False), APPLY_TIMEOUT)
            backup = result.get("backup")
            backup_id = os.path.basename(backup) if isinstance(backup, str) and backup else None
            after = self.state_hash()
            self._log({"action": "apply", "ts": _now(), "changes": result.get("state_changes") or {}, "from": before, "to": {k: desired[k] for k in ("persona", "review_mode", "telemetry", "modules")},
                       "backup": backup_id, "state_hash_after": after})
            out = {"ok": True, "backup": backup_id, "changed": bool(result.get("changed")), "files": result.get("files") or [], "removed": result.get("removed") or [],
                   "skipped": result.get("skipped") or [], "state_changes": result.get("state_changes") or {}, "undo_available": backup_id is not None}
            if isinstance(result.get("impeccable"), dict):
                out["impeccable"] = result["impeccable"]
            return out
        finally:
            self._apply_lock.release()

    def _revalidate(self, desired: dict) -> dict:
        # The stored set was produced by `validate`; checking it again against the closed lists keeps apply independent of the preview code path.
        check = validate({k: desired[k] for k in ("persona", "review_mode", "telemetry", "modules")} | {"repair": desired.get("repair") is True}, self.current())
        if _canonical(check) != _canonical(desired):
            raise SettingsError(400, "the stored preview is not valid, preview again")
        return check

    # ---- undo -----------------------------------------------------------------------------
    def _log_path(self) -> Path:
        return self.cfg.state_dir / LOG_NAME

    def _log(self, entry: dict) -> None:
        self.cfg.state_dir.mkdir(parents=True, exist_ok=True)
        with open(self._log_path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")

    def _entries(self) -> list:
        try:
            lines = self._log_path().read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        out = []
        for line in lines:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if isinstance(e, dict):
                out.append(e)
        return out

    def _undo_candidate(self):
        """Newest portal apply that has a backup and was not undone yet; only backups named in the log are ever eligible."""
        undone = set()
        for e in reversed(self._entries()):
            if e.get("action") == "undo":
                undone.add(e.get("backup"))
            elif e.get("action") == "apply" and e.get("backup") and e["backup"] not in undone:
                return e
        return None

    def undo(self, body) -> dict:
        if not isinstance(body, dict) or set(body) - {"confirm"} or body.get("confirm") is not True:
            raise SettingsError(400, "body must be {confirm: true}")
        if not self._apply_lock.acquire(blocking=False):
            raise SettingsError(409, "another change is being applied, try again in a moment")
        try:
            entry = self._undo_candidate()
            if entry is None:
                raise SettingsError(409, "there is no portal change to undo")
            if self.state_hash() != entry.get("state_hash_after"):
                raise SettingsError(409, "the harness changed after that apply (another install or edit), so undo was refused")
            argv = [*self._installer_prefix(), "restore", "--json", *self._targets(), "--backup", entry["backup"]]
            result = self._run(argv, PREVIEW_TIMEOUT)
            self._log({"action": "undo", "ts": _now(), "backup": entry["backup"], "restored": len(result.get("restored") or [])})
            return {"ok": True, "backup": entry["backup"], "restored": result.get("restored") or []}
        finally:
            self._apply_lock.release()

    def _installer_prefix(self) -> list:
        if self._installer is not None:
            return list(self._installer)
        node = shutil.which("node")
        if node is None:
            raise SettingsError(503, "node was not found on PATH, so the installer cannot run")
        return [node, str(REPO_ROOT / "bin" / "amauta.js")]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
