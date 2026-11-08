"""`amauta pipeline check` (plan S1, ADR 0010): what would stop a run, found before it starts. For each enabled step:
its script or notebook exists inside the project (from its root, as the runner reads it), its program can be found
(on PATH, or as a path), its `cwd` is a folder. An output whose folder does not exist yet is a note, since the step
may create it. Nothing runs and nothing is written.
"""

import os
import shutil
from pathlib import Path

from . import config, proc

PROGRAMS = {"r": "Rscript", "notebook": "jupyter"}


def _program(name, repo, cwd):
    if os.sep in name or "/" in name:
        p = Path(name) if Path(name).is_absolute() else Path(repo) / cwd / name
        return p.is_file()
    return shutil.which(name) is not None


def _step(repo, step, python):
    """[(level, message)] for one step."""
    out = []
    if not (Path(repo) / step["cwd"]).is_dir():
        return [("error", f"cwd {step['cwd']} is not a folder")]
    source = step.get("script") or step.get("path")
    if source:  # resolved exactly as the runner does: from the project root, never outside it
        try:
            if not proc.inside(repo, source).is_file():
                out.append(("error", f"{source} does not exist"))
        except proc.Escape as e:
            out.append(("error", str(e)))
    if step["type"] == "command":
        program = step["argv"][0]
    elif step["type"] == "python":
        program = step.get("interpreter") or python
    else:
        program = step.get("interpreter") or PROGRAMS[step["type"]]
    if program and not _program(program, repo, step["cwd"]):
        out.append(("error", f"{program} was not found (not on PATH, not a file)"))
    for rel in step["outputs"]:
        if not (Path(repo) / rel).parent.is_dir():
            out.append(("note", f"the folder of {rel} does not exist yet; the step must create it"))
    return out


def check(repo, pipeline_id=None, python=None):
    """[{pipeline, step, level: error|note, message}] for one pipeline or all of them; [] when nothing would stop a run."""
    python = python or shutil.which("python3") or shutil.which("python")
    pipelines = config.load(repo)
    if pipeline_id is not None and pipeline_id not in [p["id"] for p in pipelines]:
        raise config.ConfigError(f"no pipeline {pipeline_id!r} in {config.FILE}")
    found = []
    for p in pipelines:
        if pipeline_id is not None and p["id"] != pipeline_id:
            continue
        for step in p["steps"]:
            if not step["enabled"]:
                continue
            for level, message in _step(repo, step, python):
                found.append({"pipeline": p["id"], "step": step["name"], "level": level, "message": message})
    return found
