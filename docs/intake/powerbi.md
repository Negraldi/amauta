# Intake: Power BI report skill and PBIR tools (plan D9b)

Sources: the public harness v19 the user shared on 2026-11-07 (`public-harness-v19-rc4.zip`,
`source/skills/powerbi-report/`), and the report tools of the user's private agent archive (shared with permission to
learn from it; its content never enters this repository). Hashes are of the original files.

```
Source:        v19 skills/powerbi-report/SKILL.md · sha256 f26814d8245cf07fcbb02160843b0b71ca95c8a8fc8e1c8aaa09c093aafce74d
What it does:  the report workflow: contract, placement, page design, PBIP candidate, Desktop, Service, performance
Interfaces:    skill text
Dependencies:  none
Side effects:  none
Origin tests:  none
Decision:      rewrite  ->  assets/skills/powerbi-report/SKILL.md
Why:           288 lines with machine-specific steps (one Desktop build, an input-automation library, a desktop bridge)
Changes:       one screen; the same order of work; amauta's PBIR tools for the static checks; permission rules kept
Private data:  none
```

```
Source:        v19 skills/powerbi-report/references/
               statistical-contracts.md · sha256 92432ac45e0142faf7b332b037b17c6bef5345d60462c13633ba5e10fa6f05d7
               calculation-placement.md · sha256 6b4384036f7d2aaa852cf1750495ee96b972d7d9c6918479867b7d834e73162a
               clean-report-design.md · sha256 55ae26bc295c917d634ef245e12e53be1a9db078d7a7706ae3c05bcd7af194cf
               semantic-model-conventions.md · sha256 2903037a559c0f49d5411201090bf4b10e122377c9a3cf3a66942f2762995db3
               pbir-authoring-notes.md · sha256 e7111ef3cd485d8df122f828100a779b1722442918a4cf969a4611cbcc8147b9
               visual-catalog.md · sha256 1294fc313e653b362a7663b0f5468013dbba7e65bee944177fcbc02ccab00b0d
What it does:  Power BI reference material (statistics, calculation placement, page design, model, PBIR, visuals)
Interfaces:    text
Dependencies:  none
Side effects:  none
Origin tests:  none
Decision:      copy (two passages adapted)  ->  assets/skills/powerbi-report/references/
Why:           general guidance with Microsoft documentation links
Changes:       semantic-model-conventions: the dependency-checker passage now names amauta's PBIR tools;
               clean-report-design: "receipt" became "acceptance record"
Private data:  none
Not taken:     dashboard-audit-optimization.md (sha256 ee7729c3...) and synthetic-renderer-acceptance.md (sha256 93376890...)
               depend on v19 scripts and its renderer; scripts/*.py are replaced by the tools below
```

```
Source:        private archive, report tools (clean-room: their behavior was read, no text or code was copied)
               cascading renamer · sha256 f10e91a02d5118db7f389b16a59d89c6d2256b067528b3ad3f1c165cf5ad654e
               model diff and data dictionary · sha256 a041aec4073d9012c7d1a200e6a203a09c5f9d99e5653998f561b67400e452d7
               layout auditor · sha256 78548f9ff5ef63a5c22722be66ebc9c9568525d44c8f702e26072910f3c324b9
               best-practice linter · sha256 8fb830a14d8005dbb2dd9687997eb6e03bb1f7b269e7aa16bbe9a581909efc23
What it does:  rename a field across report visuals; diff two models and write a data dictionary; audit page layout;
               lint DAX and the model
Interfaces:    Python functions over a private model snapshot
Dependencies:  stdlib
Side effects:  the renamer rewrote visual files by text replacement
Origin tests:  none ported
Decision:      rewrite  ->  python/amauta/extras/pbir/ (lint, diff, dictionary, layout, rename)
Why:           the behavior is useful and general; the code read a private snapshot format and carried private content
Changes:       reads PBIP files (model.bim, TMDL, page.json, visual.json); the rename is structural (field references
               only, never titles or literals) and a dry run until --apply; lint findings are warnings
Private data:  removed: personal names, organization and team names, a product name, local file paths
```
