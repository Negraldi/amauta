"""A Power BI report theme file from a palette: `{"name", "dataColors", "background", "foreground", "tableAccent"}`,
the part of the theme schema every Power BI version reads. The colors come from the command line, from a brand file
(a `- data colors: #rrggbb, ...` line, as `amauta profile import` writes it) or from the selected profile's brand.md.

It writes only the file it is given, atomically, and never replaces one without force. It does not touch a report:
import the file in Power BI Desktop (View, Themes, Browse for themes), so the change is the author's, and visible.
"""

import json
import os
import re
import tempfile
from pathlib import Path

from ...paths import state_dir
from ...privacy import profiles

HEX = re.compile(r"#[0-9a-fA-F]{6}")
MAX_COLORS = 64
MAX_NAME = 60


def _color(value, what):
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise ValueError(f"{what} must be a #rrggbb color, not {value!r}")
    return value


def build(name, colors, background=None, foreground=None):
    if not isinstance(name, str) or not name.strip() or len(name) > MAX_NAME:
        raise ValueError(f"the theme name must be 1 to {MAX_NAME} characters")
    if not 1 <= len(colors) <= MAX_COLORS:
        raise ValueError(f"give 1 to {MAX_COLORS} data colors")
    out = {"name": name.strip(), "dataColors": [_color(c, "a data color") for c in colors]}
    if background:
        out["background"] = _color(background, "the background")
    if foreground:
        out["foreground"] = _color(foreground, "the foreground")
    out["tableAccent"] = out["dataColors"][0]
    return out


def _luminance(color):
    def channel(c):
        c = int(c, 16) / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(color[i:i + 2]) for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    """The WCAG contrast ratio of two #rrggbb colors (1 to 21; text wants 4.5 or more)."""
    la, lb = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def brand_colors(path):
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        if re.match(r"\s*[-*]\s*data colou?rs\s*:", line, re.I):
            found = HEX.findall(line)
            if found:
                return found
    raise ValueError(f"{path} lists no data colors (a line '- data colors: #rrggbb, ...')")


def profile_brand(cwd=None):
    """The brand.md of the profile selected for the project at cwd."""
    entry = profiles.resolve(state_dir(), cwd or os.getcwd())["files"].get("brand.md")
    if not entry:
        raise ValueError("the selected profile has no brand.md")
    return entry["path"]


def write(theme, out, force=False):
    out = Path(out)
    if out.suffix.lower() != ".json":
        raise ValueError(f"{out} must be a .json file")
    if (out.exists() or out.is_symlink()) and not force:
        raise ValueError(f"{out} exists (use --force to replace it)")
    out.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=out.parent, prefix=".theme-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(theme, f, indent=2)
            f.write("\n")
        os.replace(tmp, out)
    except BaseException:
        os.unlink(tmp)
        raise
    return out
