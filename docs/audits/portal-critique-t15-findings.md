# T15 critique findings (five reviewers, 2026-11-13)

Unverified by the coordinator unless marked. IDs are stable.

## Area A (Today, Work)
- A1 P1 class 2: #/project/amauta?tab=features "Avance de tareas" diagrams show 8 of 11 features, no note.
- A2 P1 class 2: Today feed stops at 20 rows per day (/api/wiki/home), no "N of M", no more.
- A3 P2 class 14: feature page renders tasks three times (markdown list, Tareas table, grid); "7 de 7 hechas" twice.
- A4 P2 class 14: session page "Enlaces" block repeats the Skills, MCP servers and saved-memories lists above it.
- A5 P2 class 4: session page lists "bash_placeholder", "bash" next to "Bash", model "<synthetic>" (and "+3" counts it), raw mcp__ tool names, ~45 rows ungrouped.
- A6 P2 class 14/4: Projects "Encontrado por" repeats the same long phrase on 8 of 11 rows and shows the CLI flag "--repo".
- A7 P2: session page title is generated ("amauta · gpt-6.1-sol, 6 mensajes · 2026-10-23"), restates Details, date is the start date unlabeled; Today session rows inconsistent (model inside link on one, none on another; missing separator before "iniciada el").
- A8 P2: session page: project and working directory are plain text, not links; empty left column under title.
- A9 P2 class 8/3: "Avance de tareas" summaries show file names "agent-archive-intake.md: 13/13 hechas".
- A10 P3: graph tab "0 tablas SQL", "graph.json <date>", project name repeated as h2; "50 de 5.506 nodos" with no way to see more.
- A11 P3 class 14: long explanation under Sesiones repeated on each project's sessions tab; that table has hex ids only, no title, no start date.
- A12 P3 class 10: "2,6 mil M" on Today.
- A13 P3 copy: "tras un mem_save con este proyecto"; pipelines empty state names .amauta/pipelines.json and docs/pipelines.md plus an orphan "Todos los pipelines" link; #/pipelines "Modo process / preview" in English; "5. Preview the match grouping · etapa 1"; "Ejecuciones recientes:" shows only a check mark; "-" for no activity.
- A14 P3 class 8: breadcrumb "Actividad / Sesiones" while sidebar highlights "Uso"; browser titles inconsistent ("Proyecto amauta - amauta" vs "ortho-conv - amauta").
- A15: Today has no "data as of" line while Usage does.

## Area B (Knowledge)
- B1 P1 class 3/4: memory pages show raw "Tipo: decision/session_summary", "Ámbito: project", "Origen: own"; the list shows translated labels.
- B2 P1 class 2: #/lint "Se muestran 50 de 414" (orphans) and "50 de 418" (unspaced) with no way to see the rest.
- B3 P2 class 2: #/lint duplicates group says "165 notas con el mismo título" and lists 6.
- B4 P2 class 14: #/lint repeats the same reason sentence on every row (29, 50, 19 times).
- B5 P2 NEW: #/lint rows indistinguishable (same title, no date/project/id); stale rows show raw ids "PostToolUse:36ce7f65".
- B6 P2 class 4: #/lint English "T1 and 5 more".
- B7 P2 class 3: memory file page flattens frontmatter into one paragraph; no project, size or date.
- B8 P2 class 1/4: #/memfile Project column shows raw slugs "-home-negraldi" while #/memory shows "home-negraldi".
- B9 P2 class 11/4: #/node default order opens on stdlib concepts and raw ids (ref_node_path, json, os, re).
- B10 P2 class 2: #/node "50 de 5.506 nodos" no "show more".
- B11 P3: #/node depth select placed before search but only affects the neighbours panel; labels with docstring fragments; "(cargado X; graph.json X)" repeats the same time and does not say the graph is 4 days old.
- B12 P3: #/lint truncated task text, duplicated id "T3c, T3c", no in-page index for 8 long sections.
- B13 P3: #/memory?source=engram shows "not found" but keeps the search box and a one-option select.
- B14 P3: memory page of an unspaced memory does not say so, though Quality does.

## Area C (Harness wiki)
- C1 P1 class 5/6: harness diagram: natural size 1963 px in a 977 px scroller; fit-to-width text 6.35 px. Neither state readable and complete.
- C2 P2 class 6: harness runtimes table 965 px wide inside 721 px (1024) and 343 px (375): columns hidden behind sideways scroll.
- C3 P2 class 11: harness hooks table opens sorted by event descending; should be lifecycle order.
- C4 P2 class 12: diagram "skills: 32, agentes: 23" vs runtimes table 34 vs Catalog 81 skills / 24 agents; unexplained.
- C5 P2 class 4/14: MCP tool page Origin shows "Informado por el servidor" twice and a raw ISO timestamp.
- C6 P2 class 3/14: item pages carry English "What it does / When Claude uses it / Worth knowing / Based on:" headings under the portal's own "Qué hace".
- C7 P2 class 14: every MCP server page repeats the generic MCP sentence.
- C8 P2 class 4: hook pages raw "Ámbito: user", "Tipo de hook: command"; MCP "Tipo: stdio".
- C9 P3 class 8: hook title ends with a dangling colon; name differs from the harness table.
- C10 P3 class 14: hook "Origen" repeats "Configurado en".
- C11 P3 class 12: item page "Llamadas 941" all-time next to "915 llamadas en los 30 días": label "en total".
- C12 P3: skill "Qué hace" cut mid-sentence; diagram aria-label says "handlers", copy says "manejadores".

## Not covered in round 1
1024 and 375 px almost everywhere; dark theme everywhere; Ctrl+K palette, Vista menu, unknown addresses; pipeline page and run page; node pages; all of Usage, Sessions, Tools and skills, tool page, skill page; #/security, #/guide, #/settings; component list filter and item pages at 1024/375; keyboard pass.

## Mechanical sweep (haiku), 1024 and 375 px, 22 routes: no page scroll, no text under 11 px
- M1 class 6: #/tool segmented nav 719/1070 at 1024 and 341/1070 at 375: segments hidden behind sideways scroll. #/memory segmented 341/352 at 375.
- M2 class 6: tables scrolling sideways at 1024 (content column 721): #/project 935, project sessions tab 914, #/memory 898, #/usage 814 and 792, #/session 1220, #/node 772, #/harness runtimes 965. At 375 also memories tab 505, memfile 436, tool 668, security 604, guide 436.
- M3 targets: #/node and project graph tab buttons "os" 15x24, "re" 13x24, "sys" 21x24 (width under 24); checkbox inputs 18x18 on #/node and #/usage.
- M4 check: header "Buscar en la wiki" span clipped at 375 on every route (verify it is a deliberate icon-only state with an accessible name).
- M5 harness diagram scroller 721/1981 (1024), 343/1981 (375): same as C1.

## Area D (Activity, node pages, global), seen at 1280, measured at 1024/375
- D1 P1 class 1/2: node page undercounts edges: list says 191 links, page says 168 incoming (EDGE_LIMIT=500 in graph/query.py cuts silently, "truncated" stays false). installer.js 154 vs 125+2.
- D2 P1 NEW (control far from its effect): #/node depth select next to search does nothing until a row is clicked again; neighbours panel renders at y=2581 below the 50-row table, no scroll into view.
- D3 P2 class 1/12: #/tool/Bash shows three counts: chart caption 4.102 calls in 30 days "hasta 2026-11-14" (UTC tomorrow), Usage table 5.534 in 9 sessions, Details 7.163 in 31 sessions (all time, unlabeled). Skill page uses "hasta <last use day>".
- D4 P2 class 2: Bash page "Enlazada desde" lists 20 sessions of 31, no note.
- D5 P2 class 6: #/tool segments clip at every width (1070 vs 975 at 1280). Same as M1.
- D6 P2 NEW (wrong empty-state reason): Codex filter on Tools says "No hay registros en este intervalo" though no Codex tool calls are ever recorded; Codex session pages have no Tools section and no explanation.
- D7 P2 class 4/3: node page raw values: "imports_from (incoming)", "re_exports (outgoing)", neighbour suffix "code"/"concept", diagram labels "ref_node_fs (concept)", h1 is an internal id, edge table ids.
- D8 P2 class 11: #/node default order = concepts noise (same as B9).
- D9 P2 class 5: neighbourhood diagram text 7.8 px at 1280, 6.0 px at 375; diagram 565 px wide with empty space beside it.
- D10 P2 class 2: depth 2 capped at 200 nodes (api truncated=true), UI says "30 nodos más cercanos de 200" without saying 200 is a cap.
- D11 P2 class 3/4: Ctrl+K results: "impeccable | 3 calls" (English), task results with backticks and "portal-wiki, done".
- D12 P2 class 14: skill page repeats "menos de 5 sesiones..." 4 + 3 times; "1 sesiones antes" (plural).
- D13 P2 class 8: node page breadcrumb/sidebar say "Trabajo / Proyectos / amauta" while #/node lives under Conocimiento / Grafo.
- D14 P3 class 3: Sessions list shows only 8-char id and "model +3"; session page has a real title.
- D15 P3 class 12: "Participación" is share of total tokens incl. cache, unstated; rows sorted by messages so shares out of order; "<synthetic>" raw; telemetry event count ignores the filters it sits under.
- D16 P3 class 4: Pipelines "Modo" options "process"/"preview" raw.
- D17 P3 class 10: ISO dates in Spanish UI ("Datos al 2026-11-13 20:42") -- existing convention, likely keep.
- D18 P3: node list rows are buttons, selection not in URL; Vista button lacks aria-expanded; not-found copy "Actualizar uso" vs button "Actualizar".
- D19 P3 class 12: "Herramientas (60)" includes the 41 MCP tools; subagent rows not links.
- D20: there is no pipeline page or run page; run log opens inline.

## Area E (security, guide, settings, dark, keyboard)
Dark theme at 1280 on 20 routes: no contrast failure (body 16.4, muted 8.7, links >= 8.3, borders >= 4.05). Focus ring fine. No page scroll.
- E1 P1 class 5: guide diagrams unreadable: effective text 4-6 px at 1280 (scale 0.32/0.38), 3.0-7.4 px at 1024 across #/guide, #/guide/portal, #/guide/data-security, #/guide/install; no enlarge control.
- E2 P2 voice: voseo/tuteo in guide sequence diagrams: "inicias una sesión" (#/guide), "confirmas" (#/guide/portal). Sweep guide es sources for 2nd person singular.
- E3 P2 class 7: Settings preview: after "Vista previa de cambios" focus is on BODY, result opens below the fold (y=1152) with "Aplicar cambios" out of view; "Descartar vista previa" leaves focus on BODY and the select keeps the draft value.
- E4 P2 class 1/12: same as C4 (32/23 vs 34 vs 81/24).
- E5 P3 class 11: Settings Projects table opens sorted descending by folder.
- E6 P3 class 4: "Persona gentleman" on harness vs "Gentleman" in Settings.
- E7 P3 class 8: Settings help says "La página Harness"; guide says "Pie" for an unlabeled group; guide lists "Sesiones" and "Herramientas y skills" as sidebar entries (sidebar shows only "Uso"); "Agregar" vs "Añada".
- E8 P3 class 6: Security trusted-projects table 604 in 343 at 375, "Desde" column off screen without hint; every scrollable-table wrapper is a Tab stop even when nothing overflows.
- E9 P3 class 14: Security "Codex" said three times; Settings "No: esos hooks se eliminan." on 3 controls; Appearance "Idioma" heading and label; hook page title twice with stray colon.
- E10 P3: component filter with no result keeps segment counts, no aria-live; catalog link "rea" 23x28.
- E11 P3: at 375 top-bar search button text truncated "Buscar en la ..." (same as M4).
- E12: #/security has no Claude Code section, only protection chips then a Codex panel (check intent vs agnostic harness).
- Process: reviewer E pressed Tab 16 times on tab "seed" by mistake; no writes.

## Fix batches (one writer at a time)
- W1 caps and counts: A1 A2 B2 B3 B10 A10 D1 D4 D10 D3 C11 C4 E4 D6
- W2 diagrams, overflow, node explorer: C1 D9 E1 M1 D5 C2 M2 (1024 only) M3 E8 D2 D8 B9 D13 B11
- W3 raw values, language, repetition, focus, order: the rest
