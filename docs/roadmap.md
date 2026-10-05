# Roadmap

## Multi-player duels (Tag 2v2, 3-way, 4-way) - done

Built and deployed (PR #101 and #124, 2026-10-04). Rules: [ADR-0002](adr/0002-multiplayer-duel-rules.md). Test layers: [ADR-0003](adr/0003-duel-test-layers.md). Tables are open when `MULTIPLAYER_TABLES` is on, which is the Compose default. The 4-player table still uses the Plaza layout on main.

## Also queued (from the UI review)

P1 items checked against the code on 2026-10-05.

Open:
- Remove the dead "Game engine" select (`packages/web/src/components/duel/creator.tsx`).
- One shared format-name helper. `FORMAT_LABELS` in `components/duel/table-format.ts` is not used by `components/duel/multi-seat.ts` or `lib/bug-report.ts`, and the names differ ("2v2 Tag" and "Tag 2v2").
- Text under 11px (for example `between-games.module.css`, `station-track.module.css`, `solid/table.module.css`).

Not re-checked (needs a visual check): clock name cut-off, lobby wording, small-screen card details, clock remount and blur cost.

Done: confirm on "Cancel table" (`lobby.tsx`), the "Table full" message (`room-lobby.tsx`).
