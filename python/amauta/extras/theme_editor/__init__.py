"""Theme editor (extra): custom light/dark themes stored as JSON files under `<state dir>/themes` (portal `#/themes`).

Without this extra the portal still offers System, Light and Dark. Extension points: `themes.list`, `themes.write` and
`themes.delete`; the two writes return `(status, payload)` for the guarded POSTs.
"""
from . import themes


def _guarded(action):
    def run(state_dir, body):
        try:
            return 200, action(state_dir, body)
        except themes.ThemeError as err:
            return err.status, err.body()
    return run


POINTS = {
    "themes.list": themes.list_themes,
    "themes.write": _guarded(themes.write_theme),
    "themes.delete": _guarded(lambda state_dir, body: themes.delete_theme(state_dir, body.get("slug"))),
}
