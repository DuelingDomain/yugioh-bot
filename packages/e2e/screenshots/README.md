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

Draw math for every seat: cards out of the Deck = 5 (opening hand, `startingHand` 5 in `packages/shared/src/duels/settings.ts:315`) + draws taken;
cards out = hand + field (Set cards and Field Spell included) + Graveyard + banished; Deck = start size - cards out. No board uses a draw or search effect.
Turn-1 duelist skips the first draw (`R-FFA-FIRST-DRAW`, ADR 0002 line 11). Every Level 5 or 6 monster has its tribute in the Graveyard of its player,
and each seat has at most one Normal Summon or Set per turn it had.

| Shot | Turn, phase, active seat | LP |
| --- | --- | --- |
| 4-player (`marketing-ffa4`) | Turn 9, Main Phase 1, seat 0 (Yugi M.) | 6,500 / 4,800 / 8,000 / 5,200 |
| 2v2 Tag (`marketing-tag`) | Turn 9, Main Phase 1, seat 0 (1A) | team 1 12,300, team 2 9,500 (of 16,000) |
| Domain (`marketing-domain`) | Turn 7, Main Phase 1, seat 0 | 6,000 / 4,400 |

Checks per seat ("drawn" counts draws up to and including the current turn; start Deck 40, Domain 60):

- 4-player. Yugi M. (turns 1, 5, 9): drawn 2, out 7 = hand 2 + field 4 + GY 1 + banished 0, Deck 40 - 7 = 33. Kaiba Fan (2, 6): drawn 2, out 7 = hand 2 + field 4 + GY 1, Deck 33. Mai V. (3, 7): drawn 2, out 7 = hand 2 + field 4 + GY 1, Deck 33. Rex R. (4, 8): drawn 2, out 7 = hand 3 + field 3 + GY 1, Deck 33.
- Tag. 1A Yugi (1, 5, 9): drawn 2, out 7 = hand 2 + field 4 + GY 1, Deck 33. 2A Kaiba Fan (2, 6): drawn 2, out 7 = hand 2 + field 3 + GY 2, Deck 33. 1B Mai V. (3, 7): drawn 2, out 7 = hand 4 + field 2 + GY 1, Deck 33. 2B Rex R. (4, 8): drawn 2, out 7 = hand 2 + field 4 + GY 1, Deck 33.
- Domain. Yugi M. (1, 3, 5, 7): drawn 3, out 8 = hand 3 + field 4 + GY 1, Deck 60 - 8 = 52. Kaiba Fan (2, 4, 6): drawn 3, out 8 = hand 3 + field 4 + GY 1, Deck 52. The Deck Masters are outside the 60 cards.

Summon history (one Normal Summon or Set per turn; the tribute is in the Graveyard):

- 4-player. Yugi M.: T1 Celtic Guardian, Set Mirror Force; T5 Set Hane-Hane, Sogen, Book of Moon. Kaiba Fan: T2 Feral Imp, Set Trap Hole; T6 Witch of the Black Forest, Set Call of the Haunted, Dian Keto. Mai V.: T3 Giant Soldier of Stone, Set Magic Cylinder; T7 Set Mystic Tomato and Solemn Judgment, Book of Moon. Rex R.: T4 Axe Raider, Set Mirror Force; T8 Tribute Summon Summoned Skull (tribute Axe Raider), Set Trap Hole.
- Tag. 1A: T1 Battle Ox, Set Dust Tornado; T5 Set Man-Eater Bug, Sogen, Book of Moon. 2A: T2 Feral Imp, Set Trap Hole; T6 Tribute Summon Curse of Dragon (tribute Feral Imp), Set Magic Cylinder; Mirror Force used. 1B: T3 Axe Raider, Set Mirror Force; T7 Tribute Summon Summoned Skull (tribute Axe Raider). 2B: T4 Giant Soldier of Stone, Set Mirror Force; T8 Set Mystic Tomato, Yami, Dian Keto.
- Domain. Yugi M.: T1 Apprentice Magician, Set Mirror Force; T3 Tribute Summon Dark Magician Girl (tribute Apprentice Magician); T5 Dark Elf, Yami. Kaiba Fan: T2 Kuriboh; T4 Tribute Summon Summoned Skull (tribute Kuriboh), Set Trap Hole; T6 Feral Imp, Set Dust Tornado.
- Stats on screen come from the card scripts: Sogen gives +200 to Warrior and Beast-Warrior monsters (Celtic Guardian 1,600; Battle Ox 1,900; the Spellcaster Witch of the Black Forest keeps 1,100), Yami gives +200 to Fiend and Spellcaster monsters.

Rules these boards follow: turn order and the first draw (`R-FFA-FIRST-DRAW`, `R-FFA-ORDER`, `R-TAG-ORDER` in `docs/adr/0002-multiplayer-duel-rules.md`); the first Battle Phase of a multi-seat duel is turn n (`R-FFA-NO-ATTACK`, so turn 9 is past it);
shared team LP (`R-TAG-LP`, `engine.ts`); facing seats and shared Extra Monster Zones (`R-TAG-FACING`, `R-FFA-ACROSS-EMZ`); one Field Spell per team (`R-TAG-FIELD`); Domain Deck Master and 60-card Main Deck (ADR 0002, "Deck Master core rules").
The Domain header says "Custom Domain" for a preset because its settings turn off the shuffle and the opening hand (`isCustomDomain`, `packages/shared/src/duels/settings.ts:355-367`, shown at `packages/web/src/components/duel/table/table-shell.tsx:556`).
The spec rewrites that one label to "Domain" on screen; nothing else changes.

Delete `.stack-<slot>` and `packages/web/.next-e2e-<slot>` when done.
