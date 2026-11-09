"""Layout audit of a PBIR report folder: per page, visuals outside the page, overlapping visuals (groups are
containers and are skipped) and visuals too small to read. Geometry only: it does not prove how Power BI renders.
"""

import json
from pathlib import Path

MIN_SIZE = 40  # px: below this a visual cannot show a readable label


def _pages(report):
    root = Path(report)
    for pages in (root / "definition" / "pages", root / "pages"):
        if pages.is_dir():
            return sorted(p for p in pages.iterdir() if (p / "page.json").is_file())
    raise FileNotFoundError(f"no pages folder under {root}")


def _box(v):
    p = v.get("position") or {}
    return [float(p.get(k, 0) or 0) for k in ("x", "y", "width", "height")]


def audit(report):
    findings = []
    for page in _pages(report):
        meta = json.loads((page / "page.json").read_text(encoding="utf-8-sig"))
        width, height, name = float(meta.get("width", 1280)), float(meta.get("height", 720)), meta.get("displayName", page.name)
        visuals = []
        for f in sorted((page / "visuals").glob("*/visual.json")):
            v = json.loads(f.read_text(encoding="utf-8-sig"))
            if "visualGroup" in v or (v.get("visual") or {}).get("visualType") == "group":
                continue
            visuals.append((v.get("name", f.parent.name), _box(v)))
        for vid, (x, y, w, h) in visuals:
            if x < 0 or y < 0 or x + w > width or y + h > height:
                findings.append({"page": name, "kind": "outside", "visuals": [vid]})
            if w < MIN_SIZE or h < MIN_SIZE:
                findings.append({"page": name, "kind": "tiny", "visuals": [vid]})
        for i, (a, (ax, ay, aw, ah)) in enumerate(visuals):
            for b, (bx, by, bw, bh) in visuals[i + 1:]:
                if ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah:
                    findings.append({"page": name, "kind": "overlap", "visuals": sorted([a, b])})
    return findings
