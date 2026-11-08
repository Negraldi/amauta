# Intake: data skills (plan D9)

Source: the public harness v19 the user shared on 2026-11-07 (`public-harness-v19-rc4.zip`, `source/`), with permission
to copy. Hashes are of the original files.

Common decision: the sources assume a guarded data gateway, an analyst agent, a Polars-only policy and the corporate
SQL guard, none of which exists in amauta. They are rewritten as one `data` skill with five references that keep the
contracts and acceptance cases and route real data through amauta's privacy hook and `amauta privacy` tools.

```
Source:        source/skills/data-engineering/SKILL.md · sha256 5c1e5fa7a398a07daad69487f9eabffd454a12af899db982d734a3c80112cdb4
               source/skills/data-engineering/references/transformation-contract.md · sha256 606c43255d9ea852dc4063883e65ac957d5515475491f2f20672f6633f762e8a
What it does:  ETL and transformation design rules; a reviewable transformation contract with synthetic cases
Interfaces:    skill text only
Dependencies:  none
Side effects:  none
Origin tests:  none
Decision:      rewrite  ->  assets/skills/data/SKILL.md, assets/skills/data/references/transformation.md
Why:           keep the contract; drop the gateway, the analyst agent and the Polars-only and SQL-guard policies
Changes:       library-neutral (pandas, Polars, R); real data through the privacy hook; no orchestrator handoff fields
Private data:  none
```

```
Source:        source/skills/data-automation/SKILL.md · sha256 bad07d3ff91267352f8dbf29cd2fecbca2684e367d59883718aa34cff5281b9b
               source/skills/data-automation/references/enrichment-contract.md · sha256 7e78d145bbc5fa1ba3dba8fd608ee7b9f98bb8302497b878e7046442de247d1c
What it does:  row-preserving workbook enrichment: ordinals, key handling, match semantics, reconciliation
Interfaces:    skill text only
Dependencies:  none
Side effects:  none
Origin tests:  none
Decision:      rewrite  ->  assets/skills/data/references/enrichment.md
Why:           the preservation rules are general; the adapter and gateway sections are not
Changes:       shorter; counts-only reporting; a synthetic table per case
Private data:  none
```

```
Source:        source/skills/domain-analysis/SKILL.md · sha256 924f89f52d98e8a2137ef120908449bb5aa4c07c46c0112c8173eb7787880b86
               source/skills/domain-analysis/references/metric-cohort-contract.md · sha256 92d02c7c9fb2ca4d11482a6a446799f220f0addc42b522fd932104e38332b113
What it does:  declarative metric and cohort definitions with synthetic acceptance cases
Interfaces:    skill text only
Dependencies:  none
Side effects:  none
Origin tests:  none
Decision:      rewrite  ->  assets/skills/data/references/metrics-and-cohorts.md
Why:           general; the source names an industry-specific incoming skill, left out
Changes:       no pipeline handoff section; project definitions and the selected profile win
Private data:  none (the industry reference was removed)
```

```
Source:        source/docs/ANALYTICAL_REVIEW_PATTERNS.md · sha256 b80e25b38c63a8c6f0acf523374f539c55b2e25661dc7383b74e624e43b52294
               source/skills/exploratory-data-diagnosis/SKILL.md · sha256 0146c4cc08aa3681c5c24bed9b4ed6eab9d21da49acdfbaae5760c5520c8b891
What it does:  review questions, acceptance trace, automation assessment; aggregate-only quality diagnosis
Interfaces:    skill text only (the diagnosis module it names is not taken)
Dependencies:  none
Side effects:  none
Origin tests:  none
Decision:      rewrite  ->  assets/skills/data/references/analytical-review.md and the workflow step 3 of SKILL.md
Why:           the questions are general; the diagnosis module needs Polars and the gateway
Changes:       no SQL Server specifics; the diagnosis becomes a workflow step with aggregates only
Private data:  none
```

`references/provenance.md` is original to amauta (no source).
