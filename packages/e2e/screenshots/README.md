# Site screenshots

Specs that take real screenshots of the game for the marketing site (`site/public/assets/shot-*.webp`).
They run on the isolated e2e stack with the offline test sign-in and seeded test players.
The shots show clean names ("Yugi M.", "Kaiba Fan", "Mai V.", "Rex R."), real card art and mid-game boards.
Nothing here reaches production, and the config refuses `NODE_ENV=production`.

```bash
export PATH="$HOME/.nvm/versions/node/v22.*/bin:$PATH"   # Node 22
E2E_DUEL_DATA_DIR=/path/to/prepared/engine/data scripts/site-screenshots.sh
```

One run takes all 5 shots at device scale factor 2 (3840x2160 PNG) and writes the WebP files to `site/public/assets`: `shot-*.webp` (1920x1080 with Lanczos scaling, WebP quality 90 or lower, 250 KB or less) and `shot-*-960.webp` (960 wide, 100 KB or less) for phones. The pages use `srcset`.
The script also sets `GENESYS_LIST_REVISION` and `GENESYS_LIST_EFFECTIVE_DATE` for the stack worker (from `check-genesys-points.ts`); without them the worker refuses the live Genesys list.
Pass a spec name (`boards.spec.ts`) to run only that spec; then no WebP files are written.
Use a spare slot (`E2E_SLOT`, default 7). Do not use the folders that the :3000 services use.
The PNG files land in `packages/e2e/.stack-<slot>/screenshots/` (or `SHOT_DIR`).

- `boards.spec.ts`: 4-player table, 2v2 Tag table and Domain Format board (with the Deck Master in its zone). Each starts a dev-only
  scenario preset (`marketing-ffa4`, `marketing-tag`, `marketing-domain`, defined in
  `packages/duel-server/src/presets/marketing-boards.ts`). The human is seat 0 and the bots are scripted, so the board is the same every run.
  Presets exist only with `DUEL_SCENARIOS=1`, which the e2e stack sets. The spec renames the practice bots on screen and hides the table code and the bug buttons.
- `draft-and-deck.spec.ts`: a draft pick screen (pick 4 of 8, five cards in the pack) and a Genesys deck with points. The Genesys shot is a crop of the points meter and the deck (clip 1120x900). The full page is not used: its left panel says "Deck size is correct for Standard" in every Genesys deck (`packages/web/src/components/decks/editor.tsx:1403-1405`), and its search results show "? pts" when the worker has not published the live points list.
- `catalog.ts` and `cards.json`: 38 well-known cards with their public Genesys point values (names, stats and points only).
- Real card art: the script sets `E2E_REAL_CARD_ART=1`. The stack then fetches art from images.ygoprodeck.com through the normal image route
  into its own `.stack-<slot>/card-images` folder. Without the flag the stack serves a stub image (grey cards). The art is in the screenshots only, never as site assets of its own.
- The engine data folder is a scratch copy: copy a prepared data dir and run `DUEL_DATA_DIR=<copy> npm run duel:prepare` on it. Never point it at the live data folder.

Look at every WebP before you commit it (real names only, no emails, ids or debug labels). Then add or change the file through its `shot` entry in `site/src/pages.py`.
## Board ledgers

The boards are set up with the board DSL (`packages/duel-server/src/presets/board.ts`) and then played forward with real turns
(`playToTurn` in `boards.spec.ts` passes the other seats' turns through `POST /api/duels/<slug>/actions`), so the turn counter, the draws and the phase are real engine state.
The Deck counts follow Deck = Main size - hand - field - Graveyard - banished (the Deck Master is outside the Main Deck).

| Shot | Turn, phase, active seat | LP | Hands / Decks / GY / banished |
| --- | --- | --- | --- |
| 4-player (`marketing-ffa4`) | Turn 9, Main Phase 1, seat 0 (Yugi M.) | 6,500 / 4,800 / 8,000 / 5,200 | 2 / 30 / 3 / 0, 5 / 30 / 1 / 0, 3 / 33 / 0 / 0, 3 / 33 / 1 / 0 |
| 2v2 Tag (`marketing-tag`) | Turn 9, Main Phase 1, seat 0 (1A) | team 1 12,300, team 2 9,500 (of 16,000) | 1A 3 / 31 / 2 / 0, 2A 2 / 33 / 2 / 0, 1B 4 / 33 / 1 / 0, 2B 4 / 31 / 1 / 0 |
| Domain (`marketing-domain`) | Turn 7, Main Phase 1, seat 0 | 6,000 / 4,400 | 4 / 49 / 2 / 0, 4 / 51 / 1 / 0 |

Rules these boards follow: turn order and the first draw (`R-FFA-FIRST-DRAW`, `R-FFA-ORDER`, `R-TAG-ORDER` in `docs/adr/0002-multiplayer-duel-rules.md`); the first Battle Phase of a multi-seat duel is turn n (`R-FFA-NO-ATTACK`, so turn 9 is past it);
shared team LP (`R-TAG-LP`, `engine.ts`); facing seats and shared Extra Monster Zones (`R-TAG-FACING`, `R-FFA-ACROSS-EMZ`); one Field Spell per team (`R-TAG-FIELD`); Domain Deck Master and 60-card Main Deck (ADR 0002, "Deck Master core rules").
The Domain header says "Custom Domain" for a preset because its settings turn off the shuffle and the opening hand (`isCustomDomain`, `packages/shared/src/duels/settings.ts:355-367`, shown at `packages/web/src/components/duel/table/table-shell.tsx:556`).
The spec rewrites that one label to "Domain" on screen; nothing else changes.

Delete `.stack-<slot>` and `packages/web/.next-e2e-<slot>` when done.
