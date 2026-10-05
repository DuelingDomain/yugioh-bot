# Design references

Only designs that code or tests still use stay here. Shipped designs are removed; the code is the source.

## Draft room: Cube night (`draft-room/`)

Approved by the owner on 2026-10-02. The app builds it as the draft room (`packages/web/src/components/draft/room/`). Keep the draft room to this design.

- `workshop.html`: every feature explained, with screenshots.
- `cube-night.html`: the interactive mock. Use the grey "Mock controls" tab to change state.

## Multiplayer table space (`table-space-v2/`)

Live reference for the 3-way Plaza, the Tag Rooftop, and the open 4-way grid work. Review it again when the 4-way grid ships.

## 3D mode baseline (`duel-3d-mode/concept/solid-vision/` and `duel-3d-mode/concept/assets/`)

The Solid Vision concept page, used as the e2e baseline by `packages/web/e2e/duel-3d-mode.playwright.ts` (it loads `index.html` and `shots/*.png`). The page loads `../assets/`, so keep both folders. Local card art, no network needed.

## Contracts

- `coin-toss/backend.md`: the coin toss timing contract (`MIN_DUEL_FX_SPEED`, `COIN_CHAIN_BEAT_MAX_MS`, `MAX_COIN_TOSS_GRACE_MS`).
- `fx/destroy-sequence.md`: the destroy sequence rule that the move plan follows.
