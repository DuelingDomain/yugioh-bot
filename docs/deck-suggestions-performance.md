# Deck Suggestions performance

The final production run **passed both gates**: uncached full HTTP p95 stayed below 400 ms for Normal and Domain, and additional retained Next-process RSS stayed below 5 MiB. It measured the actual Next.js 16.4.0 standalone server, authenticated `/api/cards/insights` requests, and the existing signed duel host. Production sources stayed unchanged during measurement; no allocator overrides were present.

Suggestion scans and tag decoding run in the duel host. Next retains at most 64 completed results and checks each cached result's context version with the host. The host disables its service result cache. The public HTTP API is unchanged. This placement keeps the web process within its budget; it does not establish a reduction in combined web and host memory.

The [complete final raw report](deck-suggestions-performance-results.json) records the run at `2026-10-20T00:40:08.987Z`, using Node `v22.23.3` on an AMD Ryzen 7 9800X3D host with eight logical CPUs available. The fixture loaded 14,845 catalog rows, 13,694 tag rows and 530 profiles from artifact `7ce6daa3e4f6251f353b6e41de3bd9ccbf842aa214740dba5d75e21c3a2b828f`.

| Final full HTTP measurement | Normal Blue-Eyes | Domain |
| --- | ---: | ---: |
| Main / Extra Deck cards | 60 / 15 | 60 / 15 |
| First suggestion, excluded from warm p95 | 419.445 ms | 323.952 ms |
| JIT warmup calls, excluded | 6 | 6 |
| Uncached measured requests | 60 | 60 |
| Uncached full HTTP p95 | **322.002 ms** | **321.732 ms** |
| Required p95 | <400 ms | <400 ms |
| Confirmed host computations, including first call and warmups | 67 | 67 |

Every timed request used a distinct legal Side Deck variant for Normal or Extra Deck variant for Domain, retaining exactly 60 Main Deck cards. The API accepts no cache-bypass parameter. Signed-host counters confirmed a full computation for every miss. Replaying all 64 cached Normal decks produced **64 `notModified` responses, zero recomputations and zero failures**, with **4.720 ms** full HTTP p95 including the version-validation round trip.

| Actual Next-process RSS | Bytes |
| --- | ---: |
| Initialized | 198,062,080 |
| Existing effect search warmed, before transport warmup | 224,395,264 |
| Existing effect search plus existing host transport baseline | **223,760,384** |
| After uncached suggestions | 201,052,160 |
| After filling 64 cache entries | 201,183,232 |
| Highest retained snapshot, after replaying all 64 entries | **214,552,576** |
| Highest snapshot minus the warmed baseline | **−9,207,808 / −8.781 MiB** |

The configured increase metric clamps negative differences to zero, so it reports **0 additional MiB** against the unchanged warmed baseline. This does not mean the cache allocates no memory: RSS rose 13,500,416 bytes / 12.875 MiB between the post-uncached and final replay snapshots, while remaining below that baseline. All intermediate readings remain in the raw report. RSS reflects allocator behavior as well as live JavaScript objects.

| Separate duel-host memory, outside the web gate | Warmed baseline | After 64 cache entries and replay | Signed change |
| --- | ---: | ---: | ---: |
| RSS | 271,179,776 bytes | 314,134,528 bytes | **+42,954,752 bytes / +40.965 MiB** |
| JavaScript heap used | 93,538,128 bytes | 98,964,840 bytes | +5,426,712 bytes |

The host snapshots are diagnostic and have no performance gate. They show where the scan cost moved. Both processes share the same disposable application metadata database; engine artifacts remain read-only.

The post-measurement Next CPU profile was 98.782% idle self samples while three fresh requests ran in the host. It does not profile host CPU. The raw profile and lifecycle logs remain under `/tmp/deck-suggestions-host-stream-final`. The benchmark exited successfully; lifecycle logging recorded Next's cleanup signal and listener closure only after the final report, and both children exited.

All 18 recorded production/benchmark source hashes matched before and after the run. SHA-256 of the compact `sourceBefore` JSON map: `3163123c8a348246d92ac06830345cfae66f38f5a2d3b456230a00b28c060d2b`. Fixture SHA-256: `f247202664aa8707845d4e77ad36b0eb592287f4490f7973e3b7b290b4e51d5e`.

The first Normal request exceeded 400 ms. Including the separately recorded first request with the 60 measured requests gives 61-request p95 values of **327.398 ms Normal / 323.952 ms Domain**, also below the target. Loopback HTTP, synthetic E2E authentication and forced-GC retained-memory snapshots limit these results. Browser rendering, Clerk network calls, TLS and concurrent-user capacity are outside this measurement.

## Previous web-side scans

The original stable production run below **failed both performance gates**. It measured the actual Next.js 16.4.0 standalone server, its authenticated insights endpoint, and a separate signed duel host. No development compiler ran during measurement. Source hashes stayed unchanged throughout the run.

Measured at `2026-10-20T00:01:48.479Z`, using Node `v22.23.3` on an AMD Ryzen 7 9800X3D host with eight logical CPUs available. The complete engine catalog had 14,845 rows. The pin contained 13,694 tag rows and 530 profiles; 13,530 engine catalog cards had tags. Artifact version: `7ce6daa3e4f6251f353b6e41de3bd9ccbf842aa214740dba5d75e21c3a2b828f`.

| Actual production measurement | Normal Blue-Eyes | Domain |
| --- | ---: | ---: |
| Main / Extra Deck cards | 60 / 15 | 60 / 15 |
| First suggestion, full HTTP | 619.796 ms | 602.584 ms |
| JIT warmup calls, excluded | 6 | 6 |
| Uncached samples | 30 | 30 |
| Uncached full HTTP p95 | **566.101 ms** | **595.140 ms** |
| Required p95 | <400 ms | <400 ms |

The production API does not accept a cache bypass. Each timed request therefore used a distinct legal Side Deck card for Normal or a distinct legal Extra Deck slot for Domain. Every input retained exactly 60 Main Deck cards. The bounded cache held 64 distinct Normal decks after the cache workload. Replayed full HTTP p95 was **6.216 ms**; cache hits do not satisfy the uncached gate.

| Actual Next process RSS | Bytes |
| --- | ---: |
| Initialized, before existing search work | 199,462,912 |
| Existing effect search warmed, before outbound transport warmup | 231,297,024 |
| Existing effect search plus existing host transport baseline | **225,357,824** |
| After uncached suggestion work | 236,302,336 |
| Highest retained snapshot, at 32 cached decks | **239,226,880** |
| After filling 64 cache entries | 232,046,592 |
| After replaying all 64 cache entries | **231,993,344** |

The maximum increase was **13,869,056 bytes / 13.227 MiB**, exceeding the <5 MiB target. Even the final replay snapshot remained **6.328 MiB** above the warmed baseline. Against the earlier effect-only baseline, the maximum increase was **7.563 MiB**. Retained JavaScript heap usage fell from 71,182,080 to 65,697,960 bytes; that does not establish an RSS pass.

Post-GC cache-population RSS at 8, 16, 24, 32, 40, 48, 56 and 64 decks:

```text
233906176, 231047168, 235683840, 239226880,
235073536, 232726528, 235020288, 232046592
```

Profiling ran afterward, over three fresh uncached Normal requests, so profiler allocations did not affect RSS. Of 1,577 self samples, catalog row/tag normalization accounted for **14.97%**, `foldCardText` Unicode/regex normalization **14.39%**, SQLite iterator `next` **8.62%**, `suggestionCandidates` **6.28%**, garbage collection **3.74%**, and `compactEffectName` **3.11%**. The first four costs together accounted for 44.26% of samples. These are the main remaining optimization candidates.

[Original raw report](deck-suggestions-performance-original-results.json) preserves vectors, exact decks, snapshots and source hashes. The CPU profile remains at `/tmp/deck-suggestions-next-final/web.cpuprofile`. Combined production-source fingerprint: `4e21ef216e8416e149021b00467d486729356ca57c8dc1742560275c84715587`. Fixture SHA-256: `f247202664aa8707845d4e77ad36b0eb592287f4490f7973e3b7b290b4e51d5e`. These results apply to that frozen snapshot, before subsequent optimization work.

The later frozen 60-sample web-side run at `2026-10-20T00:23:54.980Z` improved uncached full HTTP p95 to **357.189 ms Normal / 352.792 ms Domain**, but retained Next RSS rose **11.703 MiB** from its unchanged warmed baseline, so it still failed. Its complete vectors and snapshots are in the [native web scan report](deck-suggestions-performance-native-results.json).

A diagnostic allocator run with `MALLOC_TRIM_THRESHOLD_=131072` and `MALLOC_ARENA_MAX=2` measured **342.206 / 322.381 ms** p95 and **8.184 MiB** additional retained web RSS. That run also failed the memory target. Its [raw diagnostic report](deck-suggestions-performance-allocator-probe-results.json) is retained for comparison. No allocator override is part of the production change or final benchmark environment.

## Reproduce

Use a fresh worktree without environment files and installed dependencies. The script refuses Next startup if an environment file exists; it never reads one. Engine files and the source catalog remain read-only. Next authentication and maintenance use a disposable SQLite backup under the output directory. Both child processes exit before completion.

Create a complete catalog at a new disposable path:

```bash
prlimit --core=0 -- env PATH="/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH" \
  node --import tsx --input-type=module -e '
    const { loadDeckSuggestionQualityCatalog } = await import("./packages/shared/tests/fixtures/deck-suggestions-quality.ts");
    const loaded = loadDeckSuggestionQualityCatalog(process.argv[1], process.argv[2]);
    console.log({ cards: loaded.cards, artifactVersion: loaded.imported.version });
    loaded.db.close();
  ' /home/sulman633/repos/yugioh-bot/data/duel-engine /tmp/deck-suggestions-quality-repro.sqlite
```

Rebuild shared and Next after changing production sources:

```bash
prlimit --core=0 -- env PATH="/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH" \
  node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.build.json

prlimit --core=0 -- env -i PATH="/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH" \
  NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 E2E_AUTH=1 \
  E2E_AUTH_SECRET=benchmark-only-synthetic-session-key-0123456789 \
  E2E_NEXT_DIST_DIR=.next-deck-suggestions-perf \
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= \
  EFFECT_SEARCH=1 DECK_SUGGESTIONS=1 DISCORD_GUILD_ID=deck-suggestions-benchmark \
  DATABASE_PATH=/tmp/deck-suggestions-quality-repro.sqlite \
  DUEL_DATA_DIR=/home/sulman633/repos/yugioh-bot/data/duel-engine \
  node node_modules/next/dist/bin/next build packages/web --webpack

prlimit --core=0 -- env PATH="/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH" \
  env -u MALLOC_TRIM_THRESHOLD_ -u MALLOC_ARENA_MAX \
  node --import tsx scripts/deck-suggestions-benchmark.ts \
  --samples 60 --next --next-dist .next-deck-suggestions-perf \
  --catalog /tmp/deck-suggestions-quality-repro.sqlite \
  --engine /home/sulman633/repos/yugioh-bot/data/duel-engine \
  --output /tmp/deck-suggestions-next-repro --profile --check
```

The script starts the prebuilt real server on loopback, obtains a synthetic E2E session, and calls the production `/api/cards/insights` route. Its existing signed duel host runs separately with both `EFFECT_SEARCH=1` and `DECK_SUGGESTIONS=1`, using the same disposable application database as Next. The host computes every suggestion miss with its service result cache disabled. Twelve full-catalog effect searches warm the baseline; three existing card-detail calls then warm normal host transport. Both baselines remain in the report.

RSS is the actual Next process's `process.memoryUsage().rss`, evaluated through its loopback inspector after three forced garbage collections. All readings accompany each snapshot. Samples occur after uncached work, after every eight cache entries, and after replaying all 64 entries. The gate uses the highest retained snapshot, not heap usage or a favorable final reading. Allocator behavior and machine load affect RSS.

The first suggestion is separate from six JIT warmups and 60 uncached samples per format. Signed host counters must confirm one complete computation for each of those calls. The 64 cached replays must each receive `notModified` from the host and perform no new suggestion scan. P95 is the nearest-rank 95th percentile. Initial legality-scope preparation occurs during validated deck construction and is recorded separately. Next uses complete HTTP timings, including the signed host round trip; separate service timing is uninstrumented. Host baseline and post-cache RSS/heap snapshots are reported separately without a gate; they make the cost of the scan placement visible and do not alter the web baseline or <5 MiB requirement. Browser rendering, Clerk network calls and TLS are excluded.

Omit `--next` for the separate Node HTTP backend harness. That mode measures service time with `cache: false`; its RSS is not a Next.js measurement. Earlier harness runs changed source during measurement and were diagnostic: one recorded 763/675 ms p95 and +11.96 MiB against effect-only RSS; another recorded 677/692 ms and +8.63 MiB against warmed transport. They are not final gate evidence.

`--check` exits unsuccessfully if a timing/RSS target fails or relevant source/fixture bytes changed during measurement. The final production run exited successfully with all three recorded checks true and unchanged source hashes. The prior web-side runs exited unsuccessfully for measured target failures. The script passed its standalone TypeScript check; the production build passed compilation and TypeScript validation.
