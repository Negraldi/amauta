# Feature: what the private agent archive teaches, rewritten for amauta

Locator: `odd/tasks/agent-archive-intake.md` (branch `feat/amauta-next`, after `a573499`). Engram mirror:
`odd/agent-archive-intake/tasks`. Intake record: `docs/intake/agent-archive.md`. Decided with the user on 2026-11-09
(all seven recommendations of the archive review).

## Objective

Take the general methods of the user's private agent archive into amauta's skills and PBIR tools, clean-room: the
behavior is read, no text, code, name, palette, server or business rule is copied. The private parts stay in the
user's profile on their machine.

1. A SQL review reference for the `data` skill.
2. A challenger checklist and a review certificate in `analytical-review`.
3. A query cache recipe (query once, keep Parquet, work from the copy) in `pipeline-recipes`.
4. A reference for HTML in DAX and Deneb (Vega-Lite) in `powerbi-report`, with synthetic examples.
5. Storytelling and chart selection, titles, inverted semantic colors and two header measures in `powerbi-report`;
   stock, flow and cohort reconciliation in `metrics-and-cohorts`.
6. Templates: a lineage record (`provenance`) and a report documentation outline (`powerbi-report`).
7. PBIR tools: `pbir refs` (report field references the model does not have), `pbir theme` (a report theme file from
   colors or the profile's brand), and DAX001 no longer flags a division by a nonzero numeric constant.

## Scope

In: `assets/skills/data/`, `assets/skills/powerbi-report/`, `python/amauta/extras/pbir/`, their tests, the intake
record, docs (guide pages, CHANGELOG). Out: repairing reports automatically (a report is only read), a desktop bridge,
a canvas builder, the archive's templates and harvest scripts, Word generation.

## Constraints

- No private content: no organization, person, server, schema, palette or product names; the archive's 97 DAX and
  Deneb templates and its catalogs are not used. Examples are synthetic.
- The archive's mistakes are not inherited: "always DIVIDE", "always a read-uncommitted hint", a keyword denylist as a
  read-only guard, and `FILTER(ALL(...))` both recommended and flagged.
- Skills stay small (SKILL.md < 6000 chars, references < 6000, pipeline recipes < 12000); Python stdlib only;
  simplicity ratchet; `pbir theme` writes only the file it is given and never a report.

## TDD

Strict, ON for the PBIR tools; structure tests for the skill text. Runner:
`python3 -m unittest python.tests.test_pbir`, `node --test test/data-skill.test.js test/powerbi-skill.test.js`, then
`npm test`.

## Tasks

- [x] A1 Intake record `docs/intake/agent-archive.md`: each source by hash, decision and why; what was not taken.
- [x] K1 `data/references/sql-review.md`: explain before running, writes only to temporary objects, sargable filters,
  keys to a temporary table, aggregate to the grain before a join, batch hygiene, UTF-8 scripts, lazy frames, paths
  and credentials, the delivery format.
- [x] K2 `analytical-review`: the challenger questions (blind spots, robustness, assumptions, value) and a review
  certificate in the deliverable.
- [x] K3 `pipeline-recipes`: query cache to Parquet with its fingerprint; a refresh flag.
- [x] K4 `powerbi-report/references/html-and-deneb.md`.
- [x] K5 `powerbi-report/references/storytelling-and-charts.md`; stock, flow and cohort in `metrics-and-cohorts`.
- [x] K6 Lineage record in `provenance`; `powerbi-report/references/report-documentation.md`.
- [x] T1 `pbir refs REPORT MODEL`: references in projections, filters and sorts to a table, column or measure the
  model lacks; exit 1 when any.
- [x] T2 `pbir theme --name N (--colors C,... | --brand FILE | --profile) --out FILE`: a Power BI report theme from
  `#rrggbb` colors; the file is written atomically and never over an existing one without `--force`.
- [x] T3 DAX001: a division by a nonzero numeric constant is not flagged.
- [x] Q1 Cleanup; [x] Q2 independent review; [x] Q3 fixes.
- [x] Q4 cleanup; [x] Q5 independent review; [x] Q6 fixes; [x] Q7 cleanup.
- [x] D1 Docs: guide pages (en, es), CHANGELOG, skill and module docs; commit and push.

## Acceptance criteria

- Every new reference is linked from its SKILL.md and passes the skill tests (size, links, banned words).
- `pbir refs` and `pbir theme` have tests on synthetic fixtures, `--help` works, and they are listed in the skill.
- `npm test` green; ratchet and architecture green.

## Progress

- 2026-11-09: plan written from the archive review and the user's request (implement 1 to 7, then three cleanup
  rounds with two independent reviews and their fixes, then documentation).

- 2026-11-09: T1-T3 inline, TDD (RED seen: refs and theme missing, DAX001 flagged `/ 100`). A1, K1-K6 inline,
  structure tests first (5 RED). npm test 859 Node, 947 Python. Q1: refs walker split, one contrast computation.
- 2026-11-09: Q2 independent review, ten findings. Q3: the test denylist named private terms (pushed in `64fa5bf`):
  replaced by a placeholder-color allowlist, the history rewrite is the user's decision; `--colors ""` fell back to the
  profile; report-level measures read as missing; a non-object JSON crashed; DAX001 exempted `/ 0`; a weak test;
  theme files were 0600; the cache recipe now hashes a source label, writes atomically, resolves from the project root,
  stamps UTC; SQL dialect and `yyyymmdd` literals stated; the HTML card handles a blank comparison. RED seen for the
  code fixes (3 tests).

- 2026-11-09: Q4: theme permissions set after the write, one contrast threshold. Q5 second review, nine findings.
  Q6 (RED seen, 5 tests): the DAX001 regex was quadratic on long digit runs (50k chars in 20 s; now linear); refs
  compares names without case and a non-object model is exit 2; a brand line with a bad color is an error instead of
  a cut palette, and its background and foreground lines are used; a trimmed name, a folder at --out, "1 data color",
  the file mode follows the replaced file or the umask. The cache recipe now wraps sql_to_parquet.py (one driver,
  batches, one connection setting) and never leaves a record that describes the wrong file. Wording: "nonzero",
  neutral examples; the color allowlist test also catches 8-digit hex and rgb(). Q7: nothing left.

- 2026-11-09: D1: guide pages (en, es) list `refs` and `theme`, CHANGELOG Unreleased; `check-guide.mjs` ok for both
  languages. npm test 859 Node, 951 Python. Open for the user: commit `64fa5bf` (and the older data-skill test before
  `a573499`) still carries private terms in history; removing them needs a history rewrite and a force push.

## Next step

None: closed, except the history decision above.
