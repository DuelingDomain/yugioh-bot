# Duel server memory investigation — 2026-10-21

The selected changes reduce the complete workload's idle RSS from **568 to 382 MB** (33%) and anonymous RSS from **498 to 311 MB** (37%). Three concurrent practice duels peak at **1,025 MB RSS**, down from **1,201 MB** (15%). A continuously active single duel, after the warm spare expires, changes from **458 to 377 MB RSS** and **387 to 306 MB anonymous**. These are local measurements, not a production deployment or a forecast of its exact RSS.

## Production context and scope

The supplied production observation was 16 hours uptime, one live duel, 806 MB cgroup memory (613 MB anonymous; 175 MB file, including 169 MB inactive file), and Node RSS 655 MB with 14 threads. The 169 MB inactive file is reclaimable cache; it is not all retained Node heap. The 256 MB worker setting is a V8 limit, not an eagerly reserved 256 MB allocation, and does not cap WASM/external memory.

No production process was contacted or changed. All writes used scratch SQLite copies. Engine resources were read only from `/home/sulman633/repos/yugioh-bot/data/engine-main-prerelease`; neither live engine directory was accessed. No `.env` file was read: the benchmark preload intercepts dotenv's attempted reads. No rules, core, card loader, journal behavior, engine heap cap, worker capacity or FIFO limit changed.

Baseline: `origin/main` at `277f266fa`. Local platform: x86_64 Linux, Node 22.23.3, glibc 2.39; production's Docker base is Node 22 Bookworm. The copied local application DB has 2,047 cached catalog rows; the engine CDB has 15,004 cards. Startup imported the pinned **13,693 effect tags and 530 profiles**. Sentry's SDK was preloaded in every performance variant, with an empty DSN to avoid network delivery; a separate smoke check confirmed that main-thread reporting still delivers an error envelope to a local receiver. Enabled production tracing and longer traffic history were not reproduced.

## What owns the memory

Heap snapshots identify these major holders. Sizes below are approximate JS ownership via shortest strong retaining paths, rather than disjoint RSS measurements; shared strings/objects make them non-additive.

| Holder | Measured size / behavior | Decision |
|---|---|---|
| Full card catalog, labels, name search and script path index | About **35 MB per engine isolate**, also present in the host; script path map alone about 8.5 MB. A warm spare had 58 MB total retained JS before, about 43–44 MB after. | Preserve local, warm engine data and the spare to avoid adding lookup/start latency. Lua files are read as needed, not an eager copy of every script's text. |
| Host admission catalog | About **30 MB**, including its own card records and script paths; another shared metadata/identity catalog about **11 MB**. | Preserve admission semantics and fast starts; consolidating these needs a separate engine-data design. |
| Host effect/search indexes | Compact effect facets about **14 MB**, card search about **9 MB**, artwork-family index about **11 MB**. Fully warmed host heap stays about **149 MB** before and after. | Already finite, shared within the host, and not initialized in every engine. Preserve these useful warm caches. |
| Suggestion scanners | Two persist indefinitely before the fix: about **32 MB retained JS each** after idle GC (44–45 MB during scans), plus module, SQLite and allocator overhead. | Retire after 30 s idle; reuse during a burst, retain two-worker admission and 256 MB heap caps. |
| Inherited Sentry imports | Resource worker's retained graph about **21.7 MB** before versus 7–8 MB after; engine/spare heaps lose about **13–14 MB per thread** too. | Dynamically import SDK only inside the main-thread branch. The host still reports engine errors. |
| Live WASM/external memory | About **21–23 MB external per live engine** in these normal duels, around 18 MB above a warm spare. It disappears when the engine thread exits. | Do not change core allocation or heap settings. This reproduction did not show a surviving WASM leak after worker close. |
| glibc retention | Identical original workload: **568 MB idle RSS with defaults vs 441 MB with 2 arenas**, with nearly unchanged live JS heap. After worker fixes, defaults vs 4 arenas are **452 vs 382 MB**. | Use **4 arenas**. Two saves another 32 MB in the final workload but produced less favorable action tail latency. |
| Replay rebuilds/cache | Rebuild engine is temporary; existing cache is bounded to 64 MiB / 16 entries, two concurrent builds and eight cache waiters. Global engine reservation still caps workers at 12 with up to 32 FIFO rebuild waiters. | Keep the existing bounds. One replay did not account for hundreds of MB of retained JS. |

A single live duel is only part of the process: the host retains search/admission data, an engine owns another catalog and WASM, and a practice start prepares an additional catalog-only spare for two minutes. Past scanner and engine activity also leaves allocator pages behind. This explains a large low-concurrency process without assuming that one core consumes the full anonymous total. The production observation alone cannot establish the exact split; no production heap was captured.

## Before / after

All numbers are decimal MB from `/proc/PID/status`; RSS includes file-backed code/libraries. The full workload includes effect search, staples, release sorting, two suggestion scans, practice summon + placement, response-mode actions, three parallel practice duels, surrender and a verified replay response.

| Phase | Before RSS | After RSS | Before anon | After anon |
|---|---:|---:|---:|---:|
| Boot, resources warmed | 414 | 361 | 348 | 295 |
| Name search + release sorting | 439 | 382 | 370 | 314 |
| Effect search + staples | 442 | 384 | 374 | 316 |
| One suggestion scan | 499 | 489 | 429 | 419 |
| Two concurrent scans | 583 | 555 | 513 | 485 |
| One practice duel + warm spare | 882 | 785 | 811 | 714 |
| Three practice duels + warm spare | 1201 | 1025 | 1130 | 954 |
| Immediately after surrender | 845 | 635 | 775 | 565 |
| After 35 s cleanup | 695 | 422 | 624 | 352 |
| Replay rebuilt and returned | 699 | 427 | 628 | 356 |
| 40 s after replay | 626 | 428 | 555 | 357 |
| All idle; warm spare expired | 568 | 382 | 498 | 311 |
| One duel, 135 s, spare expired, no scanners | 458 | 377 | 387 | 306 |

`DUEL_IDLE_WORKER_MS=2000` shortened the test only; the existing 30 s sweep was allowed to run. The unchanged 120 s warm spare expires before the last full-workload row. The single-duel run sends views every 800 ms so its live engine survives the idle timeout while the spare expires. The scanner count changes from two to zero after its new idle timer. Final full-workload native thread count is **15 before / 13 after**; engine threads have exited, and the host resource hasher remains warm.

The host alone was explicitly GC'd once after searches/scans: its used heap is **142.8 MB before / 142.8 MB after**. Every phase includes `process.memoryUsage()`, `v8.getHeapStatistics()` and heap-space statistics for each active isolate. Per-worker `rss` is process-wide and must never be summed. Heap snapshots were taken in a separate diagnostic run, or after all measured phases, because taking a snapshot itself greatly increases RSS. The exploratory snapshot run is excluded from every before/after RSS table.

## Isolating the changes

| Configuration | Three duels RSS | Cleanup RSS | All idle RSS | All idle anon |
|---|---:|---:|---:|---:|
| Original, allocator defaults | 1201 | 695 | 568 | 498 |
| Original, 2 arenas (experiment) | 1113 | 567 | 441 | 370 |
| Worker fixes, allocator defaults | 1103 | 494 | 452 | 381 |
| Worker fixes, 2 arenas (rejected) | 991 | 385 | 351 | 280 |
| Worker fixes, 4 arenas (selected) | 1025 | 422 | 382 | 311 |

The main-thread SDK guard and scanner expiry alone are useful; allocator tuning is an additional measured reduction. Four arenas were chosen over two to favor duel input latency.

## Duel latency

Fresh scratch duels, same signed HTTP path, 100 warmup response-mode changes then 250 measured changes per run (below the existing 400-change cap). These operations include worker transport, durable journal writes and room projection. Values below summarize repeat medians; ranges show scheduling/GC variability.

| HTTP configuration | Samples | Median action, ms | Median per-run p95, ms | Per-run p95 range, ms |
|---|---:|---:|---:|---:|
| Original | 750 | 2.78 | 3.89 | 3.78–8.04 |
| Worker fixes, default arenas | 1000 | 2.73 | 3.67 | 3.58–3.71 |
| Worker fixes, 2 arenas | 500 | 2.81 | 5.63 | 5.46–5.79 |
| Worker fixes, 4 arenas | 1000 | 2.72 | 3.53 | 3.43–6.68 |

Three concurrently active engine workers also ran 9,000 warmed `setChainMode` + `view` samples per variant: median **0.365 → 0.354 ms**, median per-run p95 **0.757 → 0.773 ms** (about 0.016 ms difference). Their actual summon/placement calls completed too. This checks concurrent worker traffic independently of HTTP and SQLite; it does not establish identical tails on every machine.

The full-workload summon + placement median is **9.37 → 8.06 ms** (two actions each); response-mode median **3.29 → 2.79 ms** (12 each); practice-start median **655 → 628 ms** (three each); replay rebuild **945 → 573 ms** (one each). These small cold samples are not tail-latency guarantees. The 2-arena variant had a 33.8 ms cold response and 5.5–5.8 ms per-run sustained HTTP p95, so it was not selected despite lower RSS. The warmed spare and all live-engine caches stay intact.

## Verification and reproduction

- Duel package typecheck and build passed.
- Real worker preload, idle expiry/reuse/crash recovery, and signed host suggestion integration: **11 passed**. New tests are integrations only.
- Effect-search integration: **161 passed**.
- Selected real Standard / legacy Domain worker integration: **2 passed**; other engine combinations were deliberately excluded.
- Main-thread Sentry envelope delivered to a loopback receiver with a synthetic DSN.
- Review addressed both pending-retirement shutdown tracking and already-signaled child cleanup in the measurement driver.

Build the two packages, then run the committed Linux-only driver against an input database opened read-only for SQLite backup:

```sh
prlimit --core=0 -- npm run build --workspace=packages/shared
prlimit --core=0 -- npm run build --workspace=packages/duel-server
prlimit --core=0 -- env MALLOC_ARENA_MAX=4 node packages/duel-server/scripts/measure-memory.mjs \
  --database /path/to/source.sqlite \
  --data /home/sulman633/repos/yugioh-bot/data/engine-main-prerelease \
  --output /tmp/duel-memory-fresh-run --port 4023 --inspect-port 9223
```

Use a fresh output directory. `--single` measures the continuously active single duel; `--short` stops after scanner expiry; `--snapshot` writes the main heap snapshot only after the measurements. The driver rejects ports 3000/4003, verifies the inspector PID, blocks dotenv reads, sets `core=0`, uses its own writable DB copy, and stops its own child by PID. To reproduce the original SDK-only single-duel control after building the fix, the scratch driver used a transpilation of `origin/main`'s preload; no scanner was started and the engine source was unchanged.

Full local raw results, main/worker heap snapshots, analyses, HTTP action timings, and the original reproduction driver remain under `/tmp/duel-memory-20261021/`. `before-full`, `before-arena`, `after-default`, `after-arena`, and `after-arena4` contain the allocator/worker ablations; `single-before`, `single-after-default`, and `single-after-arena4` hold single-duel runs. The compact checked-in JSON contains no actor data or database contents. Built `dist` output is removed after verification.

Mechanism references: [Node worker preloads inherit CLI flags](https://nodejs.org/docs/latest-v22.x/api/worker_threads.html#launching-worker-threads-from-preload-scripts) and [glibc allocator tunables](https://www.gnu.org/software/libc/manual/html_node/Memory-Allocation-Tunables.html). The SDK holder and allocator deltas above were measured locally, not inferred from those references.
