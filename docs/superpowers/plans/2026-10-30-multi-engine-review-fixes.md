# Multi-engine backend review fixes

**Goal:** Address all 16 kept review entries (including duplicate reports), preserve response shapes, keep live duels responsive.

**Architecture:** Reuse the existing scanner workers for the complete fast engine request. Compute ranking from every eligible pair while retaining three display links. Persist artifact-only ranking statistics and distinguish transient review failures from intentional budget stops.

**Constraints:** Node 22; existing integration files only; no UI changes, pushes, PRs, attribution trailers, or broad staging. Explicit-path commits, one per fix group. Disposable benchmark databases and removal of generated output.

- [x] Ranking and artifact context: reproduce four-source coverage loss; use best forward/reverse for every source; snapshot stats during artifact import/backfill; capture one engine for related checks. Check shared bridge integration suites. Commit shared ranking changes.
- [x] Deck identity and cap: reproduce alternate-art detection/points failure and custom cap loss; normalize all deck zones through card_artworks before resolving context; accept validated optional deck.pointCap. Check existing host integration tests and web request boundary. Commit deck context changes.
- [x] Complete scans and review lifecycle: always perform complete outgoing scans rather than reuse truncated single-source results; gate shortlist before dedupe; count only shown/newly reviewed engines; persist incomplete metadata for failed attempted reviews and retry after ten minutes. Check host engines/job integrations. Commit search correctness changes.
- [x] Durable job safety: contain completion/drain failures and retry persistence; throttle and deduplicate progress writes. Inject SQLite failures and count actual writes in existing job integration suite. Commit runtime durability changes.
- [x] Worker isolation and admission: send full engines resolve/project to scanner pool; bound queue, one in-flight request per actor, coalesce equivalent active requests, short revision-aware cache; use one gate evaluation per projected candidate. Check actual worker isolation, overload, feedback invalidation, and existing bridge APIs. Commit worker changes.
- [ ] Final verification: targeted integration suites, relevant TypeScript checks; identical file-DB benchmark before/after (20 warm calls per case, heartbeat timer drift), plus uncached worker checks. Record SHAs and measurement limitations; remove temporary/build output. Commit reproducible benchmark and evidence.

Baseline captured before implementation with `NODE_OPTIONS=--conditions=source node node_modules/tsx/dist/cli.mjs scripts/effects/benchmark-engines.ts` on Node 22.23.3. Targeted verification uses existing shared bridge-engines/archetype-bridges/bridge-access/bridge-round3 and host bridge-engines/bridge-search-jobs/bridge-workers/bridge-api/bridge-niche integration files; web boundary checks use card-bridges-route.integration.test.ts. Each commit stages only the named source and integration files for its group.
