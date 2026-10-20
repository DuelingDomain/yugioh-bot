# Replay open measurements (2026-10-20)

Opening a replay had four large costs: uncompressed frame JSON, synchronous field crack geometry for healthy boards, layout of hidden three-seat fields before the first fit, and command-by-command transport between the host and engine worker. Database reads were small. The existing server already cached replay builds and cross-version verification; adding a second cache or retaining warm engine workers would not address the largest costs.

## Method

Node 22.23.3, isolated worktree `replay-perf`, E2E slot 7 (web 3371, ws 3373/4374, duel 4375), its own SQLite database, and a worktree-local prepared engine bundle. No production ports, containers, live database or shared local-all stack were used. Prebuilt WASM cores were copied into the prepared bundle; no core compilation was needed. The test machine has 47 GiB RAM; these are local measurements, not production VM measurements.

The E2E helper plays real engine commands and stores the journal plus every final seat projection. The long 1v1 has 240 commands / 242 frames; FFA3 and Tag each have 120 commands / 122 frames. Deterministic 200-card Normal Monster decks and disabled admission validation allow long turn/discard histories. The source bundle label is then changed to exercise current-engine final-board verification. A separate integration suite also uses genuinely different prepared source/current bundles, including unknown legacy-family selection and edited-board refusal.

Browser measurements use a production standalone build, Chromium, a 1280×720 viewport, reduced motion, offline card-image fixtures, and CDP network limits of 10 Mbit/s download with 20 ms latency. Each before/after table uses the median of three runs. Each format has a first build and a repeat open that uses the existing host cache. First board means the replay controls/board DOM appeared; a double requestAnimationFrame records a paint opportunity. This is not a GPU presentation measurement. Frame JSON is fully verified before display.

A separate CPU profile found 647–3,005 ms of self time in the field crack measure/generate layout effect. This work ran at stage 0, when no crack was drawn. A second mask layout effect also consumed about 220 ms on FFA3. The fix skips geometry and its observers until a replay frame has damage. A follow-up CPU profile attributed another 3,072 ms to the FFA stage’s initial size measurement, which flushed layout while three fields were mounted at scale zero. Heavy replay fields now mount after the stage has its first real size. Camera wrappers and the counterrotated ring stay mounted so reduced-motion camera state survives replay seeks. Live duel behavior is unchanged.

## End-to-end results

Medians of three runs, milliseconds from navigation. “Paint” is the double-rAF paint opportunity described above. Independent stage medians do not necessarily sum to median totals.

| Format / open | Board DOM before | Board DOM after | Paint before | Paint after |
| --- | ---: | ---: | ---: | ---: |
| Long 1v1 / first | 7,351.5 | 2,214.8 | 7,360.9 | 2,906.6 |
| Long 1v1 / cached | 6,917.0 | 1,220.9 | 7,048.7 | 2,862.8 |
| FFA3 / first | 6,305.8 | 4,322.3 | 6,706.6 | 4,502.0 |
| FFA3 / cached | 3,552.8 | 2,012.1 | 4,018.7 | 2,173.6 |
| Tag / first | 3,874.5 | 2,089.8 | 3,950.7 | 2,172.0 |
| Tag / cached | 2,884.6 | 1,297.9 | 2,989.6 | 1,382.0 |

Browser stages below show **before → after** in ms. Request start includes navigation, session/page work, bundle fetch and hydration; header wait includes host build/cache access, web serialization and first gzip output. Body-to-DOM includes client parsing and synchronous React/layout work. The later paint opportunity also includes pending browser layout.

| Format / open | Navigation → API send | API send → headers | Body transfer | Body → board DOM |
| --- | ---: | ---: | ---: | ---: |
| Long 1v1 / first | 1,134.2 → 1,207.3 | 1,085.9 → 874.7 | 4,283.9 → 89.3 | 673.8 → 43.9 |
| Long 1v1 / cached | 806.8 → 814.4 | 187.5 → 176.6 | 4,279.8 → 89.1 | 1,691.8 → 144.2 |
| FFA3 / first | 778.2 → 816.5 | 1,019.7 → 781.3 | 1,324.9 → 26.4 | 3,258.7 → 2,690.9 |
| FFA3 / cached | 396.1 → 409.4 | 121.3 → 114.4 | 1,329.8 → 27.6 | 1,707.0 → 1,463.4 |
| Tag / first | 395.0 → 408.4 | 1,052.6 → 815.4 | 1,538.9 → 30.8 | 1,053.2 → 844.2 |
| Tag / cached | 415.4 → 404.8 | 125.0 → 131.7 | 1,541.2 → 29.9 | 820.0 → 732.6 |

| Format | JSON bytes before | Wire bytes after (gzip) | Reduction |
| --- | ---: | ---: | ---: |
| Long 1v1 | 5,335,828 | 109,543 | 97.9% |
| FFA3 | 1,652,248 | 32,415 | 98.0% |
| Tag | 1,918,455 | 37,043 | 98.1% |

Initial encoded JS was 695,578 bytes before and 695,618 bytes after. Client bundle size did not explain the multi-second body transfer or layout cost, so no new lazy-loading boundary was added. The 1v1 DOM appears quickly after JSON, but its paint opportunity still follows browser layout. FFA3 retains a substantial layout cost; this work reduces it without changing the table design. Follow-up full-page profiles showed that even a stage with no seat fields could flush expensive layout, so the initial `clientWidth` profile alone does not identify every expensive subtree. Controlled CSS overrides of ring text size and hidden-canvas layout did not remove that remaining cost.

## Server and storage trace

Temporary timers were added at page/API/host boundaries, resource resolution, engine identity verification, card catalog load, core creation, Lua setup, journal capture/encoding, and saved-board comparison. They were removed before commit. The CPU profile and E2E resource timings remain reproducible through the opt-in experiment.

The page authenticates in `app/(app)/duels/[slug]/replay/page.tsx`; client hydration starts the selected ordinary/owner replay API request. Both web routes authorize before calling `src/lib/duel-host.ts` and recheck access after the host wait. The host reads the saved projections, private journal and source/resource stamps, looks up the existing bounded build/verification caches, then builds a detached replay on a miss. It checks every saved final seat/public board on a cross-version miss, rechecks source/access, and returns the selected projection. The web redacts tournament metadata and now streams gzip. The client parses the complete verified response and renders the selected board.

Snapshots can be plain JSON or gzip BLOBs; projection decoding and canonical board stamps are preserved through compaction. In the measured fixtures, all saved boards together were 337 / 368 / 490 KB (1v1 / FFA3 / Tag); gzip reduced these to 15.6 / 21.0 / 26.9 KB. Reading/decoding all seat/public boards took approximately 0.7–1.1 ms plain and 1.1–1.7 ms compressed. The command journals were only 25.1 / 12.3 / 12.3 KB. Storage is not the main delay.

A representative first 240-command 1v1 build gave these server times. These are single diagnostic traces on the same fixture, not the browser medians. Nested rows overlap and must not be added to totals. Worker startup is derived from the traced outer/inner run intervals after subtracting identity/verification as applicable.

| Server stage (ms) | Before | After |
| --- | ---: | ---: |
| Source DB read and stamps | 6.9 | 7.3 |
| Current resource resolution | 329.4 | 322.6 |
| Worker bootstrap/message overhead, approximate | 52.9 | 89.3 |
| Worker engine identity check | 246.4 | 235.0 |
| Card catalog load | 185.6 | 202.1 |
| Core creation (within engine create) | 6.4 | 6.7 |
| Lua setup (within engine create) | 21.3 | 22.7 |
| Engine create, including core/Lua | 36.3 | 38.4 |
| Journal build including worker/startup/encoding | 912.2 | 742.5 |
| Final saved-board comparison | 1.9 | 3.5 |
| Host total, first build | 1,278.8 | 1,099.9 |
| Host total, cached open | 74.6 | 69.2 |

The simulation/encoding work after initialization fell from approximately 391 ms to 174 ms. Resource hashing, card load, core/Lua startup and the final comparison are retained. Repeat opens do not rerun the engine or final verification when source and resource/projection stamps match.

## Changes and bounds

- Run the existing journal runner, answer validation, frame projection and JSON encoding beside the engine in its detached worker. Return one bounded batch instead of several messages and a serialization-worker handoff per command. The host still verifies final boards before cache insertion or response. The fallback transport remains available for adapters.
- Stream gzip from both authenticated web replay routes when the client accepts it. Keep identity responses, JSON shape, redaction, post-build access checks and `private, no-store`. No compressed-response cache is added.
- Mount multi-seat replay canvas children after the stage is measured, avoiding the hidden zero-scale field layout. Camera refs and the turn ring remain mounted.
- Skip field geometry work on healthy replay frames. Seeking to damage generates the correct geometry; seeking back removes masks/SVG and disconnects observers. Live fields keep their existing behavior.

The 16 MiB frame/checkpoint cap, 64 MiB / 16-entry LRU, two concurrent builds, bounded wait queues, worker heap/operation limits and 25/28-second build/request deadlines remain. Workers terminate after each build; no resident engine pool is added. One bounded batch crosses the thread boundary and can briefly coexist in worker/host memory. Gzip streams avoid retaining a second complete compressed response buffer. First opens still pay current-resource checks and engine/card initialization. Damaged-frame seeks still compute their visible crack geometry.

## Reproduce

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
# Prepare worktree-local resources and install the required built cores first.
export DUEL_DATA_DIR="$PWD/data/duel-engine"
npm run build --workspace=packages/shared
npm run build --workspace=packages/duel-server
npm run build --workspace=packages/ws
npm run build --workspace=packages/worker
NODE_OPTIONS=--max-old-space-size=8192 E2E_SLOT=7 npm run stack:build --workspace=packages/e2e
E2E_SLOT=7 E2E_WORKERS=1 E2E_DUEL_DATA_DIR="$DUEL_DATA_DIR" \
  E2E_REPLAY_PERF=1 E2E_REPLAY_MBIT=10 E2E_REPLAY_EXPECT_GZIP=1 E2E_REPLAY_LABEL=final \
  npx playwright test duel-replay-performance -c packages/e2e/playwright.config.ts --repeat-each=3
E2E_SLOT=7 E2E_WORKERS=1 E2E_DUEL_DATA_DIR="$DUEL_DATA_DIR" E2E_OWNER_USER_IDS=101,104 \
  npx playwright test duel-replay-access -c packages/e2e/playwright.config.ts
```

The experiment writes `packages/e2e/.stack-7/replay-<label>-<repeat>.json`. Omit `E2E_REPLAY_MBIT` for loopback measurements; set `E2E_REPLAY_CPU=1` to save per-open CDP CPU profiles. The baseline used origin/main at `41aa04b8b`, before these optimizations. It passed before any fix was applied. No new unit tests were added.

## Validation

- Production web build and duel-server/E2E typechecks pass on Node 22. E2E typechecking also passes with `packages/duel-server/dist` absent, matching the CI job; fixtures import the source engine helpers.
- Five targeted real-engine integration files pass: **47 tests**, including the new detached-worker equivalence/lifecycle tests, current/legacy/pinned families, Normal/Domain, FFA3/FFA4/Tag, cursors, changed final boards, overflow/final-board fallback, a 1,500-command journal and fork recovery. Host replay event-loop p99 was 2.94 ms in the long-journal run.
- A separate run with two actual prepared bundle identities passes **3 cross-version tests**: current-package verification, edited-board rejection and unknown historical engine-family selection.
- Clean browser access run: **3 replay E2E tests** plus 5 auth setup checks pass. These cover gzip/identity/q=0, private/public and per-seat projections, seated and nonseated owner access, compressed snapshot compaction, healthy/damaged/backwards seeking, all three seat fields, fly camera position and ring rotation after seeking.
- A final helper check also passes all 3 replay E2E cases plus the performance probe through the owner route (6 additional measured opens).
- Final rate-limited experiment: **3 repeats**, each with first/cached 1v1, FFA3 and Tag opens, all verified, gzip and healthy geometry assertions pass (18 measured opens).
- An additional existing live FFA3 test (`duel-3p-ffa-table.spec.ts:77`) failed its old assertion that turn 3 has no Battle Phase. The installed core offers Battle Phase on turn 3 as required by ADR-0002 R-FFA-NO-ATTACK. It had already mounted all three fields and passed its field/EMZ checks. Its unfinished live duel redirected two later replay page checks; the fresh isolated replay run passes all three tests. The unrelated live-rule test was not changed.

Temporary production timers and browser override experiments were removed. No engine `.build` directory was produced or left behind. No new unit tests were added.
