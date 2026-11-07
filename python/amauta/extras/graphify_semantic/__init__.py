"""graphify semantic pass without an API key (extra): plan chunks, save subagent replies, validate and merge them into
the graph (skill `graphify-semantic`), plus the PPTX-to-Markdown sidecars graphify cannot read itself.

CLI: `python3 -P -m amauta.extras.graphify_semantic plan|save-chunk|validate|merge`. No extension points: the kernel only
reads the result from the graph tables.
"""

POINTS = {}
