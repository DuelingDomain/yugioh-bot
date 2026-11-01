# Multi-engine backend review fixes — 2026-10-30

All 16 kept entries are addressed; duplicate entries share fixes. Rejected findings were left alone. Code fixes were reviewed again after implementation. No new unit-test files or UI component edits are part of these commits.

| Commit | Fix group | Kept entries (1-based review order) |
| --- | --- | --- |
| `fb61ce497` | Score every engine's best forward/reverse pair; keep display at three; persist artifact-only hub/IDF snapshots with pinned-file backfill; capture the related-engine context once | 1, 7, 11 |
| `7cc977024` | Normalize open-deck artwork IDs in every zone before detection/points/missing copies; accept validated deck point caps | 3, 4 |
| `2623db629` | Rescan complete outgoing candidates; exclude rejected/disputed/reported pairs before shortlist/dedupe; fix reviewed-engine accounting; retry partially failed reviews after ten minutes; retain full ranking inputs | 2, 5, 6, 9, 14, 15, 16 |
| `873f436ca` | Contain completion and queue-drain exceptions; retry durable writes without blocking on SQLite locks; deduplicate/throttle progress writes | 12, 13 |
| `8d9167dd8` | Isolate full fast requests, deep shortlist filtering and completed next-engine projections in workers; evaluate each projection gate once; bound/coalesce requests and add revision-aware short caching | 8, 10; protects the full-input deep projection as well |

The fast route permits one distinct request in flight per user and eight distinct requests globally. Equivalent requests share work. Its cache holds at most 64 results for five seconds and includes guild, deck context and SQLite revisions. The scanner queue is bounded to sixteen, with one bridge scanner active so a second remains available for Suggestions. Busy actors get 429, global overload gets 503, and both include a one-second retry hint. Feedback written through another DB connection invalidates cached results on the next request.

Artifact import now snapshots ranking statistics into bridge_graph. Existing installations backfill from verified pinned files rather than from the mutable bridge table. The multi cache-key discriminator is `multi-v2`, invalidating previously degraded multi results while preserving the legacy single-source tuple. Failed attempted reviews are recorded separately from intentional stop-rule leftovers. Progress integration dropped 188 UPDATE attempts to two; final completion still persists 100%. Completion writes retry asynchronously until recovery or shutdown, when startup recovery handles interrupted jobs.

Response shapes are unchanged. The request type gains optional `deck.pointCap` (integer 0–1000, default 100). Artwork normalization and the cap also apply to subscriber context in deep searches. Scores, coverage and two-way labels now use all accepted candidate rows, so coverage may exceed the number of displayed links. Three links remain the judging/display maximum. Internal job status projection is asynchronous.

## Verification

Node **v22.23.3**, direct local tool entrypoints with the Node 22 bin directory first in PATH. All paid judge calls were mocked; benchmarks made none.

- Shared: **69 passed** across `bridge-engines`, `archetype-bridges`, `bridge-access`, `bridge-round3`, and `bridge-judge` integration files.
- Duel server: **35 passed** across `bridge-engines`, `bridge-search-jobs`, `bridge-workers`, `bridge-api`, and `bridge-niche` integration files.
- Web route: **16 passed** in `card-bridges-route.integration.test.ts`.
- Shared and duel-server production builds: passed. Shared production-source no-emit check and full duel-server no-emit check: passed.
- Full shared no-emit check reports four pre-existing TS7006 errors in `tests/notify/join-request.test.ts` (three callback parameters) and `tests/services/deck-sections-lookup.test.ts` (one callback parameter). Those files were not changed.
- Web no-emit check failed during concurrent UI work at `src/components/bridges/bridges-row.tsx:118` (TS2554: expected two arguments, got one). UI edits were left untouched and excluded from these commits. Concurrent `bridges-api.ts` also sends both deck and engines to deep search, which the unchanged exclusive-selector contract rejects.

Representative exact commands, from the repository root (each run used Node 22 in PATH):

```sh
node node_modules/vitest/vitest.mjs run --root packages/shared tests/bridge-engines.integration.test.ts tests/archetype-bridges.integration.test.ts tests/bridge-access.integration.test.ts tests/bridge-round3.integration.test.ts tests/bridge-judge.integration.test.ts
node node_modules/vitest/vitest.mjs run --root packages/duel-server tests/bridge-engines.integration.test.ts tests/bridge-search-jobs.integration.test.ts tests/bridge-workers.integration.test.ts tests/bridge-api.integration.test.ts tests/bridge-niche.integration.test.ts
node node_modules/vitest/vitest.mjs run --root packages/web tests/card-bridges-route.integration.test.ts
node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.build.json
node node_modules/typescript/bin/tsc -p packages/duel-server/tsconfig.build.json
node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.build.json --noEmit
node node_modules/typescript/bin/tsc -p packages/duel-server/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p packages/web/tsconfig.json --noEmit --incremental false
```

Integration checks include four-source coverage with reverse links; stable statistics after deep writes/restart/backfill; artwork detection and copy subtraction; zero/custom/invalid caps; complete forward scans after a legacy result; shortlist eligibility; partial review retries vs intentional stops; completion/drain fault injection without unhandled rejection; actual file-DB worker heartbeats for fast and completed-status projections with more than 100 stored rows; cache expiry, per-user/global admission, coalescing and cross-connection feedback invalidation.

## Engines operation measurements

The baseline was captured before code changes at `24f7f4da5`. All runs use the same committed bridge artifacts, a disposable WAL file database, zero judgement records, the actual authenticated host handler and Node 22. These are local **host-op** timings, excluding HTTP/network latency and live judge work. Each case has one first pass plus twenty warm samples; p95 is nearest rank (sample 19 of 20). A 2 ms heartbeat measures the largest excess timer gap per request as an event-loop blocking proxy; scheduler jitter and GC contribute to that number. The first pass for each set can inherit worker/index state from an earlier set in the process.

The heavy set is **The Weather + Genex + Synchron + Blue-Eyes**. Cache-hit measurements and forced-cache-miss measurements are shown separately. Forced misses update the DB revision before every request, outside the timed interval.

| Format, heavy set | Before op p95 ms | After cached op p95 ms | After uncached source op p95 ms | Loop block p95 before → after uncached ms |
| --- | ---: | ---: | ---: | ---: |
| Advanced | 1188.72 | 0.12 | 478.81 | 1187.89 → 0.85 |
| Genesys | 1104.80 | 0.09 | 392.66 | 1104.00 → 3.99 |

The heavy Advanced first request fell from 3,062 ms to 2,291 ms in the forced-miss source run; its work now runs off-thread. The largest first-pass heartbeat delay across all source-after cases was 6 ms, versus 3,062 ms before. Cold response latency can still be about 2.3 seconds; worker isolation protects the host loop during that time.

The compiled JavaScript worker branch was also exercised with forced misses:

| Format, heavy set | Built uncached op p95 ms | Loop block p95 ms | Maximum loop block ms |
| --- | ---: | ---: | ---: |
| Advanced | 464.31 | 0.67 | 0.85 |
| Genesys | 388.83 | 3.00 | 8.84 |

Both the smaller Odion + Ashtra set and heavy set were measured in both formats. Full aggregate outputs are in [bridge-multi-engine-review-fixes.json](bridge-multi-engine-review-fixes.json). The benchmark is [benchmark-engines.ts](../../scripts/effects/benchmark-engines.ts).

```sh
NODE_OPTIONS=--conditions=source node node_modules/tsx/dist/cli.mjs scripts/effects/benchmark-engines.ts
NODE_OPTIONS=--conditions=source node node_modules/tsx/dist/cli.mjs scripts/effects/benchmark-engines.ts --uncached
NODE_OPTIONS= node node_modules/tsx/dist/cli.mjs scripts/effects/benchmark-engines.ts --built --uncached
```

All benchmark databases, fixture directories, and generated shared/duel-server dist trees were deleted after verification. No push or PR was made. Commits use explicit paths and contain no attribution trailers.
