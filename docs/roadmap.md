# Roadmap

## Multi-player duels (3-way, 4-way, 2v2) - planned, start next

Status: research only. No code written.

### Findings so far
- Engine: EDOPro `ygopro-core` via `ocgcore-wasm` (see `packages/duel-server/domain-core/pins.json`), patched for Domain.
- The core has a tag mode (`TAG_SWAP` message exists in `ocgcore-wasm`). It has no free-for-all mode.
- Two tag models exist:
  1. ygopro/EDOPro tag: each team has ONE field and one life point total. Partners swap in and out. Cards still see one opponent, so Raigeki and Dark Hole work as they do in 1v1. This is the cheap path.
  2. Official TCG tag: each duelist has a separate field. Effects that affect "the opponent's field" affect both opponents. Effects on hand or Deck need a choice of player. The core does not do this. It needs core changes and card checks.
- Free-for-all (3 or 4 players) needs core changes. Many card scripts assume one opponent.
- The app assumes two seats in many places (MAX_SEATS, seat type 0|1, clocks, winner logic, views, lobby, field layout).

### Plan
1. Engine test (1 to 2 weeks): tag mode with Domain; a 3-player try in the core; about 50 common cards checked for wrong targets.
2. Decide the model (ygopro tag, official tag, or free-for-all) from the test result.
3. Data model: seat count setting and N-seat clocks, winner and views.
4. Server and bot handling for N seats.
5. UI: player-count control, N-seat lobby, multi-opponent field layout, history, prompts, result screen.
6. Automatic card test suite for multi-player duels.

### Also queued (from the UI review)
P1 fixes: remove the dead "Game engine" select, shared format-name helper, text under 11px, clock name cut-off, lobby wording and "Table full" message, confirm on "Cancel table", small-screen card details, clock remount and blur cost.
