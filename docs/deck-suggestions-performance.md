# Deck Suggestions performance

Catalog scoring runs in two reusable read-only worker threads. The duel host creates the authoritative legality scope and passes that scope to a scanner. Admission allows one in-flight request per player and two globally; excess requests receive HTTP 429 before card normalization or scope preparation. Scans bypass the shared catalog queue, so they cannot queue other card operations behind their CPU work. The web process retains at most 64 completed results and validates their context version with the host.

## Live-duel concurrency check

Measured on 2026-10-20 with Node 22.23.3, the real pinned Normal engine, 14,845 catalog records and the pinned effect artifact. The disposable application database used the same WAL journaling mode as production. Ten distinct uncached signed suggestion requests ran while a live duel accepted commands.

| Measurement | Result |
| --- | ---: |
| Accepted / rejected suggestion requests | 2 HTTP 200 / 8 HTTP 429 |
| Rejected request latency | 7.27–7.42 ms |
| Baseline live `respond`, 10 samples: p95 / maximum | 33.65 / 33.65 ms |
| Concurrent live `respond`, 20 samples: p95 / maximum | 25.80 / 31.85 ms |
| Largest event-loop interval, sampled every 5 ms | 19.66 ms |
| Cold / warm legality-scope preparation | 22.53 / 0.135 ms |
| Accepted concurrent suggestion latency | 941.80 / 1045.75 ms |

The requests exercise signature verification, host routing, authoritative legality, worker scoring and real engine responses. They call `host.handle` directly, so network transport, authentication-provider calls and browser rendering are excluded. The cold scope measurement follows host startup and live-engine initialization; it is not a completely cold process measurement. The two accepted scans ran alongside browser checks on the same machine. Their timings measure bounded concurrent work, not a sequential suggestion p95 guarantee. Worker-process memory was not remeasured.

The targeted signed-host integration also sends ten requests from the same player: one succeeds and nine receive 429. A following request succeeds, proving the admission slot is released. Its deterministic fixtures cover matching service results, conditional versions, membership checks, invalid requests and changing admission policy.

## Previous single-request production measurement

Before worker isolation, a standalone Next.js 16.4.0 production run at `2026-10-20T00:40:08.987Z` measured authenticated loopback HTTP requests against the signed duel host. The fixture contained 14,845 catalog rows, 13,694 tags and 530 profiles from artifact `7ce6daa3e4f6251f353b6e41de3bd9ccbf842aa214740dba5d75e21c3a2b828f`.

| Historical measurement | Normal Blue-Eyes | Domain |
| --- | ---: | ---: |
| First request, excluded from warm p95 | 419.45 ms | 323.95 ms |
| Uncached samples after six warmups | 60 | 60 |
| Uncached full HTTP p95 | 322.00 ms | 321.73 ms |

All 64 cached replays returned `notModified`, with no recomputations and 4.72 ms full HTTP p95. Highest retained Next RSS remained below its unchanged warmed baseline, giving zero additional MiB under the benchmark's clamped metric. Host RSS rose 40.97 MiB. These results describe the previous synchronous host scorer; they do not establish the memory or sequential latency of the worker implementation.

Earlier web-side scans measured 566.10 / 595.14 ms p95 and 13.23 MiB additional retained web RSS. A later web-side run reached 357.19 / 352.79 ms but still retained 11.70 MiB. No allocator override is part of production.

## Reproduction

Use Node 22 and an installed engine resource bundle. The benchmark opens engine data read-only and writes a disposable application catalog and reports to caller-selected locations. It refuses Next startup when environment files exist. Keep generated SQLite databases, raw JSON, CPU profiles and build output outside tracked documentation.

The reusable HTTP benchmark is [scripts/deck-suggestions-benchmark.ts](../scripts/deck-suggestions-benchmark.ts). Its `--next`, `--catalog`, `--engine`, `--next-dist`, `--output`, `--samples`, `--profile` and `--check` options select a prebuilt standalone Next server, fixture paths and gates. Build shared and Next before running it after source changes. `--check` validates timings, retained RSS and unchanged source/fixture hashes. The live-duel burst described above is a separate concurrency check.
