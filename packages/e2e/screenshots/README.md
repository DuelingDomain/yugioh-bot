# Site screenshots

Specs that take real screenshots of the game for the marketing site (`site/public/assets/shot-*.webp`).
They run on the isolated e2e stack with the offline test sign-in and seeded test players
(`E2E Alice`, `Practice Bot`). Nothing here reaches production, and the config refuses `NODE_ENV=production`.

```bash
export PATH="$HOME/.nvm/versions/node/v22.*/bin:$PATH"   # Node 22
E2E_DUEL_DATA_DIR=/path/to/prepared/engine/data scripts/site-screenshots.sh
```

Use a spare slot (`E2E_SLOT`, default 7). Do not use the folders that the :3000 services use.
The PNG files land in `packages/e2e/.stack-<slot>/screenshots/` (or `SHOT_DIR`).

- `boards.spec.ts`: 4-player table, 2v2 Tag table, Domain Format board and the Deck Master pop-over.
- `draft-and-deck.spec.ts`: a draft pick screen and a Genesys deck with points.
- `catalog.ts` and `cards.json`: 38 well-known cards with their public Genesys point values (names, stats and points only). The stack serves a stub image, so cards show as grey.

Convert a PNG to the small WebP the site uses:

```bash
ffmpeg -i ffa4.png -vf scale=1600:900 -c:v libwebp -quality 78 site/public/assets/shot-4-player-table.webp
```

Then add the file to a page through its `shot` entry in `site/src/pages.py`. Delete `.stack-<slot>` and `packages/web/.next-e2e-<slot>` when done.
