"""A Power BI report theme file from a palette: `{"name", "dataColors", "background", "foreground", "tableAccent"}`,
the basic part of the report theme schema. The colors come from the command line, from a brand file
(`- data colors: #rrggbb, ...`, `- background:` and `- foreground:` lines, as `amauta profile import` writes them)
or from the selected profile's brand.md.

It writes only the file it is given (creating its folder when missing), atomically, readable like any written file,
and never replaces one without force; a link at that path is replaced, never followed. It does not touch a report:
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
MIN_CONTRAST = 4.5  # WCAG AA for normal text


def _color(value, what):
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise ValueError(f"{what} must be a #rrggbb color, not {value!r}")
    return value


def build(name, colors, background=None, foreground=None):
    name = name.strip() if isinstance(name, str) else ""
    if not name or len(name) > MAX_NAME or not name.isprintable():
        raise ValueError(f"the theme name must be 1 to {MAX_NAME} printable characters")
    if not 1 <= len(colors) <= MAX_COLORS:
        raise ValueError(f"give 1 to {MAX_COLORS} data colors")
    out = {"name": name, "dataColors": [_color(c, "a data color") for c in colors]}
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
    """The WCAG contrast ratio of two #rrggbb colors (1 to 21; text wants MIN_CONTRAST or more)."""
    la, lb = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def _item(line, key):
    """The value of a `- key: value` list line, or None."""
    m = re.match(rf"\s*[-*]\s*{key}\s*:(.*)$", line, re.I)
    return m.group(1).strip() if m else None


def brand(path):
    """{"colors", "background", "foreground"} from a brand file's `- data colors:`, `- background:` and
    `- foreground:` lines. Every listed data color must be #rrggbb: a palette is never silently cut."""
    found = {"colors": None, "background": None, "foreground": None}
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        colors = _item(line, "data colou?rs")
        if colors and found["colors"] is None:
            found["colors"] = [_color(c.strip(), "a data color") for c in colors.split(",") if c.strip()]
        for key in ("background", "foreground"):
            value = _item(line, key)
            if value and found[key] is None and HEX.fullmatch(value):
                found[key] = value
    if not found["colors"]:
        raise ValueError(f"{path} lists no data colors (a line '- data colors: #rrggbb, ...')")
    return found


def profile_brand(cwd=None):
    """The brand.md of the profile selected for the project at cwd."""
    entry = profiles.resolve(state_dir(), cwd or os.getcwd())["files"].get("brand.md")
    if not entry:
        raise ValueError("the selected profile has no brand.md")
    return entry["path"]


def _mode(out):
    """The mode of the file being replaced, or what a new file gets under the user's umask."""
    if out.is_file() and not out.is_symlink():
        return out.stat().st_mode & 0o777
    mask = os.umask(0)
    os.umask(mask)
    return 0o666 & ~mask


def write(theme, out, force=False):
    out = Path(out)
    if out.suffix.lower() != ".json":
        raise ValueError(f"{out} must be a .json file")
    if out.is_dir():
        raise ValueError(f"{out} is a folder")
    if (out.exists() or out.is_symlink()) and not force:  # is_symlink: a dangling link counts as existing
        raise ValueError(f"{out} exists (use --force to replace it)")
    out.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=out.parent, prefix=".theme-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(theme, f, indent=2)
            f.write("\n")
        os.chmod(tmp, _mode(out))  # mkstemp makes it private; a theme is meant to be shared
        os.replace(tmp, out)
    except BaseException:
        os.unlink(tmp)
        raise
    return out
