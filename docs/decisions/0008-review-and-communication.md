# 0008 Working model: skills, communicator agent, independent review lenses

Status: accepted 2026-11-07. Supersedes the earlier idea of three data specialists plus a reviewer.

## Context

Specialist subagents are the same model as the orchestrator: their value is context isolation, not expertise, which
lives in skills. A reviewer briefed by the author, judging the author's own criteria with the same model and no way to
run anything, is only partly independent. The user wants speed and review independent of the project context.

## Decision

- Expertise lives in skills (`data` with five references, `powerbi-report`, editorial and design skills).
- Phase A, analysis: the orchestrator implements with TDD and reconciliation tests; the user confirms acceptance
  criteria inside ODD step 3; at close an **analytical lens** (fresh context, a different model, a pack assembled by
  `amauta review pack`, refuter for inferential severe findings) reviews once, plus a delta re-check after a
  correction.
- Phase B, communication: a **`communicator`** agent writes any deliverable for other people (documents, charts,
  dashboards, text) into the task's deliverables folder from the approved results only; it never computes new numbers
  but may write presentation measures over approved ones; it returns grouped measure requests (up to three cycles)
  and is resumed with its context. Number-fidelity and render checks run before a **communication lens** that reads
  as the audience, up to two rounds with a fresh reviewer each.
- Both lenses run in their case even when code review is off (a change to the orchestrator rule "review is off by
  default"), and can be turned off per project.
- ODD records criteria, contracts (`odd/contracts/<feature>/`) and the review verdict in the task file.

## Names (2026-11-08, user decision)

Agent ids use Inca names: `chasqui` (communicator), `taripaq` (analytical lens), `haravec` (communication lens).

## Rejected

Three specialists plus a reviewer (four sequential subagents, handoffs lose detail, a second review system); a
mandatory chain with an author-side quality gate between every step.

## Consequences

One subagent for analysis, one writer plus up to two reviewers for communication. If Codex cannot resume a subagent,
each measure-request cycle starts a fresh communicator that reads its own draft from files.
