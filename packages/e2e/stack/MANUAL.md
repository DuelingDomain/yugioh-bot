# Manual FFA stack

Run these commands only in `/home/sulman633/orca/workspaces/yugioh-bot/n-player-ui`.
This starts a local web, websocket server, and real duel host, with no Playwright test run.

## Start

Keep the engine worktree read only. Reuse an existing snapshot; copy only when missing:

```bash
cd /home/sulman633/orca/workspaces/yugioh-bot/n-player-ui
if [ ! -e data/duel-engine-snap ]; then
  mkdir -p data
  cp -a /home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/duel-engine-next data/duel-engine-snap
fi
git check-ignore data/duel-engine-snap
npm run build --workspace=packages/shared
npm run stack:manual --workspace=packages/e2e
```

Leave that terminal running. The manual entry point builds stale services and the production web,
then supervises them until Ctrl+C. Wait for the web to report `Ready`; check readiness from another terminal:

```bash
curl --fail http://localhost:3400/api/auth/csrf
```

Defaults:

| Setting | Value |
| --- | --- |
| Web | `http://localhost:3400` |
| Websocket | `http://localhost:3402` |
| Internal websocket / duel host | `4402` / `4403` |
| `E2E_DUEL_DATA_DIR` | `<worktree>/data/duel-engine-snap` |
| `MULTIPLAYER_TABLES`, `DUEL_SCENARIOS`, `DUEL_FX_LAB` | `1` |
| `DUEL_1V1_ENGINE` | `pinned` |
| `DUEL_BOT_STEP_MS` | `900` (override with `E2E_BOT_STEP_MS`) |

Override ports with `E2E_WEB_PORT`, `E2E_WS_PORT`, `E2E_WS_INTERNAL_PORT`, and `E2E_DUEL_PORT` **on the manual command**.
It builds with the matching websocket URL. `E2E_SKIP_BUILD=1` is only for an already matching build.
Ports `3000`, `3001`, `3002`, `3100`, `3110`, `4001`, `4002`, `4003`, and `4010` are refused,
as are occupied ports. Do not change `data/services/duel.env`, live engine data, or `yugidraft-*` services.

The source manifest may pin the engine branch's wrapper while the merged UI has a different checked-in wrapper patch.
In that case manual mode verifies the installed wrapper against that patch and creates `.stack/manual-duel-data`:
symlinks to the unchanged snapshot files and a derived manifest with the local wrapper hash and bundle version.
No source manifest, core, or Lua script is changed. Normal e2e mode keeps its original integrity checks.

Real art is read from `/home/sulman633/repos/yugioh-bot/data/card-images`, with YGOPRODeck as fallback.
Set `CARD_IMAGE_CACHE_DIR=/another/cache` on the manual command to choose a different **read-only source**.
Downloaded art is written only into `packages/e2e/.stack/manual-card-images`.
Normal e2e runs keep tiny stub images in their separate `.stack/card-images` cache.

The manual and ordinary e2e supervisors share `.stack/e2e.sqlite`; run them one at a time.
Each startup resets this isolated database. It seeds p1–p4, each with:

- `Manual Standard · EARTH normals`: 40 unique low-level EARTH Normal Monsters.
- `Manual Domain · Axe Raider`: 60 unique EARTH Normal Monsters and Axe Raider as Deck Master.

Both come from the real host's practice-deck builder and use the copied card database.

## Log in

Chromium must be installed for Playwright (`npx playwright install chromium` once).
Run each player in a separate terminal on a machine with a graphical display:

```bash
cd /home/sulman633/orca/workspaces/yugioh-bot/n-player-ui
npm run stack:login --workspace=packages/e2e -- p1
# Other terminals, if needed:
npm run stack:login --workspace=packages/e2e -- p2
npm run stack:login --workspace=packages/e2e -- p3
npm run stack:login --workspace=packages/e2e -- p4
```

Equivalent from `packages/e2e`: `node stack/login.mjs p1`.
Each opens a headed persistent browser, authenticates through the E2E credentials provider,
checks the session's player id, and opens `/duels/new`. Profiles live in `.stack/browsers/pN`.
The helper discovers the running stack's URL and throwaway auth secret from `.stack/manual.json` (mode `0600`).
The supervisor deletes that login handoff on shutdown. No Discord OAuth redirect registration is required.

## Play FFA3 with two bots

1. As p1, open `http://localhost:3400/duels/new`.
2. Enter a table name, choose the 3-player free-for-all (`ffa3`) under **Table type**, and choose **Standard**.
   Use **Unlimited** for the turn timer when exploring. Create the game.
3. In the lobby choose `Manual Standard · EARTH normals` under **Use a saved deck**,
   then click **Ready with this deck**.
4. Click **Add bot** in each of the two open seat rows (seats 2 and 3).
   Each bot receives a legal deck and is ready automatically.
5. Once all three seats are ready, click **Start duel**. If prompted to open a separate window,
   choose **Open here instead** to play in the existing tab.
6. Make choices in the table prompts; bots act at a readable pace. The host uses the real n-seat core.

For Domain, choose **Domain** at creation and use `Manual Domain · Axe Raider`.
For another human, open the room link in their logged-in player window, take an open seat,
choose their saved deck, and ready up. FFA4 uses the same stack and one more seat.
Tag (2v2) and the shared FFA4 Extra Monster Zone are outside this task's validation.

Other useful pages:

- Presets: `http://localhost:3400/duels/dev-presets`.
- Fixture table: `http://localhost:3400/dev/table-preview/ffa3` (no engine).

## Stop and clean up

Close each login browser or press Ctrl+C in its terminal. Press Ctrl+C in the stack terminal;
the supervisor sends SIGTERM to all three children and waits, with a bounded SIGKILL fallback.
Then remove the generated build, database, downloaded images, profiles, and logs:

```bash
cd /home/sulman633/orca/workspaces/yugioh-bot/n-player-ui
rm -rf packages/web/.next packages/e2e/.stack
```

Delete any Playwright traces or screenshots you created. Keep `data/duel-engine-snap` for the later test stage;
only the final owner cleanup deletes it. All runtime directories and `data/` are git-ignored.

## Verification on 2026-10-02

- `npm run test:unit --workspace=packages/e2e`: 27 tests passed, including manual defaults/port exclusions,
  image passthrough versus normal e2e stubs, player-owned saved decks, credentials login, and immutable snapshot handling.
- `npm run typecheck --workspace=packages/e2e` and the production stack build passed.
- **Manual FFA3 startup with real art**: one API smoke passed as p1, room `00hhqej5`, two bots, status `active`.
  Deck validation/submission, ready, both bot additions, start, room view, and debug trace all returned HTTP 200
  (table creation returned 201). The host supplied three seat views, each with three seats,
  and reported `ocgcore.multi.wasm`, SHA `896d6528b16227e1702088c42da8570a6c394be9c0dd93ad4f2aac9951e5c22e`.
- All four real E2E credentials sessions worked and listed two seeded decks each. The Domain saved deck passed
  the real FFA3 host's legality checks with no issues.
- **Browser FFA3 render**: one smoke passed, HTTP 200, visible Duel field, LP seats 0/1/2, real 268×391 art,
  and zero page errors. Card `69247929` also returned full 813×1185 art (160,063 bytes), HTTP 200.
- **Headed p1 login**: one launch passed using `npm run stack:login --workspace=packages/e2e -- p1`.
- **Manual shutdown**: all four isolated ports were free and `.stack/manual.json` was removed after Ctrl+C.

These checks prove startup and rendering. A complete played match, FFA4 gameplay, and Domain gameplay remain
for the later smoke stage. The transient smoke database, browser profiles, logs, and web build were deleted;
the source core snapshot was retained.
