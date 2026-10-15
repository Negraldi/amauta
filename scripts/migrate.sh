#!/usr/bin/env bash
# Migrate Claude Code from gentle-ai to gentle-lite. Replaces, does not coexist.
#
#   scripts/migrate.sh              dry run: prints every action, changes nothing
#   scripts/migrate.sh --execute    does it, one y/N prompt per modifying phase
#
# Run it from a terminal with Claude Code closed. Backup and log: ~/gentle-lite-migration/<timestamp>/
# Undo: scripts/rollback.sh ~/gentle-lite-migration/<timestamp>
# --assume-yes answers yes to every prompt and exists ONLY for the automated tests.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(dirname "$SCRIPT_DIR")
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

EXECUTE=0
while (($#)); do
  case $1 in
    --execute) EXECUTE=1 ;;
    --assume-yes) ASSUME_YES=1 ;; # test-only
    -h | --help)
      sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

isolate_to_home
CLAUDE_HOME=$HOME/.claude
CLAUDE_JSON=$HOME/.claude.json
MIG_ROOT=$HOME/gentle-lite-migration
GL=(node "$REPO_DIR/bin/gentle-lite.js")
ENGRAM_DB=$HOME/.engram/engram.db
KEY_FILES=(.claude/CLAUDE.md .claude/settings.json .claude/settings.local.json .claude.json .engram/engram.db)
BACKUP_PATHS=(.claude .claude.json .gentle-ai .engram)

# ---- pick the run directory: resume an unfinished one, stop if the last one finished
RUN_DIR=""
latest=""
for d in "$MIG_ROOT"/[0-9]*/; do [[ -d $d ]] && latest=${d%/}; done
if [[ -n $latest && -e $latest/finished ]]; then
  log "Migration already completed ($latest). Nothing to do. To undo: scripts/rollback.sh $latest"
  exit 0
fi
if [[ $EXECUTE == 1 ]]; then
  RUN_DIR=${latest:-$MIG_ROOT/$(date +%Y%m%d-%H%M%S)}
  mkdir -p "$RUN_DIR"
  exec > >(tee -a "$RUN_DIR/migrate.log") 2>&1
  log "Run directory: $RUN_DIR"
else
  RUN_DIR=${latest:-$MIG_ROOT/<timestamp>}
  log "DRY RUN: nothing will be modified. Re-run with --execute to apply."
fi

phase_done() { [[ $EXECUTE == 1 && -e $RUN_DIR/phase$1.done ]]; }
mark_phase() { : >"$RUN_DIR/phase$1.done"; }
# begin_phase N "title": prints the header; returns 1 when the phase must be skipped.
begin_phase() {
  log ""
  log "== Phase $1: $2"
  if phase_done "$1"; then
    log "   already done, skipping"
    return 1
  fi
}
# gate "question": dry run -> never proceeds; execute -> asks. Declining stops the script (re-run resumes).
gate() {
  [[ $EXECUTE == 1 ]] || return 1
  confirm "$1" || {
    log "Stopped at your request. Re-run scripts/migrate.sh --execute to resume; finished phases are skipped."
    exit 3
  }
}

# ---------------------------------------------------------------- Phase 0
log ""
log "== Phase 0: preflight"
fail=0
if need_cmd node && (($(node -p 'process.versions.node.split(".")[0]') >= 22)); then log "   ok   node >= 22"; else log "   FAIL node >= 22 required"; fail=1; fi
if need_cmd python3 && python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then log "   ok   python3 >= 3.11"; else log "   FAIL python3 >= 3.11 required"; fail=1; fi
need_cmd gentle-ai && log "   ok   gentle-ai on PATH" || { log "   FAIL gentle-ai not found on PATH"; fail=1; }
need_cmd claude && log "   ok   claude on PATH" || { log "   FAIL claude not found on PATH"; fail=1; }
if need_cmd pgrep && pgrep -x claude >/dev/null 2>&1; then
  warn "Claude Code processes are running. Close them first: they rewrite ~/.claude.json and settings."
  if [[ $EXECUTE == 1 ]]; then confirm "Continue anyway?" || exit 3; fi
fi
if ((fail)); then
  [[ $EXECUTE == 1 ]] && die "preflight failed, nothing was modified"
  warn "preflight problems found (reported only, dry run)"
fi

# ---------------------------------------------------------------- Phase 1
if begin_phase 1 "backup ~/.claude (incl. projects), ~/.claude.json, ~/.gentle-ai, ~/.engram"; then
  present=()
  for p in "${BACKUP_PATHS[@]}"; do [[ -e $HOME/$p ]] && present+=("$p"); done
  log "   would archive: ${present[*]:-nothing} -> $RUN_DIR/backup.tar.gz (+ .sha256, tar -t verification)"
  if gate "Create the backup now?"; then
    ((${#present[@]})) || die "nothing to back up under $HOME"
    if ! tar -C "$HOME" -czf "$RUN_DIR/backup.tar.gz.partial" "${present[@]}"; then
      rm -f "$RUN_DIR/backup.tar.gz.partial"
      die "backup failed, nothing was modified"
    fi
    mv "$RUN_DIR/backup.tar.gz.partial" "$RUN_DIR/backup.tar.gz"
    (cd "$RUN_DIR" && sha256sum backup.tar.gz >backup.tar.gz.sha256)
    tar -tzf "$RUN_DIR/backup.tar.gz" >"$RUN_DIR/backup.list" || die "backup archive is unreadable"
    for k in "${KEY_FILES[@]}"; do
      [[ -e $HOME/$k ]] || continue
      grep -Fxq -- "$k" "$RUN_DIR/backup.list" || die "backup verification failed: $k is not in the archive"
    done
    (cd "$HOME" && for k in .claude/CLAUDE.md .claude/settings.json .claude/settings.local.json .claude.json; do [[ -f $k ]] && sha256sum "$k"; done) >"$RUN_DIR/pre.sha256" || true
    log "   backup ok: $(cut -c1-16 "$RUN_DIR/backup.tar.gz.sha256")... verified with tar -t"
    mark_phase 1
  fi
fi

# ---------------------------------------------------------------- Phase 2
if begin_phase 2 "import engram memory into ~/.gentle-lite (source is opened read-only)"; then
  log "   would run: python3 -P -m gentle_lite.memory import-engram --from $ENGRAM_DB"
  if gate "Import the engram database now?"; then
    if [[ -f $ENGRAM_DB ]]; then
      python3 -P - "$ENGRAM_DB" <<'PY'
import pathlib, sqlite3, sys
c = sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri() + "?mode=ro", uri=True)
have = {r[0] for r in c.execute("select name from sqlite_master where type='table'")}
for t in ("sessions", "observations", "user_prompts", "prompts"):
    if t in have:
        print(f"   source {t}: {c.execute(f'select count(*) from {t}').fetchone()[0]}")
PY
      PYTHONPATH=$REPO_DIR/python python3 -P -m gentle_lite.memory import-engram --from "$ENGRAM_DB" | sed 's/^/   imported /'
      log "   (a re-run imports 0: rows already imported are skipped)"
    else
      log "   no engram database at $ENGRAM_DB, nothing to import"
    fi
    mark_phase 2
  fi
fi

# ---------------------------------------------------------------- Phase 3
if begin_phase 3 "remove gentle-ai from Claude Code"; then
  log "   would run: gentle-ai telemetry disable"
  log "   would run: gentle-ai uninstall --agent claude-code   (gentle-ai asks for its own confirmation; type yes there)"
  log "   then verify no gentle-ai markers/hooks remain and list leftovers"
  if gate "Disable gentle-ai telemetry and uninstall gentle-ai from Claude Code now?"; then
    gentle-ai telemetry disable || warn "gentle-ai telemetry disable failed (continuing)"
    set +e
    gentle-ai uninstall --agent claude-code 2>&1 | tee "$RUN_DIR/uninstall.out"
    rc=${PIPESTATUS[0]}
    set -e
    if ((rc != 0)); then
      if grep -Eq 'not defined|unknown (flag|command)' "$RUN_DIR/uninstall.out"; then
        die "this gentle-ai ($(gentle-ai --version 2>&1 | head -1)) does not support 'uninstall --agent'. Update gentle-ai or remove it by hand, then re-run. Nothing after phase 3 was changed."
      fi
      die "gentle-ai uninstall did not complete (exit $rc). Nothing after phase 3 was changed; re-run to retry."
    fi
    bad=0
    if [[ -f $CLAUDE_HOME/CLAUDE.md && $(<"$CLAUDE_HOME/CLAUDE.md") == *'<!-- gentle-ai:'* ]]; then log "   FAIL gentle-ai sections remain in ~/.claude/CLAUDE.md"; bad=1; fi
    if [[ -f $CLAUDE_HOME/settings.json && $(<"$CLAUDE_HOME/settings.json") == *'gentle-ai '* ]]; then log "   FAIL gentle-ai hooks remain in ~/.claude/settings.json"; bad=1; fi
    for dir in agents skills commands; do
      for f in "$CLAUDE_HOME/$dir"/*gentle-ai* "$CLAUDE_HOME/$dir"/gentle-sdd* "$CLAUDE_HOME/$dir"/sdd-* "$CLAUDE_HOME/$dir"/jd-* "$CLAUDE_HOME/$dir"/judgment-day* "$CLAUDE_HOME/$dir"/review-*; do
        [[ -e $f ]] && log "   leftover (gentle-lite will skip a same-name file you own): ${f#"$HOME"/}"
      done
    done
    ((bad == 0)) || die "gentle-ai is not fully removed. Fix the items above by hand (the backup is in $RUN_DIR), then re-run."
    mark_phase 3
  fi
fi

# ---------------------------------------------------------------- Phase 4
if begin_phase 4 "disable the engram@engram Claude Code plugin (gentle-lite registers its own memory server)"; then
  log "   would run: claude plugin disable engram@engram --scope user"
  if gate "Disable the engram@engram plugin now?"; then
    claude plugin disable engram@engram --scope user || warn "could not disable engram@engram (already disabled?). Check '/plugin' later: two memory servers would conflict."
    mark_phase 4
  fi
fi

# ---------------------------------------------------------------- Phase 5
if begin_phase 5 "install gentle-lite"; then
  log "   would run: gentle-lite install --dry-run, then gentle-lite install --with-sdd --with-rea --with-context7"
  if gate "Show the install plan and install gentle-lite now?"; then
    "${GL[@]}" install --dry-run
    confirm "Install exactly that?" || {
      log "Stopped at your request. Re-run to resume."
      exit 3
    }
    "${GL[@]}" install --with-sdd --with-rea --with-context7
    mark_phase 5
  fi
fi

# ---------------------------------------------------------------- Phase 6
log ""
log "== Phase 6: verify"
if [[ $EXECUTE == 1 ]]; then
  problems=0
  "${GL[@]}" status || { log "   FAIL gentle-lite status reports problems"; problems=1; }
  if [[ $(<"$CLAUDE_HOME/CLAUDE.md") == *'<!-- gentle-ai:'* ]]; then log "   FAIL gentle-ai sections in CLAUDE.md"; problems=1; else log "   ok   no gentle-ai sections in CLAUDE.md"; fi
  if [[ $(<"$CLAUDE_HOME/settings.json") == *'gentle-ai '* ]]; then log "   FAIL gentle-ai hooks in settings.json"; problems=1; else log "   ok   no gentle-ai hooks in settings.json"; fi
  if [[ -f $RUN_DIR/pre.sha256 ]]; then
    if (cd "$HOME" && grep -F -- ' .claude/settings.local.json' "$RUN_DIR/pre.sha256" | sha256sum -c --quiet - 2>/dev/null) || ! grep -Fq ' .claude/settings.local.json' "$RUN_DIR/pre.sha256"; then
      log "   ok   settings.local.json unchanged"
    else
      log "   FAIL settings.local.json changed"
      problems=1
    fi
  fi
  smoke=$(PYTHONPATH=$REPO_DIR/python python3 -P - <<'PY'
from gentle_lite import paths
from gentle_lite.memory import store
s = store.Store(paths.db_path())
n = s.conn.execute("select count(*) from observations").fetchone()[0]
row = s.conn.execute("select title from observations where deleted_at is null and title is not null limit 1").fetchone()
words = row[0].split() if row else []
hits = len(s.search(words[0])) if words else 0
print(n, hits)
PY
  ) || smoke=""
  read -r n hits <<<"$smoke"
  if [[ -n ${n:-} ]] && { ((n == 0)) || ((hits > 0)); }; then log "   ok   memory: $n observation(s), search smoke returned $hits hit(s)"; else log "   FAIL memory search smoke"; problems=1; fi
  if ((problems)); then
    log ""
    log "Verification found problems. Nothing was undone. Backup: $RUN_DIR (undo: scripts/rollback.sh $RUN_DIR)"
    exit 1
  fi
  mark_phase 6
  : >"$RUN_DIR/finished"
  log ""
  log "Migration complete."
else
  log "   would check: gentle-lite status, no gentle-ai markers/hooks, settings.local.json unchanged, memory search smoke"
  log ""
  log "End of dry run. Nothing was changed."
fi
log "Next: start Claude Code again, run /mcp (expect gentle-lite memory, codegraph, context7, rea), then try mem search."
log "Undo at any time: scripts/rollback.sh $RUN_DIR"
