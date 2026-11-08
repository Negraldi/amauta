"""Pipelines (extra, plan S1, ADR 0010): run a project's processes, defined in `.amauta/pipelines.json`, and show their
output live. CLI: `amauta pipeline list|run|status|cancel|schedule-hint` (`python3 -P -m amauta.extras.pipelines`).
Portal points arrive with the Pipelines tab (plan S1b). Deleting this folder removes the feature.
"""

POINTS = {}
