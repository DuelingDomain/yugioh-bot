# Dice result to duel field

The main delay was a full engine resource scan after the opening result. The
host read and hashed the script files before it could create a worker. Each new
worker then checked the bytes again. The first host scan was slow. The dice
screen stayed visible during this work.

The host now starts the resource scan when an authorized player reads a lobby.
The scan runs in a separate resource worker. It does not delay the lobby reply.
One warmup is shared by all tables with the same resource selection. Automatic
starts also request a warmup when they enter the opening. A real start still
calls the normal cache lookup. That lookup validates file metadata, or shares a
lookup that is already in flight. The game worker still hashes the actual bytes
and rejects an identity mismatch before it creates an engine.

No live core is reused. The engine still starts after the server settles the
opening. Dice rolls, deadlines, seat moves, seeds, rules, and journal commands
are unchanged. Warmup failures do not reject lobby reads. A real start can retry
the resource lookup and report its normal error.

## Evidence and method

The read-only local service log on 2026-10-16 contains this `duel_start` record:
slug `7vtm4wuf`, total **6,735.4 ms**, resource checks **6,088.1 ms**, worker
startup **340.6 ms**, card database **173.8 ms**, engine creation **128.6 ms**,
first view **3.8 ms**. The log does not identify the table format.

Temporary timing logs isolated the file scan. The first measured script hashes
took **6,886 and 7,460 ms**. Later hashes took about **195–283 ms**. The script
folder is 94 MiB. This pattern is consistent with cold file I/O. System caches
were not cleared. Both the host resource worker and each new game worker read
this folder. The host cache already existed, but the lobby did not populate it.

Measurements used Node 22.23.3 and isolated slot 7: web 3371, Socket.IO 3373,
WS internal 4374, duel host 4375. They used one human and bots in the other
seats, Standard rules, shuffled decks, an unlimited turn timer, and 900 ms bot
pacing. The 1v1 case was an actual RPS loss to a bot. Bot picks stayed hidden.
Human wins were cancelled and retried.

The prepared bundle at `/home/sulman633/repos/yugioh-bot/data/duel-engine` was
read only. Its manifest pins an older wrapper. `E2E_MANUAL=1` used the existing
manual-stack helper to verify the installed wrapper patch and write a derived
manifest under `.stack-7`. The cores and scripts were unchanged. No cores were
rebuilt. No :3000 service, container, or `local-all` file was changed.

The main comparison is the median of three full-motion browser runs per
version. The later runs alternated baseline and fixed hosts. The baseline was
`origin/main` at `68c28fcf5`. All runs used the same production web build and the
same engine data. Only the duel host build changed. This keeps client code the
same for both versions. The shared change is a TypeScript interface only.

Times start when the final dice result first appears, or when the RPS loss
appears. Tag has no opening; its time starts at the Start click. A MutationObserver
recorded the first field DOM. Two requestAnimationFrame callbacks then recorded
a visible field. This is a paint opportunity, not a GPU presentation timestamp.
Files were in the OS cache for these runs. Other work ran on this machine, so
small differences are not proof of an improvement.

## Before and after

All times are milliseconds. Each value is a median of three runs.

| Format | Engine start before | Engine start after | Result to field before | Result to field after |
| --- | ---: | ---: | ---: | ---: |
| FFA4 | 1,254 | 739 | 3,130 | 2,358 |
| FFA3 | 1,125 | 793 | 3,618 | 2,968 |
| Tag | 920 | 920 | 1,686 | 1,644 |
| 1v1 | 969 | 611 | 2,750 | 2,192 |

FFA4 field time fell by 25%. FFA3 fell by 18%. The 1v1 case fell by 20%.
Tag's total engine time was unchanged within measurement precision. Its shorter
host scan was offset by more worker and card-database time in these samples.
The small Tag field-time change is within the observed variation.

The warmup moves the large first resource scan into lobby preparation. It does
not remove resource checks. If a player starts at once, a warmup can still be in
flight. If resources change, the start must check the new resources. These cases
can still take longer.

The full-motion field samples, in run order, were:

| Format | Before samples | After samples |
| --- | --- | --- |
| FFA4 | 3,551.0, 3,129.7, 2,522.0 | 4,201.6, 2,358.3, 2,334.0 |
| FFA3 | 3,617.8, 2,925.4, 3,955.4 | 3,183.4, 2,929.1, 2,968.1 |
| Tag | 1,685.6, 1,493.7, 2,595.9 | 1,643.9, 1,953.0, 1,381.7 |
| 1v1 | 2,635.8, 2,750.5, 2,854.4 | 2,191.7, 2,358.2, 2,096.0 |

The reduced-motion check used one run per version. Result-to-field times were:
FFA4 4,958 → 4,237 ms; FFA3 5,171 → 4,519 ms; Tag 1,963 → 1,587 ms;
1v1 2,463 → 3,208 ms. The last case had more worker and browser time under load.
It still cut the host resource lookup from about 277 to 82 ms. Do not treat
single browser samples as a latency guarantee.

## Full path, with step times

Each cell is **before / after**, in ms, from the same three full-motion runs.
These are medians of individual steps. Their sum need not equal the median total.

| Step | FFA4 | FFA3 | Tag | 1v1 |
| --- | ---: | ---: | ---: | ---: |
| Opening tail / Tag request setup | 890.3 / 887.2 | 889.5 / 897.2 | 206.0 / 176.0 | 970.5 / 975.4 |
| Start deck checks | 84.6 / 62.0 | 52.0 / 50.2 | 67.6 / 64.1 | 37.0 / 24.9 |
| Host resource lookup | 443.4 / 74.5 | 329.8 / 68.8 | 297.5 / 81.4 | 322.9 / 56.8 |
| Worker imports and transport | 77.0 / 71.2 | 51.3 / 50.6 | 52.2 / 94.4 | 50.0 / 47.8 |
| Worker resource byte check | 380.6 / 274.1 | 300.1 / 307.2 | 254.8 / 322.2 | 290.3 / 238.9 |
| Card DB load and script index | 195.0 / 196.0 | 262.5 / 205.2 | 185.9 / 229.6 | 225.6 / 188.6 |
| Multi overlay load | 15.9 / 13.6 | 14.8 / 14.4 | 16.9 / 15.8 | 0.2 / 0.1 |
| WASM file read | 1.6 / 1.5 | 1.5 / 1.6 | 1.5 / 1.4 | 0.9 / 1.1 |
| Core instance creation | 6.9 / 6.2 | 4.6 / 3.6 | 4.8 / 3.7 | 6.7 / 6.2 |
| Lua helper load | 27.8 / 26.9 | 25.0 / 18.6 | 22.9 / 23.7 | 22.3 / 19.1 |
| Deck load, all seats | 1.6 / 1.8 | 1.3 / 1.0 | 1.0 / 1.1 | 1.8 / 1.5 |
| Startup and first engine prompt | 13.8 / 10.8 | 6.1 / 6.2 | 5.3 / 5.3 | 9.1 / 7.1 |
| First host view | 0.9 / 1.0 | 4.8 / 3.5 | 3.7 / 1.6 | 4.7 / 3.2 |
| Activation journal / DB writes | 1.2 / 1.2 | 0.7 / 0.5 | 0.4 / 0.5 | 0.6 / 0.5 |
| Active WS invalidation POST | 2.8 / 3.0 | 3.3 / 2.1 | 2.7 / 2.1 | 2.3 / 2.5 |
| Bot loop scheduling | 0.3 / 0.3 | 0.2 / 0.1 | 0.2 / 0.1 | 0.1 / 0.1 |
| Active room GET, including queue wait | 16.7 / 13.0 | 18.2 / 14.9 | 724.1 / 43.8 | 12.5 / 20.1 |
| Room body to field DOM | 914.0 / 713.5 | 1471.3 / 1296.6 | 480.9 / 487.6 | 739.8 / 498.5 |
| Field DOM to paint opportunity | 40.0 / 38.0 | 110.0 / 102.6 | 29.4 / 32.0 | 90.0 / 71.1 |

`workerSpawnMs` in the existing log includes the worker resource byte check.
The table splits those costs with a temporary worker timer. The engine timer was
also split at overlay load, WASM read, core creation, Lua load, deck load, and
`startDuel`. The last engine step includes `processUntilWait`, which creates the
first prompt. All temporary timing logs were removed from source and the final
host build.

The server path is `beginGame` → `driveOpening` → `startGame` → `startGameNow`.
For FFA, `settleOpening` changes the phase to `start` and moves seats into final
order at the deadline. RPS uses the winner's choice. Tag starts directly. Deck
checks run before the resource lookup. `createStartingWorker` then creates the
thread, calls `game.create`, and reads the first view. `activateRecorded` writes
the seed, resource identity, setup, status, and clock. The host registers the
worker, sends `duel:changed`, and schedules the bot loop.

There were no paced bot answers before the first field response in these
measurements; the first active responses had revision 0. The 900 ms bot pace is
not a required startup pause. Journal writes and WS delivery were small. In the
FFA and 1v1 runs, the socket notice started the field GET within 1 ms at the
median. Tag's baseline room GET waited in the startup queue. With the new signal,
that GET can return a starting snapshot and the active notice triggers a new GET.

The client uses `useDuelWebsocket` to refetch on `duel:changed`. It does not wait
for the opening poll before it fetches an active field. `room.tsx` polls an
opening every **1,500 ms** as a fallback. The socket hook also has 1-second
recovery and 10-second live polls. `refreshRoom` requests fresh data through SWR
mutation; it does not reuse the normal 2-second SWR deduplication window.

The dice components have no extra timeout after the `start` phase. They use the
server clock. `DUEL_DICE_REVEAL_MS` is **3,000 ms per roll round**. Full motion
shows order at 2,000 ms, moves seats at 2,300 ms, and uses a 560 ms seat move.
Reduced motion shows order at 700 ms and moves seats at 1,300 ms, but the server
still keeps its 3-second round. This explains the longer reduced-motion result
screen. Ties add another roll round. The bot's RPS choice has a separate,
intentional **1,000 ms** result pause. These times are unchanged.

The browser also spent time mounting the field. FFA3 had about 1.3–1.5 seconds
from the active room body to field DOM in these software-rendered runs. The 3D
room import is already requested during the lobby. No new client delay or
animation was added or removed.

## Loading-screen contract

A loading screen is still useful. No loading UI was built.

The host now returns optional **`starting: true`** from
`GET /api/duels/<slug>` while it starts a normal lobby engine. It sets the state
before start checks, resource lookup, worker creation, and the first host view.
The read returns the actor's saved lobby snapshot without waiting for that
engine operation. It includes no seed or other player's deck. The response has
`Cache-Control: no-store`.

A future client can use these conditions:

- Keep the normal dice or RPS view while the opening has not reached `start`.
- Show “Starting duel” when `room.starting === true`. For FFA and RPS, use this
  after `room.opening?.phase === "start"`. Tag and RPS-disabled 1v1 have no
  opening, so the same signal covers their direct start.
- Display the field when `room.session.status === "active"` and
  `room.engine !== null`.
- If `starting` is absent and the room is still a lobby, return to normal lobby
  handling. This also clears a loading state after a failed start.

The existing **`duel:changed`** event is sent when startup begins and when the
first active view is ready. Failure also sends a change notice. The flag is
cleared before terminal notices. The socket payload still contains only the
slug. Clients refetch the authenticated room; no private engine data is pushed.
The flag is transient host state, not a new DB status or replay command.

Signature, guild and private-room checks still apply. Forced spectator reads
retain their normal validation. Replay-only `as` and `reveal` options still
return 400 on play tables. Replay forks use their original queue and owner
checks and do not use this shortcut or lobby warmup.

## Validation and reproduction

The implementation followed these reviewed steps:

- Add failing warmup and lobby-read tests; add resource preparation; run targeted
  tests and the duel-server typecheck; commit `099d63aae`.
- Add failing startup-signal and privacy tests; add the signal; run the shared
  and duel-server typechecks; commit `45b92dd8d`.
- Confirm a review finding with failing override tests; preserve the existing
  request validation; run startup tests and typecheck; commit `4116942be`.
- Repeat browser measurements, remove temporary logs, and verify replay and the
  final package types. No push or PR.

Final results:

- 185 targeted tests passed in the five host/cache test files.
- Five Standard real-core journal-prefix cases passed: 1v1 legacy, 1v1 pinned,
  Tag, FFA3, and FFA4. They compare all seat views at checkpoints and continue
  after handoff. Five Domain cases were outside this selected run.
- Four saved browser journals replayed without a mismatch: FFA4 9/9 commands,
  FFA3 0/0, Tag 0/0, and 1v1 3/3. The separate prefix tests cover continued play
  for every format.
- Eight browser runs passed: 32 duel measurement cases and 40 auth setup cases.
- Typechecks passed for shared, duel-server, and e2e.
- Shared and the final duel host build passed. The isolated production web,
  WS, and worker builds also completed for the measurements.

The main targeted suite covers
`engine-resource-cache`, `host-dice-opening`, `host-opening`, `host-replay-fork`,
and `host-engine-switch`. It checks warmup errors, resource edits during start,
one worker per game, dice order, signal cleanup, room access, and engine choice.

```sh
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
export DUEL_DATA_DIR=/home/sulman633/repos/yugioh-bot/data/duel-engine
npx vitest run packages/duel-server/tests/engine-resource-cache.test.ts \
  packages/duel-server/tests/host-dice-opening.test.ts \
  packages/duel-server/tests/host-opening.test.ts \
  packages/duel-server/tests/host-replay-fork.test.ts \
  packages/duel-server/tests/host-engine-switch.test.ts --testTimeout=30000
DUEL_REQUIRE_CORES=1 npx vitest run \
  packages/duel-server/tests/journal-runner-real.test.ts -t "'normal'"
npm run typecheck --workspace=packages/shared
npm run typecheck --workspace=packages/duel-server
npm run typecheck --workspace=packages/e2e
```

For the browser measurement, build shared/ws/duel-server/worker once, then run
`E2E_SLOT=7 npm run stack:build --workspace=packages/e2e`. Check that the slot is
free. The opt-in timing test runs one real table per format:

```sh
E2E_SLOT=7 E2E_WORKERS=1 E2E_MANUAL=1 \
E2E_START_LOAD_TIMING=1 E2E_OPENING_FULL_MOTION=1 E2E_RPS_OPENING=1 \
E2E_BOT_STEP_MS=900 E2E_LEAK_SCAN=0 \
E2E_DUEL_DATA_DIR="$DUEL_DATA_DIR" \
E2E_CARD_IMAGE_SOURCE_DIR=/home/sulman633/repos/yugioh-bot/data/card-images \
npx playwright test duel-start-load-timing -c packages/e2e/playwright.config.ts
```

Omit `E2E_OPENING_FULL_MOTION=1` for reduced motion. The test writes
`START_LOAD_TIMING` and attaches the browser timeline as JSON. It checks a real
visible field and a prompt socket refetch. It has no hard assertion for a total
startup time on shared hardware. The matrix disables the separate leak-scan
replay to avoid extra work between measurements. Targeted privacy tests and
separate real-core replay checks verify the relevant contracts.

Local raw logs and the machine-readable step summary are in
`/tmp/dice-load-baseline/`. The E2E result folders are under `.stack-7`. The
source logs contain no temporary timing code. The worktree and commits remain
for review.
