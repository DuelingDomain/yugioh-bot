# Enemy Controller position investigation

Investigated on `fix/enemy-controller-position`, starting at `3cafe223`, using only E2E slot 3 with one Playwright worker. No live services were accessed and nothing was pushed.

## Finding

The reported failure did not reproduce in the controlled Standard 1v1 cases. Both the production legacy engine and the pinned engine change the target from face-up Attack (`1`) to face-up Defense (`4`) in Main Phase and Battle Phase. No production fix was made: the new behavioral assertions pass against the starting implementation. No failing product assertion was found to justify a patch.

The test target is Giant Soldier of Stone (1300 ATK / 2000 DEF). The activating player controls Axe Raider (1700 ATK) and activates Enemy Controller from hand, selects a Spell/Trap zone, and chooses the position-change effect. With one eligible target, the host answers the forced target automatically. A following attack leaves both monsters alive, preserves the defender's 8000 LP, and reduces the attacker's LP to 7700. An attack against ATK would instead destroy Stone and damage its controller.

The real-core tests capture the parsed messages returned by `duelGetMessage`, without replacing the core's behavior. They assert `POS_CHANGE` with `prev_position: 1`, `position: 4` and the correct target controller; both players' queried monster positions and public position events; and `BATTLE` with target position `4` and defense `2000`. They cover both activation directions. The real three-player core also passes, including a target controlled by seat 2 and observations from all three seats.

The browser spec checks both players' actual boards, `data-defense`, the room's position field, public position events, and the card art's computed transform after its animations stop. It exercises reduced and full motion for the effect. Setup summons use ordinary authenticated game actions because legacy has no startup scripts; Enemy Controller activation, effect choice, and the following attack use the browser UI. Setup and combat use reduced motion to avoid headless WebGL load on the shared machine.

## Paths checked

- Legacy messages and view queries: `packages/duel-server/src/legacy/views.ts` (`POS_CHANGE` and `projectView`).
- Pinned and three-player messages and view queries: `packages/duel-server/src/views.ts`.
- Rendering: `CardFace` reads `position`; the field stylesheet rotates Defense art by 90 degrees. `PositionFx` animates the turn and leaves the stylesheet's final state in place.
- Three-player rendering uses the same `SeatField`, `CardFace`, and `PositionFx` through `table/table-shell.tsx`.

Core SHA-256 identities:

| Engine | SHA-256 |
| --- | --- |
| Legacy Standard (npm built-in) | `7415337a6f88653b38e10faa3a087c0a5ab64dd27a7d7cf8a1e6872747c5c265` |
| Pinned Standard | `00b4b9e79da85ccf06042877247af25e82ff1493525f8af8f47ca8b5b2614ab1` |
| Three-player | `896d6528b16227e1702088c42da8570a6c394be9c0dd93ad4f2aac9951e5c22e` |

## Validation

| Check | Result |
| --- | --- |
| Real-core scenarios | 14 passed: legacy, pinned, and three-player; Main and Battle; both 1v1 activation directions and a seat-2 target |
| Message/view projection | 21 passed: legacy and merged paths; every player and spectators |
| Existing prompt tests | 40 passed; combined server run: 75 passed |
| Existing web field and event-queue tests | 38 passed |
| Legacy Playwright | All 4 effect/combat cases passed, plus 4 authentication setup tests |
| Pinned Playwright | All 4 effect/combat cases passed, plus 4 authentication setup tests |
| Builds and types | Shared, duel-server, ws, and slot-3 web builds passed; duel-server and E2E typechecks passed |

Each browser matrix covers Main and Battle Phase with reduced and full motion, observes both players, and verifies the following attack. The extra web check initially collected duplicate tests from the standalone build; excluding `.next-e2e-3/**` produced the passing source-only result above. Independent code review found no blocking issues.

## Reproduction and evidence

Server checks, from `packages/duel-server` with `DUEL_DATA_DIR` pointing at the read-only snapshot:

```sh
DUEL_REQUIRE_CORES=1 ../../node_modules/.bin/vitest run \
  tests/enemy-controller.test.ts tests/enemy-controller-view.test.ts \
  tests/prompt-text.test.ts tests/legacy-main/prompt-text.test.ts \
  --maxWorkers=1 --no-cache --configLoader=runner
```

Browser checks, from `packages/e2e`, once per engine:

```sh
E2E_SLOT=3 E2E_WORKERS=1 E2E_MANUAL=1 E2E_1V1_ENGINE=legacy \
  ../../node_modules/.bin/playwright test card-enemy-controller.spec.ts
E2E_SLOT=3 E2E_WORKERS=1 E2E_MANUAL=1 E2E_1V1_ENGINE=pinned \
  ../../node_modules/.bin/playwright test card-enemy-controller.spec.ts
```

The harness maps `E2E_1V1_ENGINE` to the server's `DUEL_1V1_ENGINE`. The spec also verifies the selected core identity through the debug trace.

Set `E2E_DUEL_DATA_DIR` to a prepared snapshot and build shared, duel-server, ws, and the slot-3 web first, as `packages/e2e/stack/MANUAL.md` describes. The supplied snapshot lacks legacy Domain artifacts required at legacy host startup. For this investigation, the pinned Emscripten image built those artifacts into a worktree-local overlay; the legacy pin check passed. The original snapshot and borrowed dependencies were not patched. Preserve real directories when overlaying nested Lua script directories, since the script index does not recurse into directory symlinks.

Set `E2E_ENEMY_CONTROLLER_PROOF_DIR` to preserve screenshots. Evidence lives in `/home/sulman633/orca/workspaces/yugioh-bot/integrate-results/enemy-controller-{legacy,pinned}-{main,battle}-{reduced,full}-{activator,opponent}-{before,after}.png`. Before/after refers to the activation, not a code patch.

## Limit

The owner's exact live duel, target monster, chain, and deployed revision were unavailable. These results establish the controlled behavior at the requested base; they do not identify the cause of the original observation or prove that its animation was unclear. The three-player path was checked with real cores, projection tests, and shared-renderer inspection; no three-player browser session was run.
