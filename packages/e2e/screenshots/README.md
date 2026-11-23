# Site screenshots

Specs that take real screenshots of the game for the marketing site (`site/public/assets/shot-*.webp`).
They run on the isolated e2e stack with the offline test sign-in and seeded test players.
The shots show clean names ("Yugi M.", "Kaiba Fan", "Mai V.", "Rex R."), real card art and mid-game boards.
Nothing here reaches production, and the config refuses `NODE_ENV=production`.

```bash
export PATH="$HOME/.nvm/versions/node/v22.*/bin:$PATH"   # Node 22
E2E_DUEL_DATA_DIR=/path/to/prepared/engine/data scripts/site-screenshots.sh
```

One run takes all 5 shots and writes the 1600x900 WebP files (80 KB or less each) to `site/public/assets`.
Pass a spec name (`boards.spec.ts`) to run only that spec; then no WebP files are written.
Use a spare slot (`E2E_SLOT`, default 7). Do not use the folders that the :3000 services use.
The PNG files land in `packages/e2e/.stack-<slot>/screenshots/` (or `SHOT_DIR`).

- `boards.spec.ts`: 4-player table, 2v2 Tag table and Domain Format board (with the Deck Master in its zone). Each starts a dev-only
  scenario preset (`marketing-ffa4`, `marketing-tag`, `marketing-domain`, defined in
  `packages/duel-server/src/presets/marketing-boards.ts`). The human is seat 0 and the bots are scripted, so the board is the same every run.
  Presets exist only with `DUEL_SCENARIOS=1`, which the e2e stack sets. The spec renames the practice bots on screen and hides the table code and the bug buttons.
- `draft-and-deck.spec.ts`: a draft pick screen (pick 4 of 8, five cards in the pack) and a Genesys deck with points.
- `catalog.ts` and `cards.json`: 38 well-known cards with their public Genesys point values (names, stats and points only).
- Real card art: the script sets `E2E_REAL_CARD_ART=1`. The stack then fetches art from images.ygoprodeck.com through the normal image route
  into its own `.stack-<slot>/card-images` folder. Without the flag the stack serves a stub image (grey cards). The art is in the screenshots only, never as site assets of its own.
- The engine data folder is a scratch copy: copy a prepared data dir and run `DUEL_DATA_DIR=<copy> npm run duel:prepare` on it. Never point it at the live data folder.

Look at every WebP before you commit it (real names only, no emails, ids or debug labels). Then add or change the file through its `shot` entry in `site/src/pages.py`.
Delete `.stack-<slot>` and `packages/web/.next-e2e-<slot>` when done.
