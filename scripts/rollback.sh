#!/usr/bin/env bash
# Undo scripts/migrate.sh from its backup.
#
#   scripts/rollback.sh ~/gentle-lite-migration/<timestamp>
#
# Restores the Claude Code config paths, only the mcpServers key of ~/.claude.json, ~/.gentle-ai and ~/.engram,
# and re-enables engram@engram. The backup directory is kept and marked rolled-back. ~/.claude/projects (your conversations) is never touched. Everything it replaces is
# moved aside under ~/gentle-lite-migration/rollbacks/<timestamp>/, never deleted. Run with Claude Code closed.
# --assume-yes answers yes to every prompt and exists ONLY for the automated tests.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(dirname "$SCRIPT_DIR")
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

BACKUP_DIR=""
while (($#)); do
  case $1 in
    --assume-yes) ASSUME_YES=1 ;; # test-only
    -h | --help)
      sed -n '2,/^set -/{/^set -/!p}' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) die "unknown argument: $1 (try --help)" ;;
    *) [[ -z $BACKUP_DIR ]] || die "only one backup directory"; BACKUP_DIR=$1 ;;
  esac
  shift
done
[[ -n $BACKUP_DIR ]] || die "usage: scripts/rollback.sh <backup-dir>"
BACKUP_DIR=$(cd "$BACKUP_DIR" && pwd) || die "no such directory"
ARCHIVE=$BACKUP_DIR/backup.tar.gz
[[ -f $ARCHIVE && -f $ARCHIVE.sha256 ]] || die "$BACKUP_DIR has no backup.tar.gz with its .sha256"

isolate_to_home
need_cmd node || die "node is required"
need_cmd python3 || die "python3 is required"
need_cmd claude || die "claude CLI is required"

log "Verifying the archive checksum..."
(cd "$BACKUP_DIR" && sha256sum -c --quiet backup.tar.gz.sha256) || die "backup.tar.gz does not match its sha256. Refusing to restore; nothing was changed."
log "   ok   sha256 matches"

ITEMS=(.claude/CLAUDE.md .claude/settings.json .claude/settings.local.json .claude/agents .claude/skills .claude/commands .claude/output-styles .claude/themes .claude/plugins .gentle-ai .engram)
tar -tzf "$ARCHIVE" >"$BACKUP_DIR/rollback.list.tmp" || die "archive is unreadable"
present=()
for item in "${ITEMS[@]}"; do
  if grep -Eq -- "^$(printf '%s' "$item" | sed 's/[.[\*^$]/\\&/g')(/|\$)" "$BACKUP_DIR/rollback.list.tmp"; then present+=("$item"); fi
done
has_json=0
grep -Fxq -- .claude.json "$BACKUP_DIR/rollback.list.tmp" && has_json=1
rm -f "$BACKUP_DIR/rollback.list.tmp"

TS=$(date +%Y%m%d-%H%M%S)
ASIDE=$HOME/gentle-lite-migration/rollbacks/$TS
log ""
log "Plan:"
log "   1. gentle-lite uninstall"
log "   2. restore from backup: ${present[*]:-nothing}"
((has_json)) && log "   3. restore only the mcpServers key of ~/.claude.json"
log "   4. verify sha256 of the restored files"
log "   5. claude plugin enable engram@engram --scope user"
log "   Replaced files are moved to $ASIDE (not deleted). ~/.claude/projects is not touched."
confirm "Roll back now?" || {
  log "Nothing was changed."
  exit 3
}

mkdir -p "$ASIDE"
chmod 700 "$HOME/gentle-lite-migration" "$HOME/gentle-lite-migration/rollbacks" "$ASIDE"
exec > >(tee -a "$ASIDE/rollback.log") 2>&1

# Extract first: if the archive cannot be read, nothing has been uninstalled yet.
STAGE=$ASIDE/stage
mkdir -p "$STAGE"
members=("${present[@]}")
((has_json)) && members+=(.claude.json)
tar --same-permissions -xzf "$ARCHIVE" -C "$STAGE" -- "${members[@]}" || die "could not extract the backup. Nothing was changed."

# gentle-lite may never have been installed (the migration stopped before phase 5): that is not a reason to stop.
log "== gentle-lite uninstall"
with_caller_umask node "$REPO_DIR/bin/gentle-lite.js" uninstall || warn "gentle-lite uninstall failed or had nothing to remove; continuing with the restore"

log "== restore"
for item in "${present[@]}"; do
  mv_aside "$HOME/$item" "$ASIDE/replaced"
  with_caller_umask mkdir -p "$(dirname "$HOME/$item")"
  cp -a "$STAGE/$item" "$HOME/$item"
  log "   restored $item"
done

if ((has_json)); then
  python3 -P - "$STAGE/.claude.json" "$HOME/.claude.json" "$ASIDE/replaced" <<'PY'
import json, os, shutil, sys, tempfile
backup_path, live_path, aside = sys.argv[1:4]
backup = json.load(open(backup_path))
try:
    live = json.load(open(live_path))
except FileNotFoundError:
    live = {}
else:
    os.makedirs(aside, exist_ok=True)
    shutil.copy2(live_path, os.path.join(aside, "claude.json"))
if "mcpServers" in backup:
    live["mcpServers"] = backup["mcpServers"]
else:
    live.pop("mcpServers", None)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(live_path), prefix=".claude.json.")
with os.fdopen(fd, "w") as f:
    json.dump(live, f, indent=2)
    f.write("\n")
if os.path.exists(live_path):
    shutil.copymode(live_path, tmp)
os.replace(tmp, live_path)
check = json.load(open(live_path))
assert check.get("mcpServers") == backup.get("mcpServers"), "mcpServers mismatch after restore"
print("   restored mcpServers in ~/.claude.json (other keys untouched)")
PY
fi

log "== verify sha256 of restored files"
(cd "$STAGE" && find "${present[@]}" -type f -print0 | sort -z | xargs -0 -r sha256sum >"$ASIDE/restored.sha256")
count=$(wc -l <"$ASIDE/restored.sha256")
(cd "$HOME" && sha256sum -c --quiet "$ASIDE/restored.sha256") || die "sha256 mismatch after restore. See $ASIDE; nothing else was removed."
log "   ok   sha256 verified for $count file(s)"

# Verified first: "plugin enable" rewrites user-scope plugin state under ~/.claude and would trip the check above.
log "== re-enable engram plugin"
with_caller_umask claude plugin enable engram@engram --scope user || warn "could not enable engram@engram; run: claude plugin enable engram@engram --scope user"

# The migration is no longer in effect. Its backup and markers stay as they were (it is the only pre-migration copy);
# the marker tells migrate.sh to start a NEW run directory next time instead of reusing this one.
: >"$BACKUP_DIR/rolled-back"
log ""
log "Rollback complete. Start Claude Code again. Replaced files are in $ASIDE."
