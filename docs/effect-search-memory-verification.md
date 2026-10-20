# Effect startup memory verification

2026-10-18, local x86_64 Linux host, Node 22.23.3. Engine resources were opened read-only at `/home/sulman633/repos/yugioh-bot/data/duel-engine`. No server entry point or environment file was loaded. ARM64 production measurements remain unverified.

The importer keeps its synchronous API. Native zlib streams each gzip into a private temporary file in a short-lived Node process; the parent reads bounded chunks and immediately inserts validated pin records into SQLite. Neither process materializes a complete tag/profile payload. Temporary files are removed in `finally`, including failures. The largest temporary file is the 24,182,853-byte tag JSONL; the filesystem needs that much temporary space. The tradeoff is temporary file I/O and decoder startup. An in-process streaming decoder was also measured, but its buffer allocations left enough resident allocator pages to miss the target.

Every startup still checks the pinned manifest, compressed and decompressed hashes, byte lengths, JSONL counts and release identity. The independent preparation/publication verifier retains complete schema validation and requires complete normalized tag/profile records. Runtime import trusts those exact verified body bytes and uses SQLite JSON extraction for tag metadata and storage fields, avoiding redundant JavaScript object construction. Integration coverage compares all 13,694 imported tag bodies and all 530 profiles against the schema/normalization oracle.

Import markers persist original source passcodes/names and profile memberships. A reused pin verifies its files and recomputes canonical membership without parsing tag bodies. A legacy marker with absent memberships backfills once without rewriting tag/profile rows. Reports retain exact manual ownership counts, including case sensitivity and identity resolver changes. Artifact writes and markers remain one immediate transaction.

Duel startup awaits `initializeCardEffectIndex`. A separate Node process reads compact facets from SQLite under a read-only transaction, interns repeated arrays, filters, events, effects, supports and release pairs, and writes compact facet chunks to a private temporary file. Construction caches and each facet chunk are bounded to 1,024 rows. The child explicitly collects its temporary JavaScript data before serializing each length-prefixed chunk, closes SQLite after completing the snapshot, writes remaining facets/dates/profile names, and exits. Only then does the parent read each bounded chunk, deserialize and merge its Maps, and install the resulting compact graph. Neither child construction nor serialization retains the entire facet graph at once. The pure builder has type-only shared imports, avoiding a duplicate application runtime. Production bounds its old space to 32 MiB and semi-space to 1 MiB. These bounds were verified for the current pin; substantially larger future artifacts may require revisiting them. Source/development uses the existing tsx API and 48/4 MiB limits; it is covered by the parity integration, but is not the production memory profile. Dependency module URLs resolve relative to the installed code, independently of the working directory.

The synchronous `createCardEffectIndex` API remains for fixtures and callers; the asynchronous initializer falls back to it for in-memory databases or an existing transaction. The parent uses shared printed-type fragments and one synchronous match record populated from its engine catalog, instead of retaining another complete metadata map. Retained facets omit summaries and annotation prose. A file-backed integration compares every engine card's effect scores, dates and popularity across both paths, as well as all evaluation readings.

## Measurement

```sh
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
prlimit --core=0 npm run build --workspace=packages/shared
prlimit --core=0 npm run build --workspace=packages/duel-server
prlimit --core=0 node --expose-gc --import tsx \
  packages/duel-server/scripts/effect-search-benchmark.ts \
  --engine-directory /home/sulman633/repos/yugioh-bot/data/duel-engine \
  --index-module packages/duel-server/dist/card-effects.js \
  --output .status/effect-search/perf-chunks1024-final-1.json
```

Each invocation creates one disposable file-backed SQLite database. First import and reused-version startup run in separate fresh processes against that same file; both await and probe the actual production initializer from compiled duel-server code. The benchmark runner itself uses tsx; the compiled preparation child uses ordinary JavaScript without inherited preloads or instrumentation. The engine/name-query baseline is warmed before measuring feature startup. Each retained memory snapshot performs two full garbage collections with event-loop turns between them. The parent application does not require exposed GC. The disposable facet preparation child deliberately enables and calls GC before serializing each bounded chunk; this is part of its production memory bound, distinct from the benchmark-only forced collections of the parent snapshots.

`startupPeakRssDelta` uses the process high-water RSS from `process.resourceUsage()` and includes transient allocations before forced GC. It excludes child processes. The supervisor additionally samples the summed RSS of the startup process and its descendants every 5 ms, only during startup. This includes gzip decoders and the facet preparation process; the historical `sampledDecoderPeakRss` field measures all preparation children. `sampledProcessTreePeakRssDelta` is a sampled peak and may miss shorter transients. Peak and retained growth subtract the same process's engine baseline. These numbers do not include filesystem page cache or the benchmark supervisor.

The comparison baseline is importer/index code from merged commit `3e6e2f4b0`, relocated into disposable `.status/effect-search/baseline/` modules with only import paths and the artifact directory changed. Both sides use the same date-aware artifact pin `7ce6daa3e4f6251f353b6e41de3bd9ccbf842aa214740dba5d75e21c3a2b828f`, 14,845 engine records and 13,694 canonical imported tags. The optional `--import-module` and `--index-module` benchmark arguments select those baseline modules. No tracked source was reverted for the comparison.

| Implementation | Startup | Retained RSS growth (MiB) | Parent peak growth (MiB) | Whole-tree peak growth (MiB) | Index live heap (MiB) | Startup (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | First import | 57.14 | 109.12 | 109.00 | 22.01 | 1391 |
| Baseline | Reused pin | 61.74 | 114.85 | 114.60 | 22.00 | 757 |
| Final run 1 | First import | 24.59 | 28.05 | 98.31 | 15.92 | 1448 |
| Final run 1 | Reused pin | 17.38 | 21.21 | 92.82 | 15.90 | 899 |
| Final run 2 | First import | 20.89 | 27.50 | 98.86 | 15.92 | 1592 |
| Final run 2 | Reused pin | 16.84 | 18.11 | 90.80 | 15.91 | 819 |
| Final run 3 | First import | 24.29 | 28.51 | 98.50 | 15.91 | 1394 |
| Final run 3 | Reused pin | 16.24 | 17.76 | 91.34 | 15.91 | 802 |

All six final startups meet the 30 MiB retained-growth target. The largest first-import whole-tree peak is 98.86 MiB versus 109.00 MiB for the matched baseline; the largest reused-pin peak is 92.82 MiB versus 114.60 MiB. Preparing smaller chunks raises retained graph size slightly compared with global interning, but releases child construction state earlier and gives the startup peak margin. First-import startup is 1.39–1.59 seconds; reused startup is 0.80–0.90 seconds.

Raw reports: `.status/effect-search/perf-before-final.json` and `.status/effect-search/perf-chunks1024-final-{1,2,3}.json`. Each includes all phase snapshots, import/index timings, latency samples, actual index size and process-tree peak samples.

The older supplied `.status/effect-search/perf-before.json` reports 69.77 MiB retained growth for the previous artifact pin. It is historical context; the table uses the matched date-aware pin and updated measurement harness.

Earlier implementations missed the retained target in some fresh processes (including 31.78, 32.47 and 33.08 MiB first-import growth). A thread worker also left allocator residue, while a child importing the full application runtime raised total peak RSS; neither is the final production path. Their raw reports remain under `.status/effect-search/`; these misses were not discarded when selecting implementation changes. The final results above use consecutive runs of the final implementation. The 4,096-row transport prototype also had a 109.76 MiB first-import whole-tree peak, slightly above the matched baseline; the final 1,024-row bound provides more margin.

## Verification

- Artifact integration: 25 tests, including bounded 48 MiB JavaScript heap import/reopen, every-record schema equivalence, repeated-pin corruption for all files, legacy marker backfill, canonical resolver changes, case-sensitive ownership, SQLite failure rollback, canonical dates/artworks and coverage.
- Final duel source integration: 76 tests (66 effect-search integration, including all-card chunked child parity, plus 10 card-search), using the read-only engine directory above. All 64 evaluation queries retain TP 87, FP 0, FN 0, TN 75.
- Shared build, final compiled duel build and final duel TypeScript checks pass. Production memory measurements use the final compiled modules; source/development parity uses the final TypeScript child path.
- No new unit test file, engine data change, server launch or new runtime dependency is required.
