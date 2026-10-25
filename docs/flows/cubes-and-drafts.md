# Cubes and drafts

A cube is a saved card pool. A draft deals that pool to the players in piles, and each player picks cards into a pool for a deck. How the deal works: [architecture/draft-engine.md](../architecture/draft-engine.md). Data flow: [architecture/data-flow.md](../architecture/data-flow.md).

## Entry points

| URL | What it is | Source (`packages/web/`) |
| --- | --- | --- |
| `/cubes` | Cube library | `app/(app)/cubes/page.tsx`, `src/components/cubes/cubes-library-list.tsx` |
| `/cubes/[id]` | Cube editor (owner of the cube only; others get 404) | `app/(app)/cubes/[id]/page.tsx`, `src/components/cubes/cube-editor.tsx` |
| `/drafts` | Draft list, with a "rejoin" banner for your open drafts | `app/(app)/drafts/page.tsx` |
| `/drafts/new` | Choose cube draft or theme draft. Goes straight to `/drafts/new/cube` when theme drafts are off | `app/(app)/drafts/new/page.tsx` |
| `/drafts/new/cube` | Cube (booster-style) draft setup | `app/(app)/drafts/new/cube/page.tsx` |
| `/drafts/new/theme` | Theme draft setup (only when `THEME_DRAFTS` is on) | `app/(app)/drafts/new/theme/page.tsx` |
| `/draft/[slug]` | Lobby, draft room, finale and summary | `app/(app)/draft/[slug]/page.tsx` |
| `/decks/draft/[slug]` | Build a deck from your draft pool | see [decks.md](decks.md) |

`/themes` and `/themes/[id]` redirect to the cube pages.

## Cubes

A cube has a Main pool and an Extra pool, a copy limit per card, and a saved draft config. Only the person who made a cube can open or change it (`cubeOwnerAccess` in `src/lib/cube-access.ts`). Service: `createCubeService` (`packages/shared/src/services/cubes.ts`).

| Action | Route |
| --- | --- |
| List and create | `GET /api/cubes`, `POST /api/cubes` (can create and fill from `importText`) |
| Read, change, delete | `GET`, `PUT`, `DELETE /api/cubes/[id]` |
| Add or remove cards, import a list | `POST /api/cubes/[id]/cards` (`op: "importList"` and others) |
| Seed from an archetype | `POST /api/cubes/[id]/seed/preview`, then `POST /api/cubes/[id]/seed/confirm` |
| Card era info | `GET /api/cubes/[id]/era` |
| Export as `.ydk` | `GET /api/cubes/[id]/ydk` |

List import takes a `.txt` or `.ydk` file read as text, or pasted text: passcodes, names, and counts such as `3 Dark Hole`. Contract: [api/cube-list-import.md](../api/cube-list-import.md).

## Create a cube draft

1. The host opens `/drafts/new/cube`. The page has three parts: sources, pool, rules.
2. Sources (tabs): Cards, Archetype, Set, List, Cubes. "List" resolves pasted text through `POST /api/cards/resolve`. "Cubes" uses a saved cube as the pool.
3. The pool browser shows Main and Extra pool cards. After create, the draft's pool is read from `GET /api/drafts/[slug]/pool`.
4. Rules: Players, Cards per pile, Main Deck cards each, Picks per turn (1 or 2), Seconds per pick, "Limit 3 copies per card", and "Draft the Extra Deck on its own" (up to 15 Extra Deck cards each). Meters show if the pool is large enough. "Fit to pool" changes the rules to fit.
5. Create: `POST /api/drafts`. The host lands on the lobby at `/draft/[slug]`.

The size check at create time only warns. The real check runs at start (`analyzeCube` in `startDraft`).

## Create a theme draft

Each player drafts alone from an assigned cube (one cube per archetype). Theme drafts are hidden unless the web server has `THEME_DRAFTS=1` (`src/lib/theme-drafts.ts`).

1. The host creates the draft at `/drafts/new/theme`.
2. In the lobby ("Theme Table"), the host attaches or removes cubes: `POST` / `DELETE /api/drafts/[slug]/cubes`. A seat or the host can preview an attached cube: `GET /api/drafts/[slug]/cubes/[id]`.
3. Cube selection is `host_assigned`, `random` or `player_pick`. With `player_pick`, each player claims a cube: `POST`/`DELETE /api/drafts/[slug]/claim-cube`.
4. `GET /api/drafts/[slug]/preflight` checks that each cube has enough cards.

## Lobby

| Step | Who | Route |
| --- | --- | --- |
| Share the invite link (`/draft/[slug]?invite=<code>`) | Host | `GET /api/drafts/[slug]/invite`, new link: `POST .../invite/reset` |
| Open the link (gives read access, not a seat) | Guest | `POST /api/drafts/[slug]/invite` |
| Set visibility: private (invite link only) or open (listed in Open now) | Host, pending only | `PATCH /api/drafts/[slug]/visibility` |
| Join or leave a seat | Player | `POST` / `DELETE /api/drafts/[slug]/join` |
| Ready | Player | `POST /api/drafts/[slug]/ready` |
| Remove a player | Host | `DELETE /api/drafts/[slug]/players/[playerId]` |
| Add a test bot | Host | `POST /api/drafts/[slug]/join-bot` |
| Change settings | Host | `PUT /api/drafts/[slug]` |
| Start | Host | `POST /api/drafts/[slug]/start`; stop the countdown: `DELETE` |
| Auto-start | Host | `PUT /api/drafts/[slug]/auto-start` |
| Nudge players in Discord | Host | `POST /api/drafts/[slug]/nudge` (404 unless `DISCORD_BOT_ENABLED=1`) |

Start rules (`packages/shared/src/services/draft-lobby.ts`):

- A draft needs at least 2 players.
- The host can start when everyone is ready, or force a start. A start arms a 5-second countdown.
- With auto-start on, a full and ready table arms a 10-second countdown.
- The worker's draft timer (`packages/worker/src/draft-timer.ts`, every second) starts the draft when the countdown ends.

Test bots are on in any non-production build. In production they need `DRAFT_TEST_BOTS=1` on the web server (`src/lib/draft-test-bots.ts`). The draft API returns `botsEnabled`, so the page never reads the environment.

## Draft room

1. When the draft starts, the deal is computed and saved. Wave 1 opens.
2. Each player sees their pile, picks a card, and the pile passes to the next seat: `POST /api/drafts/[slug]/pick`.
3. Bots pick right after each human pick.
4. When the pick timer runs out, the worker draft timer auto-picks for players who did not pick (`expireCurrentPickStep`).
5. Players can send fixed table-talk lines (no free text): `POST /api/drafts/[slug]/talk`.
6. Optional Extra Deck rounds come after the Main Deck rounds.

Live updates: the page gets a token from `GET /api/drafts/[slug]/connection` and joins the Socket.IO room. Events: `draft:status`, `draft:seats`, `draft:talk`, `draft:resync`, `draft:complete`. The state store is `src/lib/stores/draft-store.ts`.

## After the draft

The finale screen (`src/components/draft/room/finale.tsx`) offers:

| Action | Route |
| --- | --- |
| Build a deck from your pool | `/decks/draft/[slug]`, pool from `GET /api/drafts/[slug]/deck-pool` |
| Download your picks as `.ydk` | `GET /api/drafts/[slug]/export` |
| Create a tournament from the draft (host) | `POST /api/drafts/[slug]/tournament`. Saved draft decks are registered for it. See [tournaments.md](tournaments.md) |

## Cancel rule

If the host stops a draft early, the whole draft is cancelled. Nobody gets decks, exports or a tournament from it. There is no "end early and keep picks".

- Cancel: `POST /api/drafts/[slug]/cancel`. Only the host or an owner. A completed draft cannot be cancelled.
- `DELETE /api/drafts/[slug]` (creator only) cancels a pending or active draft, and deletes a completed or cancelled one.

Owner rule and HTTP contract: [api/draft-host-end.md](../api/draft-host-end.md).
