# Remote Duels action data measurement — 2026-11-06

**Measured:** B reduced logical JSON writes by 95.9%, WAL traffic by 90.7%, action p50 by 86.0% and action p95 by 82.5%. Its player and spectator JSON values matched the current service after every one of 1,000 actions. Recommend this data layout, with production migration and immutability work below.

**Measured:** A reduced WAL traffic by 86.1%, but action p50 by only 5.6%. It is a smaller change if write traffic is the immediate problem. Neither prototype changes client payloads.

All timings and bytes below are **measured on x86**, unless marked **estimated**. KB means 1,000 bytes. Table capacities and days of work are estimates, not load-test results.

## What fills the state

A size-realistic mid-game fixture used two human seats, each with 40 Main Deck cards and 15 Extra Deck cards, no Side Deck, real catalog facts, and `banlist: none`. Each player had three monsters, three spell/trap twins, five graveyard twins, two banished twins and one hidden Extra Deck twin. The deck lists use two copies each of 20 distinct Main Deck codes and 15 distinct Extra Deck codes per player: 110 cards, 70 unique codes across the table. The benchmark tests table state handling with valid registered lists; card choices do not model a particular competitive strategy.

After 28 placement actions and 120 warm-up actions, state JSON was **440,335 bytes**. These are the exact UTF-8 bytes of each top-level value; key names, punctuation and separators account for the remainder.

| Top-level key | Measured value bytes |
|---|---:|
| `undoHistory` | 417,366 |
| `undo` | 11,489 |
| `deckChecks` | 7,221 |
| `seats` | 3,820 |
| `effectTracking` | 39 |
| `match` | 38 |
| `turnDraw` | 19 |
| `revealedHand` | 14 |
| `updatedAt` | 13 |
| `phase` | 6 |
| `gameId` | 5 |
| `battleEntered` | 5 |
| `startedSeats` | 5 |
| `ended` | 5 |
| `winnerSeat` | 4 |
| `attack` | 4 |
| `identified` | 4 |
| `showCardsSetFromDeck` | 4 |
| `seatCount` | 1 |
| `turn` | 1 |
| `turnSeat` | 1 |

The largest part is **undo history: 417,366 bytes (94.8%)**. History plus the legacy `undo` position is 428,855 bytes (97.4%). This seed has 20 history entries, two already undone, and 37 retained full positions including the legacy undo position. Those positions repeat 267,177 bytes of deck checks and 141,362 bytes of seat/board data.

Current `deckChecks`: format 267 bytes, registrations **970**, instances **5,932**, flags 2. Moving only the attached deck lists would save little. The copies inside undo are the problem.

**The event log and card facts are not top-level state keys.** Events already live in append-only `remote_events` rows. At the seed, 156 events contained 23,109 action JSON bytes, 1,170,088 effects JSON bytes and 774 message JSON bytes. The latest event stored **7,710 bytes of facts** inside **7,906 effects bytes**. The service resolves facts for every registered deck code on every action, including flips and LP changes. The same fact set is repeatedly appended to the log. Facts are removed from client projections, but current projection code first clones them and then discards them.

This fixture retains more board and undo data than the capacity report's 134–176 KB test. The seed alone is 440 KB; as a turn proceeds, both players' retained history increases the amount rewritten. Do not substitute its absolute timings for those smaller tables. The measured mean full state row was 745,033.849 bytes/action. This is a paired comparison of identical actions and state across the three implementations.

## The two prototypes

**A — lossless compression.** Store a versioned JSON envelope containing DEFLATE level 1 data as base64. Keep `match` and `revealedHand` at the root so existing metadata `json_extract` calls work. Inflate before reduction and projection. Keep event rows and client responses unchanged. This preserves the current TEXT column and SQL metadata reads, at the cost of encoding overhead and base64 bytes.

**B — immutable references.** Store complete before/after positions once in an additional table keyed by SHA-256 of their JSON. Store their references and existing undo metadata in the current state row. Intern each event-time fact set in the same way; events retain a fact reference. Read both legacy JSON and the new format. Insert new values, append the event and update current state in the same `BEGIN IMMEDIATE` transaction.

B also treats retained positions as immutable in memory: copy history metadata when editing it, preserve the retained positions, and clone only the current position during reduction. Projection skips private history that it immediately replaces with summaries, and skips server-only event facts that it immediately discards. A bounded decoded-value cache has 512 entries in this prototype. **B's latency saving includes these copy changes; it is not a claim that a schema change alone gives this speedup.** Its reference values are insert-only; old values were not garbage-collected in these measurements.

A new append-only event log would duplicate an existing feature. Periodic snapshots would add replay work to ordinary reads and reconnects. The dominant measured duplication supports storing immutable undo positions and facts once instead.

## Measured before and after

Each final variant ran the same **1,000 accepted actions**, after the same 148 warm-up/setup actions. The measured block is 750 flips, 75 hand-count corrections, 75 undos, 25 phase changes, 50 balanced LP changes and 25 turn endings. Every call was required to append exactly one event. Each action also ran both player GETs and public, private and spectator snapshot reads. There were 1,156 events at the end. No request was sent to a web or socket server.

Means for bytes; p50 / p95 for latency. GET bodies are JSON bytes **before HTTP compression, headers or TLS**. Socket bytes exclude Socket.IO framing.

| Measured bytes | Current | A: compression | B: immutable references |
|---|---:|---:|---:|
| Logical JSON supplied to changed state, event, deck and new value rows; bytes/action | 754,030.95 | 71,452.88 | 30,730.28 |
| WAL frames including frame headers; bytes/action | 798,237.64 | 111,285.32 | 73,879.84 |
| Process filesystem writes including normal checkpoints; bytes/action | 1,102,905.34 | 124,190.72 | 80,928.77 |
| Database growth after final checkpoint; bytes/action | 8,249.34 | 8,245.25 | 4,071.42 |
| Database growth over 1,000 actions; bytes | 8,249,344 | 8,245,248 | 4,071,424 |
| Final database file; bytes | 12,382,208 | 10,805,248 | 6,201,344 |
| Final state stored in the table row; bytes | 440,534 | 37,459 | 19,981 |
| Player A GET body, mean / p95 bytes | 38,525 / 39,372 | 38,525 / 39,372 | 38,525 / 39,372 |
| Player B GET body, mean / p95 bytes | 38,641 / 39,535 | 38,641 / 39,535 | 38,641 / 39,535 |
| Socket JSON total: public delivery to two players, two private deliveries, one spectator; mean bytes/action | 156,548 | 156,548 | 156,548 |

| Measured latency, ms p50 / p95 | Current | A: compression | B: immutable references |
|---|---:|---:|---:|
| Action through successful commit (`act`) | 29.09 / 53.16 | 27.45 / 38.17 | 4.07 / 9.30 |
| Work before the final COMMIT | 27.77 / 35.68 | 27.21 / 34.36 | 3.95 / 7.35 |
| Final COMMIT and return from transaction | 0.33 / 21.11 | 0.07 / 1.62 | 0.05 / 0.14 |
| Reducer only | 11.59 / 16.94 | 11.62 / 16.60 | 0.62 / 1.90 |
| Player A room read (`get`) | 12.24 / 15.60 | 11.71 / 15.44 | 2.86 / 5.56 |
| Player B room read (`get`) | 11.53 / 14.97 | 11.15 / 14.47 | 2.80 / 4.66 |
| WS reads: public + two private + one spectator | 44.28 / 54.45 | 42.99 / 54.58 | 6.98 / 12.18 |

`act` includes validation, reads, reduction, state/event writes, the actor's room projection and successful commit. It is also approximately the write-lock occupancy: that work happens inside `BEGIN IMMEDIATE`. The final COMMIT row measures only the tail after the callback returns; it includes checkpoint work performed there. The earlier report's action-to-commit time should not be described as pure SQLite commit or fsync time.

WAL bytes count actual appended frames using the shared-memory WAL frame counter and reset salt, including each 24-byte frame header and 4,096-byte page. Logical bytes sum state JSON supplied to the update, the new event strings, both deck JSON strings supplied to `syncDecks`, and newly inserted immutable JSON. They exclude SQL metadata and index overhead; a duplicate immutable value contributes no new JSON. The process write counter includes ordinary WAL checkpoints and small progress logs, but excludes the final forced checkpoint. Disk growth is measured from a checkpointed seed to the checkpointed final database, without VACUUM. It includes free-page reuse. These are three different quantities; **disk growth is not bytes rewritten**.

Both clients still receive full room responses. Their GET byte counts are identical across variants; the spectator socket body averages 15,817 bytes. Changing socket/GET protocols was unnecessary to obtain the storage and copy savings above.

## Estimated tables on one thread

Use the report's per-player rates: p50 3, p90 11 and p99 18 actions per active minute. Two players give 6, 22 and 36 actions/minute/table. Current code polls connected clients every **30 seconds**, rather than the 5 seconds described in the older report; `remote:changed` still starts a player GET after each action. A spectator receives a private projection and polls to keep its slot.

The model includes two players and one spectator. Next.js work per table-second is:

`(2 × rate / 60) × (mean act + mean GET A + mean GET B + 3 × 5 ms route work) / 1000`

`+ (2 × (mean player GET + 5 ms) + mean spectator GET + 5 ms) / 30000`.

The **5 ms per route is estimated**, retained from the capacity report. It was not measured here. Counts are `floor(thread budget / work per table)`. The first x86 count leaves the same 60% thread budget used in the report's 12-table warning; the second is the 100% mathematical ceiling. ARM counts use **estimated 3–4×** x86 work and a 60% budget, following the report. This also scales storage waits and is only a planning assumption.

| Estimated rate/min | Current: x86 60% / 100%; ARM 60% | A: x86 60% / 100%; ARM 60% | B: x86 60% / 100%; ARM 60% |
|---|---:|---:|---:|
| 3 per player (6 per table) | 69 / 115; ARM 17–23 | 74 / 124; ARM 18–24 | 180 / 301; ARM 45–60 |
| 11 per player (22 per table) | 21 / 36; ARM 5–7 | 23 / 39; ARM 5–7 | 58 / 97; ARM 14–19 |
| 18 per player (36 per table) | 13 / 22; ARM 3–4 | 14 / 24; ARM 3–4 | 36 / 61; ARM 9–12 |

At the busiest rate, the action/write-lock portion alone gives an estimated x86 60% ceiling of 31 current, 36 compressed and 211 reference-based tables. GETs and estimated route work reduce those counts to the web-thread limits above. The mean action/write-lock time falls 85.3%.

Means used in the model, all measured in ms:

| Variant | Act | GET A | GET B | All four WS reads | Spectator GET |
|---|---:|---:|---:|---:|---:|
| Current | 32.101 | 12.299 | 11.797 | 43.936 | 7.360 |
| A: compression | 27.191 | 12.075 | 11.292 | 43.015 | 6.841 |
| B: immutable references | 4.723 | 3.119 | 3.016 | 7.573 | 0.751 |

WS is a **separate process/thread**, so its snapshot cost is not added to the Next.js thread. With one spectator, its own estimated 60% x86 ceiling at 36 actions/min is: Current 22; A: compression 23; B: immutable references 132 tables. The web-thread estimate is the tighter constraint in this model. This is not a simultaneous-table load test and reserves no measured budget for live-duel writes, other Next.js routes, authentication or storage contention. More spectators, four-player boards and their larger histories were not benchmarked. The old “about 12 busy tables on ARM” figure remains an assumption, not a measured hardware limit or a calibrated starting point for multiplying these gains.

## Risks and estimated effort

| Area | A: compression | B: immutable references |
|---|---|---|
| Rooms in progress / deployment | Medium. Dual-read old JSON and the new envelope; convert on a successful write. Deploy readers in web and WS before enabling new writes. Preserve SQL metadata fields. Rollback can inflate state rows after pausing writes. | Higher. Add value storage and versioned references before new writes. Keep legacy event effects readable and leave historical append-only rows intact. Write referenced values and the event atomically. Old binaries cannot read new references; keep the new decoder available during rollback. |
| Undo | Low semantic risk: full positions are preserved. Corruption must fail the transaction. | Medium/high implementation risk. Preserve complete positions, metadata, dependency rules and coalesced camera corrections. Shared positions must remain immutable, including table-rule overlays. Freeze/copy checks and broader undo cases need production coverage. |
| Reconnect | Full snapshot and sequence recovery stay the same. Inflate adds work to each read. | Resolve all references after restart; missing values must fail closed. Bound the cache by bytes and room lifecycle. Reconnect with an empty cache passed locally. |
| Spectator projection | Existing projection runs after decoding. Envelope/data must never become an API response. | Hydrate before the existing privacy functions. Never send references or server fact sets to clients. Skipping a clone must not change hidden-card filtering or mutate shared data. Both player views and spectator views matched after every action. |
| Replay | Original event log and event-time facts remain unchanged. | Retain every facts value referenced by an event, including old banlist/card metadata. Garbage collection must distinguish live undo positions from replay facts. Full replay passed for this script; effect search, siding, 3/4 seats and older event versions need wider coverage. |
| Live duels sharing SQLite | Smaller WAL writes and fewer checkpoints help; compression CPU still runs while holding the writer. | Much shorter action lock time and less WAL traffic help. Adds value-table writes and cache/retention work. Do not run a bulk backfill or cleanup in a long transaction. `busy_timeout` still allows a competing writer to wait; live-duel contention was not tested. |
| Work, estimated engineering days | **1–2 days**, including dual-read rollout, corruption handling and targeted checks. | **5–8 days**, including immutability audit, value retention, legacy rooms/events, rollback and focused game-flow checks. |

Compression did not reduce ongoing event-log growth in this fixture. B approximately halves disk growth here, but different actions can create a fresh full undo position every time. Retention and garbage collection are needed before treating this measured growth rate as a production storage promise.

## Host, checks and reproducibility

Measured host: Ryzen 7 9800X3D exposed as eight x86 CPUs under Microsoft/WSL2; Node **22.23.3** from nvm; temp files on ext4 (`/dev/sdd`). Each process ran with `prlimit --core=1:1 -- taskset -c 6`. The host was shared, not isolated. Final load averages (1/5/15 minute) at start/end: Current 2.72/2.98/2.63 → 3.27/3.10/2.71; A 2.61/3.15/2.62 → 2.69/2.98/2.63; B 2.60/2.93/2.68 → 2.93/2.98/2.71. Per-core counters were recorded; CPU 6 was kept busy by the benchmark and other cores had ongoing work. There were storage outliers: the worst action in the final comparison was 263.8 ms. p95 is not a worst-case lock guarantee.

Used the real service and migrations from detached HEAD **6db4b7a95afd4e017e3c95390c920a3f5e20e92c**, with instrumentation and prototype adapters only in the new scratch worktree. SQLite settings were measured: **WAL, synchronous=NORMAL (1), 4,096-byte pages, 1,000-page autocheckpoint, foreign keys on, 5-second busy timeout**. Durability settings were unchanged. The source branch independently advanced to `8db15e9a4e2cd27e86418499cb0c963c8f670262` during the research. It was left untouched; the scratch copy stayed pinned to the original HEAD. That newer commit changes no action persistence path. The first comparison and the final comparison each ran 1,000 actions per variant; final figures above use the corrected Extra Deck twin identity and the final B projection optimization.

For each of the final 1,000 actions, checks compared canonical JSON values for the full server state, both player rooms, public socket snapshot, both private socket snapshots and spectator snapshot. Only the random room slug was normalized. All three variants matched. JSON comparison correctly treats omitted `undefined` properties as absent, as HTTP/socket serialization does. Aggregate SHA-256 of the 1,000 canonical per-action hashes: `1275d00f9b466a89acc51f006dc565972355991ce8c742a11778ea57599dd836`.

Focused follow-up checks passed across all variants: reopening the temp database with empty decoder caches; reading a legacy unencoded room and converting it on the next action; room-list SQL metadata; idempotent retry with a stale base sequence; stale-action rejection; forced full replay of 1,156 events with event-time facts; spectator GET privacy; turn-boundary undo; and out-of-order single-card undo. No full test suite ran. Single measured first reconnect GET: 7.24 / 7.38 / 3.16 ms (Current / A / B). Single forced full-replay GET: 14,415.53 / 14,549.67 / 753.91 ms. Those last samples are checks, not latency distributions.

To reproduce: create a detached scratch worktree at that HEAD; point all database paths and `DUEL_DATA_DIR` to a fresh temp directory; copy the catalog CDB there (measured SHA-256 `4c4025613e2fb7588ad8e520a16af72d9d7e509f7848a9bffec461f1cbcd0548`); use nvm Node 22 and the core limit above. Create two users and registered decks through the actual saved-deck/remote services, join, ready and start. Place the 14 twins per seat described above; warm for 120 actions, then measure 25 blocks of 40 actions. In each block, indices 0–35 flip one of three set cards cyclically, except 8/18/28 set hand count to 5 or 6 and 9/19/29 undo that correction. Index 36 sets Main Phase 2, 37 subtracts 100 LP, 38 restores it, 39 ends the turn. Alternate the acting seat each block. Use deterministic action IDs/times and advance `baseSeq` from every returned room. Measure synchronous `act` and GET calls with `performance.now()`, count WAL frames outside the timing interval, and checkpoint before/after the 1,000-action window.

The lists were selected deterministically from the catalog: TCG bit set, alias zero, Token bit clear, ID below 100,000,000, sorted by ID; the first 40 Main-Deck-compatible codes were split 20 per player and doubled, and the first 30 Extra Deck codes split 15 per player. Extra Deck type mask: Fusion 0x40, Synchro 0x2000, Xyz 0x800000, Link 0x4000000.

Implementation points: `services/remote-duels.ts` state load/save, event encode/decode and transaction wrapper; `remote/undo.ts` history metadata copies; `remote/games/ygo.ts`, `live-deck-checks.ts`, `hand.ts` and `match.ts` current-position copies; `remote/privacy.ts` projection copies. Web `use-remote-room.ts`, WS `remote-events.ts` and the schema were read to verify polling, fan-out, metadata and append-only constraints. Their product behavior was unchanged.

Cleanup: scratch worktree, benchmark code, copied catalog, temp databases/WAL/SHM and other benchmark temp files were removed. This task made no commits or pushes and changed no files in existing worktrees. No live database, :3000 unit or Docker container was used or changed. The requested report is the only retained task artifact.


## Production design B — 2026-11-06

Rebuilt on `619bb2799` in `feat/remote-undo-once`. Complete undo positions live in SHA-256-addressed `remote_values`; versioned state JSON holds references and unchanged history metadata. `remote_events.facts_hash` owns interned event-time facts. Inserts, event append, reference changes and state update share the existing `BEGIN IMMEDIATE`. Legacy JSON/events remain readable; the measured new run starts from the old run's checkpointed mid-game database and upgrades on its first action.

Retained positions are recursively frozen **in production**, including decoded legacy positions and Undo's derived position. Reducers copy the current position and history bookkeeping separately; table-rule overlays use copy-on-write. Indexed room/value ownership collects positions as history trims. Event-owned facts survive trimming and room end for event reads/replay. Ended rooms retain Undo and reconnect behavior. Explicit `purgeEnded(cutoff, limit<=100)` is the retention boundary: room deletion atomically removes events, seats, references and newly unreferenced values. No automatic expiry policy is introduced. Search reads now hold a SQLite snapshot to prevent collection racing hydration. Deploy the new shared reader in web, WS and worker together before accepting new-format writes; older binaries cannot decode references.

Final paired run: Node 22.23.3, Ryzen 7 9800X3D/WSL2, ext4 temp SQLite, one CPU (`prlimit --core=1:1 -- taskset -c 6`), WAL/NORMAL, 4096-byte pages, 1000-page autocheckpoint, foreign keys on, 5 s busy timeout. No test/build jobs ran alongside the final pair. Shared host load (1/5/15 min), old: **2.38/2.45/1.92 → 2.92/2.56/2.00**; new: **3.63/2.77/2.10 → 2.94/2.70/2.09**. These are service calls with a **new service per call**, including construction in timings; no HTTP/socket server, authentication or network timing. The catalog SHA-256 matches the prototype above. Fixture: 110 registered cards/70 codes, 14 twins per seat, hidden Deck identities, 28 placements + 120 warm-ups, then 1,000 accepted actions (750 flips, 75 hand corrections, 75 undos, 25 phases, 50 LP changes, 25 turn endings).

| Measured, old → production B | Result |
|---|---:|
| Act p50 / p95, ms | 22.48 / 49.41 → **4.65 / 13.67** |
| Act mean, ms | 29.696 → 6.529 |
| Player A / B GET means, ms | 7.012 / 7.109 → 4.748 / 4.547 |
| Spectator poll / four WS reads means, ms | 5.243 / 23.834 → 1.574 / 12.205 |
| WAL bytes/action (frames + headers, act only) | 702,311.68 → **78,415.96** (−88.8%) |
| Process filesystem write bytes/action | 945,004.54 → **90,845.18** (−90.4%) |
| Checkpointed DB growth / final size, bytes | 8,253,440 / 12,173,312 → **0 / 3,919,872** |
| Final state row, bytes | 390,538 → 18,422 |
| Post-GC heap / RSS / sampled peak RSS, MiB | 31.94 / 222.23 / 324.60 → **33.76 / 195.73 / 225.12** |

Zero new file growth reflects reuse of free pages inherited from the legacy seed, **not zero steady-state storage growth**. Filesystem writes include checkpoints and the scripted reads/spectator slot updates; the final forced checkpoint is excluded. DB growth is file size, not bytes rewritten. The module-level decoded LRU survives service reconstruction: **896,145 cache hits**, 207 entries at the end, 2,095,872 UTF-8 JSON bytes charged at 4× = **8,383,488 bytes**. Limits are **512 entries and 8 MiB charged bytes per process**, across databases; the 4× charge estimates object/string overhead, not an exact heap measurement. Process memory above includes the cache and weak hash/JSON memo; isolated cache heap was not measured. Collected disk values may remain decoded until LRU eviction.

Both players, actor response, public/two private WS snapshots and spectator poll/snapshot matched as canonical JSON **after every action**. All 1,000 per-action SHA-256 values matched; aggregate `ee91f7f00714c6cdeafc42ddc295f9f074d2d77583a6aa082c36d3b1ca0a6a83`. Separate cold processes passed reconnect and forced full replay, including mixed legacy/new event facts. The existing Remote Duels integration file passes **197 tests**, with one new feature case covering atomic rollback, legacy upgrade, freezing, trimming, missing values, rule overlays, cross-request caching, shared facts, end/retention/direct deletion, and a second connection collecting positions during a read. Shared, web, WS and worker typechecks pass after the shared declaration build. No new unit test file or full suite. Reproducer: `scripts/remote/measure-undo-once.ts`; archive the base shared sources/tests to a temp directory, run old, then run new with old's `seed.sqlite` as its final argument; compare the two `*-hashes.json` files.

**Estimated busy 1v1 capacity:** at 18 actions/player/min (36/table), two players + one spectator, 30 s polling, 60% thread budget, ARM **3–4×** x86 work: **old 4–5 → new 7–10 tables/web thread**. Formula follows the earlier report: `0.6*(mean act + GET A + GET B + 15)/1000 + (GET A + GET B + spectator poll + 15)/30000` seconds/table-second; 15 ms is three **estimated** 5 ms route costs. WS has a separate estimated 20–27-table ARM ceiling. This is a single-room warmed-cache model, not simultaneous-table or ARM hardware testing; many rooms can evict one another's cache entries. No browser/e2e, power-loss/crash, live-duel contention, large retention-backlog or multi-room memory/load benchmark. Build output and temporary measurement databases/catalogs were removed; no push or live service/database changes.
