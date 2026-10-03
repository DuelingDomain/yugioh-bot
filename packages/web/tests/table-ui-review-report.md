# Multiplayer table UI review fixes

Scope: Opus findings 4 (UI), 8 (UI), 10 and 14 a–h. Changes are confined to `packages/web`; engine rules, core/Lua and E2E specifications were not edited by this worker. No push, PR or main merge was performed.

## Commits

| SHA | Subject |
| --- | --- |
| 55bd213 | fix(web): expose current table life points separately |
| 0900d15 | test(web): add realistic table review scenes |
| 0b587e2 | fix(web): identify duplicate names in table standings |
| 4364004 | fix(web): stop deck checks when rooms leave the lobby |
| 8348ac1 | fix(web): keep table chains below rival life points |
| 54a34d9 | fix(web): retain seat names in compact responder chips |
| 36e8603 | fix(web): show one damage chip inside each table panel |
| 154ab93 | fix(web): fit the active clock beside the table turn label |
| b9fba63 | fix(web): use display names for direct attack choices |
| ff27043 | fix(web): keep direct attack choices clear of the monster row |
| abbeeda | fix(web): keep eliminated tables stable after reload |
| 8555e4f | fix(web): derive attack locks from current format rules |
| f3f7ff6 | fix(web): scope direct attack names to multiplayer tables |
| fc3c3c4 | fix(web): keep four seat chains above the far life points |
| 9c9afac | fix(web): keep four seat responses between life point panels |
| ba54dbe | fix(web): keep three rival choices below the side life points |

Each commit ends with the required Claude attribution and session trailers. The final verification commit also contains this report, the browser runner, expanded review fixtures and removal of an unused legacy test error string.

## Browser evidence

`node packages/web/scripts/table-review-checks.mjs` passed **30/30 checks**, with screenshots at **1440×900** and **1280×720**. The preview used the real table components on an isolated web server at `127.0.0.1:3400`, with `DUEL_FX_LAB=1`, Standard settings and duplicate Practice Bot names. The runner captures screenshots before geometry assertions and checks browser errors. No engine server is required.

| Check name | Evidence checked at both sizes |
| --- | --- |
| `lp` | Exact current `8,000` values, no damage chips before damage |
| `result` | Seat attributes, placing order and distinct duplicate-name labels |
| `chain`, `chain-expanded` | Chain and response panels clear visible rival LP numerals |
| `responders` | Full seat-aware names, no truncated responder chips |
| `clock` | One active dock clock, clear of the dock name and Turn label; all LP clocks retained |
| `damage` | Live LP update to `6,000`, exactly one chip inside the damaged LP panel, no inner tally or other-seat chip |
| `direct-names` | Display names in direct-attack choices, no generic Player labels |
| `direct-lane` | Prompt clears occupied own monsters and rival LP; opponent bar clears rival LP |
| `elimination` | After reload: home camera, centred full-size turn ring, no Auto-camera cue, out toast clears all field titles |
| `attacklock` | Current-engine FFA3 fallback says turn 4 |
| `ffa4-chain`, `ffa4-chain-expanded` | Four-seat chain and expanded response clear all rival LP, wrapped duplicate names and reachable response options |
| `ffa4-direct-lane` | All three rival choices reachable through scrolling; prompt clears LP and occupied own monsters |
| `1v1` | Existing duel field renders and no multiplayer table stage appears |

`REDUCED=0 CHECKS=damage OUT_DIR=packages/web/coverage/ui-review/full-motion node packages/web/scripts/table-review-checks.mjs` also passed **2/2 checks**, exercising the live LP update with full motion. Default browser checks use reduced motion for stable geometry. Both runs produced zero browser errors.

Screenshots and logs are retained under ignored `packages/web/coverage/ui-review/`: `final/`, `full-motion/`, `final-browser.log`, `final-web-tests.log` and `focused-tests.log`. Each screenshot filename includes its check and viewport; expanded responses and tall direct choices include additional `-scrolled-` screenshots. Screenshots were inspected visually alongside the assertions.

## Unit evidence

Web typecheck passed. The final full suite passed **2,623/2,623 tests across 247 files**. The focused verification passed **136/136 tests across 16 files**, including:

- `exposes only the current LP number separately from its damage history`
- `shows one damage history after a live LP update, without a second LifePoints tally`
- `identifies duplicate bot names by seat in the engine placing order`
- `skips the %s host check after the room leaves lobby` and `discards a %s check when the room starts during validation` for every format
- `aborts an in-flight %s check when the lobby becomes active` for every format; abort on unmount and preservation of genuine lobby errors
- `keeps the seat number visible for duplicate compact responder names`
- `names direct attack seats consistently with the table and preserves the selected engine option`
- `preserves duel labels when a 1v1 name lookup is supplied`
- `opens a reloaded elimination view at home with the full centred turn ring`
- `current engine: derives the attack gate from the format rule table`
- `removes the attack lock when the engine offers Battle Phase before the fallback turn`

The full-suite output is retained in `final-web-tests.log`.

An independent read-only reviewer confirmed the fixes after the expanded FFA4 response overlap was reproduced and corrected. No actionable review findings remain.

## Limits and risks

The engine view exposes no first-attack-turn metadata. A single helper uses the current format table (FFA3 turn 4, FFA4 turn 5) and yields to an actual Battle Phase offer. Its `TODO(R-FFA-NO-ATTACK)` records the pending ADR behavior (FFA3 turn 3, FFA4 turn 4). Engine behavior remains unchanged.

This worker verified fixture visuals and web behavior; real-engine E2E proof belongs to the separate spec worker. The 1v1 browser guard and shared-component tests cover the paths affected by these changes. The full Vitest run emits existing jsdom canvas warnings.

The isolated 3400 preview was stopped and its port checked free. Cleanup is recorded in the task's final report; another worker's active isolated stack and working changes are left untouched.
