# Product

## Register

product

## Users

One developer, the owner of the machine, who works with Claude Code every day through the amauta harness. They open
the portal as a desktop app window next to their editor and terminal, sometimes for a quick check and sometimes for
a long read, at any time of day (the system light/dark theme decides). They know the harness well and read
English technical text; the UI talks to an expert, not to a newcomer.

Jobs to be done, all equally frequent:

- Control spending: how many tokens went where (input, output, cache read/write), by model, project and day.
- Explore memory: read and navigate what the harness remembers (decisions, bugfixes, discoveries, topics and their
  revisions, graph memory nodes) and follow links between them.
- Check harness health: what is installed (hooks, MCP servers, skills, agents), ODD task progress, and whether each
  skill is actually helping (skill-impact).
- Configure: change a closed list of harness options (persona, review mode, telemetry, optional modules) without a
  terminal, with a preview before anything is written.

## Product Purpose

amauta is a small Claude Code harness (memory, telemetry, graph memory, skills, workflow). The portal is its local,
offline window: a wiki where every entity (memory topic, skill, tool, MCP server, session, ODD feature, graph node)
is a linked page with backlinks, plus a global search. Success means the owner can answer "what did I spend", "what
do we know about X", "is the harness healthy" and "change setting Y" in a few clicks, and enjoys reading it.

## Brand Personality

Warm and studious. A well-kept knowledge notebook rather than a control room: calm, legible, inviting to read and
to wander through links, but exact about numbers. Three words: studious, calm, precise. The name amauta (an Inca sage
and teacher) is a quiet undertone, never a costume. References for the feel: Obsidian (pages and backlinks that make
wandering pleasant) and a well-made Wikipedia article (reading comfort, clear hierarchy, links that belong in the
text).

## Anti-references

- Old wikis (classic MediaWiki): dense walls of text without hierarchy, link-blue everywhere, cramped tables.
- Toy or over-decorated UIs: illustrations, mascots, emoji, gratuitous animation.
- Also avoid the generic SaaS dashboard reflex: hero metric tiles, gradients, everything shouting at the same volume.

## Design Principles

1. Reading first: pages are for reading and following links; data views serve the text, not the other way round.
2. Exact and quiet: numbers are precise and tabular; emphasis is earned, not sprayed.
3. Every entity is a place: anything worth mentioning has a page, a stable link and backlinks.
4. Local and honest: show the source of each fact, say when a metric is correlation, never invent certainty.
5. Safe by default: the portal reads; the few writes are previewed, confirmed and undoable.

## Accessibility & Inclusion

WCAG 2.2 AA: text contrast at least 4.5:1 (3:1 for large text), full keyboard navigation with a visible focus ring,
semantic landmarks and headings. Respect `prefers-reduced-motion` (motion minimal anyway). Status (done/pending,
risk tiers) never relies on color alone: pair it with a label or shape.
