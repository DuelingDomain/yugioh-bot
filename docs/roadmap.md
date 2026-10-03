# Roadmap

## Multi-player duels (3-way, 4-way, 2v2) - in progress

Status: rules decided (ADR-0002), test layers decided (ADR-0003). Engine design and test harness in progress on `feat/domain-multiplayer`.

### Decisions (2026-09-30)
- Every duelist has their own full field in every format, in Standard and in Domain.
- 2v2 uses the official TCG Tag Duel rules: the team shares 16,000 LP.
- 3-player and 4-player free-for-all: each duelist has their own 8,000 LP.
- Effects on "your opponent" or the opponent's field hit all opponents. For hand, Deck, draw and LP effects, the activator picks one opponent.
- A 2v2 partner is never "your opponent". "All" and both-side effects (Dark Hole) hit every duelist, the partner included.
- Free-for-all chains: after each Chain Link the turn player responds first, then clockwise. 2v2 keeps the official Tag rule.
- Each duelist has their own two Extra Monster Zones. The Chain Links of an eliminated duelist resolve with no effect.
- Card tests run on the engine (Vitest scenarios and fast-check self-play). Playwright covers 10 to 25 multi-browser flows.

### Findings so far
- Engine: EDOPro `ygopro-core` via `ocgcore-wasm` (see `packages/duel-server/domain-core/pins.json`), patched for Domain.
- The core has a tag mode (`TAG_SWAP` message exists in `ocgcore-wasm`). It has no free-for-all mode.
- Two tag models exist:
  1. ygopro/EDOPro tag: each team has ONE field and one life point total. Partners swap in and out. Cards still see one opponent, so Raigeki and Dark Hole work as they do in 1v1. This is the cheap path.
  2. Official TCG tag: each duelist has a separate field. Effects that affect "the opponent's field" affect both opponents. Effects on hand or Deck need a choice of player. The core does not do this. It needs core changes and card checks.
- Free-for-all (3 or 4 players) needs core changes. Many card scripts assume one opponent.
- The app assumes two seats in many places (MAX_SEATS, seat type 0|1, clocks, winner logic, views, lobby, field layout).

- Research (2026-09-30):
  - 9,448 of 22,750 card scripts use `1-tp`.
  - The core has about 196 `1 - player` lines and uses player ids 2 and 3 as "none" and "all".
  - No open-source project has built separate-field tag or free-for-all.

### Plan
1. Engine: an N-duelist core with teams, a two-sided view for card scripts, and an opponent pick at activation. Design: `docs/specs/2026-09-30-multiplayer-core-design.md`. The first slice (native build, stock-vs-new differential test, `player[2]` to `player[4]` with no change in behavior) is 1 to 2 weeks. The full core is about 17 to 23 engineer-weeks in 6 phases.
2. ~~Decide the model~~: decided. Separate fields for all formats (ADR-0002).
3. Data model: seat count setting and N-seat clocks, winner and views.
4. Server and bot handling for N seats.
5. UI: player-count control, N-seat lobby, multi-opponent field layout, history, prompts, result screen.
6. Automatic card test suite for multi-player duels.

### Also queued (from the UI review)
P1 fixes: remove the dead "Game engine" select, shared format-name helper, text under 11px, clock name cut-off, lobby wording and "Table full" message, confirm on "Cancel table", small-screen card details, clock remount and blur cost.
