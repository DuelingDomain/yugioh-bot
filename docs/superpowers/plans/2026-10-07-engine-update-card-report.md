# Weekly engine update card report

**Goal:** Show every added card by product set near the top of the weekly artifact and PR body, together with removals and pre-release graduations. Implement the owner's specified design in the existing worktree; one commit, no push.

**Design:** Compare retained merged CDB passcodes rather than script filenames. Prefer BabelCDB source set codes, then YGOPRODeck printing metadata. Read the public card/set catalogs once per report with bounded, best-effort requests; CDB names remain authoritative offline. Use YGOPRODeck images for official codes and PR #226's Ignis URL for temporary preview codes. Product dates and a card's first-release dates are explicitly distinguished. Keep each product in closed `<details>` blocks. Preserve the full artifact and trim whole card rows in the existing byte-bounded GitHub copies, with an omitted count and artifact link. Deferred smoke validation removes excluded previews from additions.

**Files:** `scripts/engine-data-card-report.ts` owns comparison, enrichment and rendering; the existing report helper owns byte bounds. `update-engine-data.ts` inserts the section and returns its structured data; `validate-engine-data.ts` updates it after smoke results. Tests cover the actual updater as well as pure grouping and bounded rendering. Deployment documentation describes the new section.

- [x] Add failing grouping, offline, graduation, image and truncation tests; run with Node 22, `prlimit --core=0`, `--maxWorkers=1`.
- [x] Implement the helper and integrate inline/deferred reporting without changing pins or bundle inputs.
- [x] Pass targeted report/update tests, build shared, and typecheck duel-server.
- [x] Generate a sample for PR #210's previous database pin to the current pin under `data/engine-prerelease/report-sample`.
- [x] Request independent code review, fix material findings, and rerun affected checks.
- [x] Commit with the requested co-author trailer. Delete created build/dependency output; retain engine data and sample. Report in six lines plus the rendered sample.
