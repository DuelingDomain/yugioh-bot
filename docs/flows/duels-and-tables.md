# Duels and tables

A table is a duel room. The host makes it, players take seats and pick decks, and the duel server runs the EDOPro engine. Multiplayer rules: [ADR 0002](../adr/0002-multiplayer-duel-rules.md). Data flow: [architecture/data-flow.md](../architecture/data-flow.md).

## Entry points

| URL | What it is | Source (`packages/web/`) |
| --- | --- | --- |
| `/duels` | Duel lobby: open tables, duels in progress (Join or Watch), Match history | `app/(app)/duels/page.tsx`, `src/components/duel/lobby.tsx` |
| `/duels/new` | Table creator. `?challenge` focuses the opponent field | `app/(app)/duels/new/page.tsx`, `src/components/duel/creator.tsx` |
| `/duels/[slug]` | Duel room: lobby, opening, table, result. `?invite=<code>` admits to a private table; `?spectate=1` watches | `app/(app)/duels/[slug]/page.tsx`, `src/components/duel/room.tsx` |
| `/duels/[slug]/replay` | Replay, see [replays.md](replays.md) | |

Every duel route uses `requireDuelActor()` (`src/lib/duel-host.ts`): Clerk session -> `users.id` -> the player row in the community. Engine work goes to the duel server through signed `POST /internal/duel` calls (`callDuelHost`).

## Formats

| Table type | Label | Seats | Opening |
| --- | --- | --- | --- |
| `1v1` | 1v1 | 2 | Rock-paper-scissors; the winner picks first or second |
| `tag` | 2v2 Tag | 4 | None |
| `ffa3` | 3-player FFA | 3 | Dice roll |
| `ffa4` | 4-player FFA | 4 | Dice roll |

Labels: `src/components/duel/table-format.ts`. Openings: `packages/shared/src/services/duels.ts` (`newOpening` for 1v1, `newDiceOpening` for FFA; Tag throws "Tag duels have no opening").

Each table also has a duel type: Standard or Domain, with or without Genesys points. Tag and FFA tables need `MULTIPLAYER_TABLES` on web and duel, and the multi cores on the duel server. Without them, the creator disables those types and `POST /api/duels` answers 403 or 409. Engine choice per format: [deployment/duel-engine-switch.md](../deployment/duel-engine-switch.md).

## Create a table

1. The host opens `/duels/new`.
2. Table: name and visibility (Public or Private).
3. Match: an opponent to challenge by name (optional; `GET /api/players?q=`), Best of 1 or 3, Ranked (off by default). Challenges, Best of 3 and Ranked are for 1v1 only.
4. Format: table type, duel type, Genesys point cap, Master Rules (1v1 only). The "Game engine" select shows only "Automatic".
5. Rules: banlist (none with Genesys), card pool (TCG + OCG, TCG, OCG), starting hand, draws per turn, deck order, first-turn draw (Domain FFA).
6. Clock and life points: starting LP, turn timer (Unlimited, or 1 to 10 minutes per turn) and what happens at zero (lose or play on). Ranked has a fixed 3-minute bank and a timeout loss.
7. Deck validation: forbid or allow invalid decks.
8. Create: `POST /api/duels` (with an `Idempotency-Key`). The host lands in `/duels/[slug]`.

## Lobby (before the duel)

| Step | Route |
| --- | --- |
| Take or change a seat | `POST /api/duels/[slug]/seat` |
| Pick a saved deck (list: `GET /api/decks?room=<slug>`) | `POST /api/duels/[slug]/deck`, check with `.../deck/validate` |
| Ready / not ready | `POST .../ready`, `POST .../unready` |
| Accept a private invite (`?invite=<code>`) | `POST .../invite` with `{ inviteCode }` |
| Let a removed player back in (host) | `POST .../invite` with `{ playerId }` |
| Remove a player (host) | `POST .../kick` |
| Add or remove the practice bot (host) | `POST` / `DELETE .../bot` |
| Leave the room | `POST .../leave` |
| Close a waiting table (host) | `POST .../cancel-waiting`, or `POST .../cancel` |
| Start (host, or a series player) | `POST .../start` |

All seats must be full and ready to start. Decks, seats and the bot are fixed once the opening runs. A waiting room closes after 10 minutes without player input (`DUEL_WAITING_IDLE_TIMEOUT_MS`). In a lobby, Back and in-app links ask before leaving (`src/components/duel/lobby-leave-guard.tsx`).

## Opening

- 1v1: both players pick rock, paper or scissors: `POST /api/duels/[slug]/opening` with `{ move }`. A tie shows the reveal, then a new round. The winner sends `{ choice: "first" | "second" }`.
- FFA3 and FFA4: the server rolls dice for every seat. Tied seats roll again. After 10 tied rounds the server breaks the tie at random (`packages/shared/src/duels/dice-opening.ts`). The turn order can move players to other seats.
- Tag: no opening step.

The duel server decides every result and timeout.

## In the duel

1. The room gets a token from `GET /api/duels/[slug]/connection` and joins the ws room. On `duel:changed` it fetches the view again with `GET /api/duels/[slug]`. Presence comes on `duel:presence`.
2. The player answers each engine prompt (summon, activate, target, pass): `POST /api/duels/[slug]/actions`. The host checks the revision and the prompt.
3. Chain responses: Auto, Always or Off for your own seat: `POST /api/duels/[slug]/chain-mode`.
4. Player input also renews the idle clock: `POST /api/duels/[slug]/activity`.
5. Surrender: `POST /api/duels/[slug]/surrender`. In a multiplayer duel, the others play on.
6. Client errors go to `POST /api/duels/client-error`.

Best of 3 (1v1 only): between games, players side deck (`POST .../series/side`), get ready (`.../series/ready`, `.../series/unready`), and the loser of the last game picks first or second (`.../series/first`). A series player can cancel a casual series: `POST /api/duels/series/[id]/cancel`.

After the duel, the host can close the finished room (`POST .../archive`). It moves to Match history.

## Active-game guard

While a game is in progress, every other app page sends the player back to its room. A lobby does not do this; it has its own leave warning.

- The app layout mounts `src/components/duel/active-game-guard.tsx`. It checks on each navigation and when the tab is visible again.
- It calls `GET /api/duels/active`. The answer is one duel or `null`, with `state: "lobby" | "playing"`.
- `/api`, sign-in pages, `/dev` and `/admin` are exempt. A failed check never blocks a page.
- To get out, the player leaves or surrenders: `POST /api/duels/[slug]/leave`.

Contract: [api/active-game-guard.md](../api/active-game-guard.md).

## Clocks and idle close

| Case | Rule |
| --- | --- |
| Casual | The turn timer from the creator. At zero: lose, or play on |
| Ranked | 180-second bank. Running out is a loss |
| Tournament | The organizer's bank, which can be unlimited |
| Any live game | 10 minutes with no player input closes it as interrupted, with no winner |

For a ranked or tournament game, the host first tries to settle a saved clock loss. Only if it cannot, it interrupts. Views, bot actions and heartbeats do not count as player input. Source: `packages/duel-server/src/host.ts` (`tick`), `DUEL_LIVE_IDLE_AFTER_MS` in `packages/shared/src/services/duels.ts`. Decision: [ADR 0005](../adr/0005-competitive-clock-recovery.md).

## Results and Elo

- The room shows the result (`src/components/duel/duel-result.tsx`). Finished duels appear in Match history on `/duels`.
- A result counts only for a ranked 1v1 series between two people, or a tournament match. A series against the practice bot never counts (`packages/shared/src/services/duel-series.ts`).
- A counted result becomes a `matches` row. Scoring (`packages/shared/src/services/scoring.ts`) updates Elo (start 1000, K = 32) and season points.
- `/leaderboard` (`GET /api/leaderboard`) and the dashboard show ratings and ranks for the current season. The owner starts and ends seasons with `npm run ops -- season` (see [owner-admin.md](owner-admin.md)).

Series and result contract: [specs/2026-09-30-duel-results-tournaments-draft-decks-design.md](../specs/2026-09-30-duel-results-tournaments-draft-decks-design.md).
