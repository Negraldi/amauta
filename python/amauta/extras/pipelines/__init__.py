"""Pipelines (extra, plan S1, ADR 0010): run a project's processes, defined in `.amauta/pipelines.json`, and show their
output live. CLI: `amauta pipeline list|check|run|status|cancel|schedule-hint` (`python3 -P -m amauta.extras.pipelines`).
The portal's Pipelines tab uses the points below (plan S1b). Deleting this folder removes the feature.
"""
from . import portal_points

POINTS = {
    "GET /api/pipelines": lambda portal, q: portal_points.list_pipelines(portal),  # a route the portal serves (ADR 0009)
    "GET /api/pipelines/events": portal_points.events,
    "GET /api/pipelines/check": portal_points.check,
    "pipelines.run": portal_points.run,
    "pipelines.cancel": portal_points.cancel,
}
