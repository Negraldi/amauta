"""Wiki explanations (extra): queued requests for a written explanation of a harness component, and the notes Claude
writes back (skill `amauta-wiki-explain`, CLI `python3 -P -m amauta.extras.wiki_explain.wikiexplain`).

Extension points: `harness.explain` (the block on a component page), `harness.pending` (queued requests),
`lint.categories` (stale or orphaned notes) and `portal.explain_request` (the guarded POST).
"""
from ...portal import wikiharness
from ...portal.wikibase import _ref
from ...portal.wikilint import _category
from . import wikiexplain

STALE_NOTE = "The component changed after this explanation was written: request a new one."
GONE_NOTE = "The component no longer exists: the note can be deleted."


def _stale_notes(portal):
    index = wikiharness.index(portal)
    items = []
    for n in wikiexplain.notes(portal):
        e = index.get((n["kind"], n["id"]))
        if e is None:
            items.append({"kind": n["kind"], "id": n["id"], "title": n["id"], "detail": GONE_NOTE})
        elif wikiharness.digest(e["material"]) != n["source_hash"]:
            items.append({**_ref(n["kind"], n["id"], e["title"]), "detail": STALE_NOTE})
    return _category("stale_notes", "Stale explanations",
                     "Explanations written for a harness component from its files. Flagged when the component changed afterwards or no longer exists: ask for a new one or delete the note.", items)




def explain_block(portal, e):
    return wikiexplain.page_block(portal, e) if e["kind"] in wikiexplain.ALLOWED else None


def request(portal, body):
    """(status, payload) for the explain POST; the portal forgets its harness cache after a queued request."""
    try:
        result = wikiexplain.request(portal, body)
    except wikiexplain.ExplainError as err:
        return err.status, err.body()
    wikiharness.forget(portal)
    return 200, result


POINTS = {
    "harness.explain": explain_block,
    "harness.pending": lambda portal: len(wikiexplain.pending(portal)),
    "lint.categories": lambda portal: [_stale_notes(portal)],
    "portal.explain_request": request,
}
