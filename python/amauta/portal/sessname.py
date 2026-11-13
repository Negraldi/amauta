"""The one rule that names a session's project, used by every page that shows it (Today, Usage, search, project and session pages).

Applied to the cwd found in the session's transcript: the configured or discovered project whose folder holds it (the deepest
one), else the root of its git repository (a linked worktree counts as its main repository; a repository in $HOME itself, such
as dotfiles, never does), else the folder name. Without a transcript the usage table's own name is kept."""
from __future__ import annotations

import os
from pathlib import Path

from . import wikisess

MAX_DEPTH = 24
UNKNOWN = "unknown project"


def _projects():
    from . import projects  # projects imports api, which imports this module
    return projects


def _real(path) -> Path:
    return Path(os.path.realpath(path))


def _configured(portal, here: Path):
    owners = [r for r in (_real(p) for p in _projects().collect(portal)["repos"]) if r == here or r in here.parents]
    return max(owners, key=lambda r: len(r.parts)).name if owners else None


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


def project_of(portal, cwd, fallback=None) -> str:
    if cwd:
        here = _real(cwd)
        root = repo_root(portal, cwd)
        name = _configured(portal, here) or (root.name if root else "") or here.name
        if name:
            return name
    return fallback or UNKNOWN


def session_project(portal, session_id, fallback=None) -> str:
    return project_of(portal, wikisess.session_info(portal, session_id).get("cwd"), fallback)


def name_rows(portal, rows):
    """Usage rows ({"session_id", "project", ...}) with `project` replaced by the session's resolved project name."""
    return [{**r, "project": session_project(portal, r["session_id"], r.get("project"))} for r in rows]
