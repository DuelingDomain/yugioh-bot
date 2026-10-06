# Card data status backend plan

Historical initial implementation. The [backend follow-up](2026-10-06-card-data-status-follow-up.md)
supersedes its catalog-only gap, reverse gap, manifest-mtime estimate, and remote cache behavior.

The operator-facing API is `GET /api/admin/card-data-status`, guarded by the existing Discord guild admin policy. A signed `engine-data-status` duel-host operation returns the shared `CardDataStatus` type: engine pins and bundle metadata, GitHub upstream freshness, catalog freshness, alias-aware gaps, and the weekly update workflow/PR status.

- [x] Add shared response types and targeted catalog sync/migration tests. Preserve TCG release dates; reuse successful `card_sets.synced_at` timestamps. Add a singleton revision with triggers to invalidate status only when catalog/set/artwork data changes.
- [x] Test and implement a single-pass family gap computation and a local snapshot reader. Read pins and CDB provenance from the manifest without editing prepare-data.ts. Label manifest mtime as a fallback for missing preparation timestamps.
- [x] Test and implement GitHub REST reads with one-hour per-URL caching, concurrent request deduplication, five-second deadlines including response bodies, and independent unknown results. Use compare `ahead_by` for pinned...HEAD.
- [x] Test and integrate the signed duel-host operation and admin API guard. Document the exported type and null/unknown semantics in the route.
- [x] Run only targeted tests under Node 22 with `prlimit --core=0`, typecheck shared/duel/web, review the diff, make small conventional commits with requested trailers, push without a PR, and delete created build/dependency output.

Catalog totals describe the locally cached catalog, not a claim that every YGOPRODeck card has been imported. Gap entries represent card families, with the newest known printing and null metadata when no dated set exists. Engine counts remain raw rows. Reverse gaps count engine families absent from the cached catalog.

Validation: Node 22.23.3, core dumps disabled; 15 shared/duel tests and 13 web tests passed (six targeted files), and shared/duel-server/web typechecks passed. Read-only code review resolved the name-treatment alias distinction. No prepare-data.ts edits.
