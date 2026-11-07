# 0002 One installer plan over runtime adapters

Status: accepted 2026-11-07.

## Context

`src/install/installer.js` (Claude) and `src/install/codex.js` (Codex) each have a `plan()` of about 200 lines that
repeat the same steps. Every new hook or module, and the Windows work, would have to be written twice.

## Decision

One `plan()` made of steps (instructions, hooks, MCP servers, skills, assets, agents) that runs once per runtime
adapter. An adapter knows its paths, file formats and what it does not support (Codex: no output styles today).
Behavior is unchanged and pinned by the existing installer and Codex suites.

## Rejected

Only splitting the two functions into smaller ones: keeps the duplication.

## Consequences

Adding Codex agents (if the Windows/Codex probe confirms `.codex/agents/*.toml`) becomes one adapter capability.
