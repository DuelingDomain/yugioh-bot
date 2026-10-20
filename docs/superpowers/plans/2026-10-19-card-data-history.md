# Card data update history

Goal: let the existing card data page show past engine data updates without a runtime GitHub dependency.

Use a committed JSON file under `packages/web/src/lib/`. The existing owner-only status API adds this history to its response. Each entry has an update date, label, PR number/link, nullable review counts, set codes and new card identities with their set and pre-release status. Unknown historical values remain unknown.

The publisher reads the complete report metadata after validating the existing pin-only patch. After opening the PR, it generates a separate data-only history commit so the stored link is exact. The patch allowlist and human-commit protection stay in force. Existing report artifacts and pin-only publication remain compatible. Publication dates are snapshot dates; merging the PR adds the entry to main.

The UI uses the existing section layout, FloorList/FloorRow, StatusLine and dark sheet tokens. Entries are newest first, with counts visible and native details/summary controls for card lists. Long names and metadata wrap on phones.

- [x] Backfill all merged engine update PRs from #210 onward; use the database load rules at the historical update for missing report data.
- [x] Add the shared history contract and guarded API data.
- [x] Add additive publisher support and preserve complete post-validation card metadata.
- [x] Add the history section and responsive styles.
- [x] Prove publication against a disposable real Git repository, including PR replacement and patch security; add no unit tests.
- [x] Run Playwright against an isolated dev server on a free 33xx port, with a real SQLite database and committed history. Check owner and non-owner access, expand/collapse, counts, links, offline GitHub state, and all requested viewports. Save WebP screenshots to the requested scratchpad.
Release procedure: run TypeScript checks for shared, duel-server and web plus relevant existing checks, review the final diff, commit, push, open a PR and watch CI. Do not merge. Stop only owned processes and remove this worktree's `.next` output.

Verification: the real Git integration also covers failed second-push recovery and legacy PR trees with no history file. Playwright passed all three requested viewports against a separate SQLite database with 14,759 real card rows and offline GitHub access; it also checked a generated future-update scenario, unknown data and empty history. The production web build passed and includes the committed history in its server output. Independent review has no remaining findings.
