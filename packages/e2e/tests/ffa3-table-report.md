# Real-engine FFA table proof — 2026-10-02

Worktree: `n-player-ui`, branch `n-player-ui-implementation`. Standard engine mode (`normal`),
Chromium at 1440 × 900, reduced motion, one worker, zero retries. Only the isolated stack
at 3300 / 3302 / 4302 / 4303 was used.

The host loaded `ocgcore.multi.wasm`, SHA-256
`896d6528b16227e1702088c42da8570a6c394be9c0dd93ad4f2aac9951e5c22e`.
The new spec checks that runtime hash against the copied core and checks the host's bot
policies. Normal games use p1 and two real practice bots. Controlled engine presets use
two scripted bots. A supplemental queued-surrender test uses two humans and one practice
bot to hold a response window long enough to prove Leaving deterministically.

## Repeat runs

The first complete pass used `E2E_MULTI_RUN_ID=ffa3-table-proof-2`. The second complete
pass ran each spec separately with IDs `ffa3-table-proof-4`, `-5`, and `-6`.
Per-spec times below sum the individual test durations; combined times include startup
and runner overhead. Run 1 additionally includes the 1v1 guard.

| Spec | Run 1 | Seconds | Run 2 | Seconds |
| --- | --- | ---: | --- | ---: |
| `duel-3p-ffa-table.spec.ts` | 8 passed | 89.608 | 8 passed | 115.157 |
| `duel-4p-ffa.spec.ts` | 6 passed | 106.371 | 6 passed | 117.845 |
| `duel-presets-multi.spec.ts` | 8 passed, 4 Tag skipped | 142.583 | 8 passed, 4 Tag skipped | 163.888 |
| Login setup | 4 passed | 0.199 | 4 passed per separate spec run | See wall times |
| `duel-1v1-match.spec.ts` | 1 passed | 8.663 | Not repeated | — |

Run 1: **27 passed, 4 skipped, 0 failed, 0 flaky**, **349.733 seconds**.
The separate FFA3 repeat: **12 passed** including four login checks, **117.300 seconds**.
The separate FFA4 repeat: **10 passed** including four login checks, **120.225 seconds**.
The separate preset repeat: **12 passed, 4 Tag skipped** including four login checks,
**168.172 seconds**. All completed runs: **61 passed, 8 skipped, 0 failed, 0 flaky**;
this includes **44 requested feature-test passes**, **16 login checks**, and the **one
1v1 guard**. Every requested spec has two completed passes with retries disabled.

An intervening combined attempt (`ffa3-table-proof-3`) received SIGTERM at its launcher
before reporting the last visual test. Its result is excluded. There was no test failure
in that attempt's log; its orphaned isolated stack was stopped. Shorter foreground runs
were used to obtain complete reports for every spec. The source of SIGTERM is unknown.

## Browser and engine assertions

All names below refer to `duel-3p-ffa-table.spec.ts`.

| ID | Exact test name |
| --- | --- |
| T1 | mounts three own-EMZ fields and follows clockwise turns with no first-round Battle Phase |
| T2 | a practice-bot duel clears rivals, asks which duelist for a direct attack, damages only the pick, and reloads |
| T3 | a monster attack offers targets from both rivals and hits the selected rival |
| T4 | Mind Crush shows table opponent choices and affects only the chosen seat (FFA4 preset fallback) |
| T5 | the chain panel follows clockwise responders and the human response window resolves |
| T6 | LP elimination clears cards, survives reload, skips the out seat, and restores all three placings |
| T7 | a queued surrender shows Leaving before out and rebuilds the out chip on reload |
| T8 | a complete practice-bot versus practice-bot versus human simulation ends with a winner and engine placings |

| Requirement | Evidence |
| --- | --- |
| a | T1: three fields, three unique LP panels, 8000 each, two own EMZ slots per seat, and real engine seat data. |
| b | T1: browser MutationObserver records ring/who-pill at turns 1–4, seats 0→1→2→0; engine action prompts agree. |
| c | T1: no Battle option in any first-round engine action prompt or browser phase bar; enabled on turn 4. T2/T3/T6 execute later attacks. |
| d | T2: `holo-pick-1/2`, choosing alone does not submit, confirmation damages only seat 2. T3: legal monster targets on both rivals, only chosen monster destroyed and LP reduced. |
| e | T4: the allowed FFA4 Mind Crush preset fallback uses table opponent choices; only chosen seat loses Sangan, verified in each owner's engine view. |
| f | T5: actual chain seats 0→1→2, all priority chips visible and contained, current responder highlighted, human MST response resolves. FFA4 chain preset also passes its engine-order checklist. |
| g | T6: rival reaches 0 LP, cards clear, out chip/ring survive reload, turns skip it, complete standings and elimination order survive final reload. T7: stable Leaving→out during queued surrender, then out chip rebuilds. LP deaths commit immediately; Leaving is proved separately for queued surrender. |
| h | Every new test asserts zero console/page errors, including automatic popup pages and both human contexts in T7. Key screenshots are written to Playwright test-results before owner export and cleanup. |

T8 runs a whole match using the user's allowed human auto-pass helper. Both practice bots
play through the real engine. Winner and all three browser standings must match the
engine's elimination order. Run 1 finished on turn 21, revision 98, winner seat 1,
elimination order `[[2], [0]]`, reason `LP reached 0`. The completed separate repeat
finished with exactly the same turn, revision, winner, elimination order, and reason.

## Fixes and validation

- `2803b8d` — show response order even when every chain link has a board anchor.
- `7b84ecb` — expected FFA locked-deck validation after Start becomes a refresh signal without a resource-error console entry; 1v1/Tag responses remain unchanged.
- `babef51` — fit every table responder inside the chain panel.
- `de79139` — add the two necessary FFA3 battle/chain presets without overriding first-round battle rules.
- `e13b6a5` — wait for the actual answerable table prompt before attacking.
- `36803ed` — check non-targeting spells during resolution, rather than rejecting later bots' normal action prompts.
- `9d7b630` — require live tables in FFA4/preset specs; sample short engine windows independently of screenshots, with one sequential sampling producer and unique revisions.
- `18f15ef` — add the eight browser/real-engine rule tests and evidence helpers.

Web suite: **2604 passed / 246 files**, 80.40 seconds. Chain regression checks after the
layout fix: **25 passed**, 1.93 seconds. E2E helper unit tests: **29 passed**, 0.718 seconds.
Workspace typecheck: **6 successful tasks**, 3.388 seconds. Targeted server preset/coverage
checks: **41 passed, 9 skipped**, 2.49 seconds. Legacy Domain core checks were not validated.

## Reproduction and limits

Copy `data/duel-engine-next` from the engine owner's worktree with `cp -a` into this
worktree's `data/duel-engine-snap` only when missing. Never write to the source directory.
Build the shared package and run `npm run stack:build --workspace=packages/e2e`, then:

```sh
E2E_MANUAL=1 \
E2E_DUEL_DATA_DIR="$PWD/data/duel-engine-snap" \
E2E_CARD_IMAGE_SOURCE_DIR="$PWD/data/card-images" \
E2E_WORKERS=1 E2E_MULTI_MAX_SHOTS=8 E2E_BOT_STEP_MS=250 \
E2E_MULTI_RUN_ID=ffa3-table-proof-repeat \
npm run e2e:nobuild --workspace=packages/e2e -- \
  duel-3p-ffa-table.spec.ts duel-4p-ffa.spec.ts duel-presets-multi.spec.ts --retries=0
```

`E2E_MANUAL=1` enables the existing adapter that verifies the installed wrapper patch and
derives a matching manifest in the isolated stack directory. The copied core bytes remain
unchanged. It also supplies real cached card art and seeded decks. The 3300 ports remain
the ordinary E2E ports. Uncached art can require internet access.

Tag, shared FFA4 EMZ, Domain gameplay, other browsers/viewports, and full animation behavior
remain outside this proof. The four Tag tests are explicitly skipped by default; named
Tag presets remain available through `E2E_PRESET`. The initial diagnostic Tag failures
were not fixed. Ordered loose decks and deterministic scripted presets isolate rules;
these checks do not prove tournament deck legality.

Eight 1440 × 900 screenshots from the completed FFA3 repeat were copied, with byte-hash
verification, to `/home/sulman633/repos/yugioh-bot/.fx-demo/three-way/shots/`:

- `live-ffa3-u9-20261002-first-round-complete.png`
- `live-ffa3-u9-20261002-direct-seat-choice.png`
- `live-ffa3-u9-20261002-direct-damage.png`
- `live-ffa3-u9-20261002-monster-targets.png`
- `live-ffa3-u9-20261002-chain-clockwise.png`
- `live-ffa3-u9-20261002-leaving.png`
- `live-ffa3-u9-20261002-reload-after-elimination.png`
- `live-ffa3-u9-20261002-final-placings.png`

All stacks started for this proof are stopped. Ports 3300 / 3302 / 4302 / 4303 and the
manual 3400 family were verified free. Removed `packages/e2e/.stack`, `packages/web/.next`,
Playwright test-results/reports/traces, generated authentication state and scratch logs,
and `data/duel-engine-snap`. Restored the build-generated `next-env.d.ts` change. The
eight owner screenshots and this report remain; reproduction requires recopying the core
and rebuilding. No live services/data, engine-owner files, push, PR, or merge were touched.
