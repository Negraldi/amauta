# shellcheck shell=bash
# Shared helpers for migrate.sh and rollback.sh. Sourced, never run directly.

ASSUME_YES=0 # test-only: answer yes to every prompt. Never use it on a real run.

log() { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

# confirm "question": returns 0 only on an explicit y/yes (or ASSUME_YES). EOF or anything else is no.
confirm() {
  if [[ $ASSUME_YES == 1 ]]; then
    log "[auto-yes, test only] $1"
    return 0
  fi
  local answer=""
  read -r -p "$1 [y/N] " answer || answer=n
  [[ $answer == y || $answer == Y || $answer == yes ]]
}

# Never leave a name in the environment that would redirect gentle-lite away from $HOME.
isolate_to_home() {
  unset GENTLE_LITE_CLAUDE_HOME GENTLE_LITE_CLAUDE_JSON GENTLE_LITE_STATE_DIR
}

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# Move a path aside (never delete it): mv_aside <path> <aside-root>
mv_aside() {
  local src=$1 root=$2 rel
  [[ -e $src || -L $src ]] || return 0
  rel=${src#"$HOME"/}
  mkdir -p "$root/$(dirname "$rel")"
  mv "$src" "$root/$rel"
}
