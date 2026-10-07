# Card data status follow-up

The user has authorized implementation, targeted verification, small conventional commits, and a push of `feat/card-data-status` without a PR. Work stays in the existing worktree; use Node 22 and `prlimit --core=0`. Do not change prepare-data.ts, production, environment files, or occupied ports.

The primary gap covers dated TCG sets released in the last 12 calendar months through today. Fetch through the existing shared `fetchCardResource` queue. A durable per-set cache stores compact card identity/printing metadata, never full API payloads. Released sets older than 60 days are immutable; sets at most 60 days old refresh daily. Cold and stale reads return immediately and deduplicate background refreshes. Unknown set counts stay null. Compare the installed merged cards.cdb, canonical engine aliases, and catalog/API artwork families; distinguish same-name/type ID mismatches from genuinely missing families and exclude skills/tokens.

- [x] Add regression tests for retained release dates and all catalog/artwork revision triggers; add the durable per-set cache migration and fix set upserts.
- [x] Replace catalog-only gap semantics, test recent-set selection/fetch/cache/refresh/alias behavior, retain a clearly named cached-catalog diagnostic, and throttle local snapshots to 60 seconds. Use the startup manifest, validate only sources.databaseFiles, and leave preparation time unknown.
- [x] Test and implement compact GitHub caching, expiration pruning, five-minute failure caching, rate-reset cooldowns, safe links, default-branch HEAD and compare-base pin dates, and root `cards.cdb` plus `release-*.cdb` filtering. Remove standalone pin-commit and repository calls for approximately nine requests per hourly refresh. Serve cached status while refreshing in the background.
- [x] Integrate the signed host operation, log local errors, scope a web transport deadline to engine-data-status, and document semantics and optional production-unset GITHUB_TOKEN. Never use BUG_REPORT_GITHUB_TOKEN.
- [x] Run targeted shared/duel/web tests and touched-package typechecks and review the changes.

Validation: 42 targeted shared/duel tests and 16 targeted web tests pass under Node 22.23.3 with core dumps disabled. Shared, duel-server, and web typechecks pass. Read-only review found and resolved unsynced-index false zeros and impossible-date overwrite cases; their regressions failed before the fixes. The primary count stays null before the set index syncs. Release dates must round-trip as real calendar dates. Printing-code regression coverage preserves a known full code when another printing omits it.

Delivery sequence: make small conventional commits with the requested trailers, push this branch without a PR, and remove generated dependencies/build output.

Validation commands: `prlimit --core=0 -- npx vitest run packages/shared/tests/services/card-data-sync.test.ts packages/duel-server/tests/card-data-status.test.ts packages/duel-server/tests/recent-card-sets.test.ts packages/duel-server/tests/github-card-data-status.test.ts packages/duel-server/tests/host-card-data-status.test.ts`; web tests use `-c packages/web/vitest.config.ts`. Build shared before consumer checks; typecheck shared, duel-server, and web individually.
