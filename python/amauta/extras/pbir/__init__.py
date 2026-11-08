"""PBIR tools for the powerbi-report skill (plan D9b): DAX and model lint (warnings only), model diff and data
dictionary, layout audit and a structural cascading rename. Read-only except `rename --apply`. Stdlib only.

Clean-room rewrite of a private archive's report tools (docs/intake/powerbi.md): it reads PBIP files (model.bim, TMDL,
page.json, visual.json) instead of a private model snapshot. CLI: `python3 -P -m amauta.extras.pbir`.
"""

POINTS = {}
