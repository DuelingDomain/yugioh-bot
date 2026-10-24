# Duel results, tournament duels and draft decks — design and contract

Date: 2026-09-30. Branch: `fix/theme-draft-bug-fixes`.

## Goals

1. A finished online duel between two humans records its result automatically,
   in the same DB transaction that finishes the duel.
   - Tournament game → the bracket slot.
   - Casual **Ranked** → an approved `matches` row (Elo, points).
   - Casual **Unranked** → duel history only.
   - Practice bot duels never count.
2. **Challenge a player**: one button makes a private duel with a named
   opponent. The bot DMs the opponent a Join link button. The challenger can
   copy the link at once. The opponent already has a seat, so the link seats
   them. A bracket slot gets a **Start duel** button. Open tables stay, with
   Ranked/Unranked and Best of 1/Best of 3.
3. **Match length**: tournaments default to Best of 3 (organizer can pick Best
   of 1). Casual: the player picks. Best of 3 has a side deck window between
   games: 60 s, or until both players click Ready. Only a player with a
   non-empty side deck gets the side panel. The side deck count stays the
   same. The loser of the last game goes first. A draw or an interrupted game
   does not count. Each new match starts from the registered deck.
4. **Deck registration**: one deck per player per tournament. A draft
   tournament accepts only the player's draft deck (auto-registered when the
   player saves it). Other tournaments: the player picks a saved deck. The deck
   can change until the player's first tournament game starts, then it locks.
5. **Draft deck**: a **Create deck** button on the draft results page opens the
   deck editor limited to the player's drafted pool. No more copies than
   drafted (server checks too). Main Deck ≥ 40, or all main-deck pool cards
   when the pool has fewer. Draft tournaments have no banlist. YDK export stays
   as a small link.
6. The manual **Create Tournament** panel on the draft results page stays. It
   gets a Best of 3 (default) / Best of 1 choice. No automatic tournament.
7. Manual reports stay for offline games. The player Report button is hidden
   while an online series of the slot is open. The organizer can set a result
   by hand; this cancels the open series.
8. Bug fix: `matches.autoApprove` must call `scoring.recordMatchResult`.

## Terms

- **Series**: one `duel_series` row. A match of 1 or 3 games between two
  players. Every human-vs-human game belongs to one series.
- **Game**: one `duels` row with `series_id` and `game_number` (1-based).
- **Player index**: 0 or 1, the order in `duel_series` (`player0_id`,
  `player1_id`). It is fixed. It is not the seat of a game.
- **Seat**: 0 or 1 in one game. Seat 0 goes first (the duel-server makes sure
  of this).

## Data model (done in foundation; see `packages/shared/src/db/schema.ts`)

- New table `duel_series` (see the migration comment block).
  `next_game_at` is an ISO-8601 string (`new Date(ms).toISOString()`).
- `duels.series_id`, `duels.game_number`, `duels.best_of` (default 1),
  `duels.ranked` (default 0). An open table stores the chosen options in
  `best_of`/`ranked`; a series game copies them from its series.
- `tournaments.best_of` (default 3), `tournaments.duel_rules_json`
  (`{ mode, masterRule, settings }`, null = defaults).
- `tournament_participants.saved_deck_id`, `deck_json`, `deck_registered_at`,
  `deck_locked_at`.
- `saved_decks.draft_id` + unique index (guild, owner, draft).

## Shared types (done; `packages/shared/src/duels/index.ts`)

`DuelBestOf`, `DuelSeriesStatus`, `DuelSeriesSummary`, `DuelSeriesSideState`,
`DuelSession.{bestOf, ranked, seriesId, gameNumber}`,
`DuelRoom.{series, mySide}`, `DuelListItem.series`, `SavedDeck.draftId`,
`checkDeckAgainstPool`, `deckCardCounts` (`duels/pool.ts`).

## Series rules

### Creation

- **Challenge** (`series.createChallenge`): players distinct and in the guild.
  Series `active`, `player0` = challenger. Settings normalized with
  visibility forced to `private`. Game 1: private duel (normal invite code),
  `organizer_player_id` = challenger, both seats taken in random order, no
  decks, `ready = 0`. Each player submits a deck (existing `deck` op, which
  sets ready). Both ready → the duel-server starts the game.
- **Tournament slot** (`series.startTournamentMatch`): the slot is `open` with
  no `match_id`, has two players (not a BYE), the tournament is `active`, the
  actor is one of the two players or the tournament creator. Both players have
  a registered deck (`tournament_participants.deck_json`). Rules come from
  `resolveTournamentDuelRules` (`services/tournament-duels.ts`). An open
  series of the slot is returned as-is (`created: false`). Series `player0` =
  slot `player_one_id`, base and current decks = registered decks. Game 1:
  private, name `"<tournament name> · Round <n>"`, organizer = `player0`,
  random seats, decks preloaded, `ready = 0`. Each player clicks **Ready**
  (`duels.markReady`). Both ready → auto start.
- **Open table**: at activation of a duel with no series and two human seats,
  `activateTx` creates a series from `duels.best_of`/`duels.ranked`
  (`player0` = seat 0 player, base decks = seat decks) and sets
  `series_id`/`game_number = 1` on the duel. A duel with a practice bot never
  gets a series.

### Activation

- `duels.activate(slug, guildId, null, …)` is a system start: allowed only for
  a series game. Non-null organizer keeps today's check for a non-series duel;
  for a series game any seated series player may start it.
- Activating a tournament series game sets
  `tournament_participants.deck_locked_at = coalesce(deck_locked_at, now)`
  for both players.

### Game finish (inside `finalizeTx`, same transaction)

Only when the duel has a series, the series is `active`, and the duel is the
series' latest game. A `cancelled` or `completed` series ignores the result.

- **Win** (completed, winner seat is a human): add a win to that player. Wins
  needed: 1 (Bo1) or 2 (Bo3).
  - Series won → `completed`, `winner_player_id`, `ended_at`. If tournament
    or ranked: `matches.recordConfirmedResult({ source: tournament ?
    "tournament" : "casual", tournamentMatchId, … })`, store `match_id`.
    Unranked casual: no match row.
  - Not yet won → `between_games`, `next_game_at = now + 60 s`,
    `side_ready<i> = 1` when player i's current deck has an empty side deck,
    else 0.
- **Draw** (completed, no winner): no win. Casual Bo1 → `completed` with no
  winner and no match row. Tournament Bo1 → `between_games`,
  `next_game_at = now`, both side-ready (immediate replay). Bo3 →
  `between_games` like a win that did not end the series.
- **Interrupted**: no win. `between_games`, `next_game_at = null`, both
  `side_ready = 0` (both players must click Ready; a casual player can cancel
  the series; a tournament organizer can set the result).
- **Lobby cancel** of a series game (either series player may cancel it)
  cancels the series (`series.cancel`).

### Between games

- `series.setSideDeck`: status `between_games`; the player is in the series;
  the new deck has the same cards as the player's current deck (multiset over
  main + extra + side + deck master); side count unchanged; main ≥ min(40, base
  main count) and ≤ 60; extra ≤ 15. Type/placement checks run in the
  duel-server first. Stores `deck<i>_json`. Does not set ready.
- `series.setSideReady`: sets `side_ready<i> = 1`.
- Due when `between_games` and (both side-ready, or `next_game_at <= now`).
- `series.createNextGame`: game `n + 1` in lobby. Seat 0 = loser of the last
  game; after a draw or interrupt, the players swap the seats of the last game.
  Decks = current decks, both `ready = 1`. Series back to `active`,
  `side_ready` reset, `next_game_at = null`. Idempotent (returns the existing
  lobby game). The duel-server starts it at once.
- Current decks carry over between games (siding continues from the last
  configuration). The side panel offers "Reset to registered deck" using
  `mySide.baseDeck`.

## Service contracts (shared)

Signatures are in code; comments there are the contract.

- `services/duel-series.ts` — `DuelSeriesService` (`cancel` is implemented
  in foundation; the rest are stubs).
- `services/duels.ts` — new `markReady`, `activate(organizerPlayerId: number |
  null)`, create input `bestOf`/`ranked`; `mapSession` must fill `bestOf`,
  `ranked`, `seriesId`, `gameNumber`; `room()` fills `series` and `mySide`;
  `list()` fills `series`.
- `services/matches.ts` — `recordConfirmedResult(input: ConfirmedResultInput)`.
- `services/tournament-duels.ts` — `TournamentDuelService`
  (`rules()` and `resolveTournamentDuelRules` are implemented in foundation).
- `duels/pool.ts` — `checkDeckAgainstPool`, `deckCardCounts` (implemented).
- `services/saved-decks.ts` — `SavedDeckWrite.draftId`, `findByDraft`.
- `web/src/lib/duel-host.ts` — `DuelHostOp` already lists the new ops.

## Duel-server contract (`packages/duel-server/src/host.ts`)

Ops on the signed POST `/internal/duel` (queued per `slug`):

| op | body | who | result |
|---|---|---|---|
| `ready` | `slug` | seated player, series game in lobby | `{ session }`; auto start when both ready |
| `deck` | existing | existing; rejected for a tournament series game (409 "Tournament games use your registered deck") and for casual series game > 1 (409) | then auto start when both ready |
| `start` | existing | non-series: organizer (today). Series game: any seated player, both ready | project |
| `series-side` | `slug` (any game of the series), `deck` | series player, `between_games` | `{ series }` after normalize + deck check + `setSideDeck` |
| `series-ready` | `slug`, | series player | `{ series, nextSlug: string \| null }`; when due: create next game and start it |
| `check-deck` | `deck`, `mode`, `masterRule`, `settings` (no slug; queue key `catalog`) | any | `{ deck, report }`: the deck after `normalizeImportedDeck`, and the `inspectDeck` report for those rules. Used for tournament registration |
| `normalize-codes` | `codes: number[]` (≤ 1000, no slug; queue key `catalog`) | any | `{ codes: Record<string, number \| null> }` input id → engine passcode (same resolution as `normalizeImportedDeck`, unresolved → null) |

- Auto start: shared `startGame(slug, guildId, organizer | null)` used by the
  `start` op and the series paths. Validates decks like today.
- After `persistComplete`, if the series is `between_games` with
  `next_game_at`, schedule `setTimeout` to advance it; the 30 s tick also
  runs `series.dueNextGames` and `series.dueStarts` for recovery.
- After a series completes with a tournament slot, POST the ws tournament
  routes (`/internal/tournament/match-updated`, and `/completed` when the
  tournament finished) with the payloads ws already accepts, through the
  existing ws transport. Emit `onChange` for the old and the new game slug.
- Verify that seat 0 goes first in the engine; if not, make it so.

## Web API contract

All routes use the existing auth helpers. Errors: `{ error }` with the
service status (`DuelServiceError`, `TournamentDuelError`,
`SavedDeckServiceError`).

- `POST /api/duels` — body adds optional `opponentPlayerId`, `bestOf` (1|3,
  default 1), `ranked` (bool, default false). With `opponentPlayerId`:
  `series.createChallenge`, notify ws, announce `duel-invite` to the bot
  (failure ignored). Response `{ session, series? }` 201. Without it: today's
  open table plus `bestOf`/`ranked`.
- `POST /api/duels/[slug]/ready` → host op `ready`.
- `POST /api/duels/[slug]/series/side` `{ deck }` → host op `series-side`.
- `POST /api/duels/[slug]/series/ready` → host op `series-ready`.
- `POST /api/duels/series/[id]/cancel` — casual: a series player; tournament:
  the tournament creator. Calls `series.cancel`, then `notifyDuelChange` for
  the changed slugs and the latest game.
- `GET /api/players?q=` — guild players for the opponent picker:
  `{ players: [{ id, displayName }] }`, max 20, excludes the caller.
- `POST /api/tournaments/[slug]/matches/[tmId]/duel` →
  `series.startTournamentMatch`; notify ws; DM the other player
  (`duel-invite`). Response `{ series, duel }`.
- `GET /api/tournaments/[slug]/deck` → `{ registration, rules, draft: { id,
  slug } | null, savedDeckOptions }` for the caller.
- `PUT /api/tournaments/[slug]/deck` `{ savedDeckId }` — loads the caller's
  saved deck, normalizes/validates through host op `check-deck` with the
  tournament rules (draft tournament: the deck must be the caller's draft
  deck of that draft and pass `checkDeckAgainstPool`), then
  `tournamentDuels.registerDeck`.
- `PATCH /api/tournaments/[slug]` gains `bestOf` and `duelRules`
  (organizer, before the first tournament game) → `tournamentDuels.setRules`.
  `POST /api/tournaments` accepts `bestOf` and `duelRules` too.
- `POST /api/tournaments/[slug]/matches/[tmId]/result` `{ winnerPlayerId }`
  (organizer) → `tournamentDuels.setResultByOrganizer`; ws
  `match-updated`.
- `GET /api/tournaments/[slug]` (the page loads everything from it) gains:
  top level `bestOf`, `duelRules: TournamentDuelRules`, `draftId: number |
  null`, `draftSlug: string | null`; each match gains `series:
  DuelSeriesSummary | null` (the open series of the slot, else the latest
  one); each participant gains `deckRegistered: boolean`, `deckLocked:
  boolean`. The UI track mirrors these in `components/tournament/types.ts`.
- `POST /api/tournaments/[slug]/report` returns 409 while the slot has an open
  series.
- `GET /api/drafts/[slug]/deck-pool` → the caller's pool as engine passcodes:
  `{ draftId, cards: [{ code, count }], mainPoolCount, savedDeckId | null }`
  (uses `drafts.pool` + host op `normalize-codes`).
- `POST /api/decks` / `PUT /api/decks/[id]` accept `draftId`; with it the
  server checks the deck against the caller's pool (`checkDeckAgainstPool`)
  and the draft main-size rule, and keeps one deck per draft (PUT updates it).
  Saving a draft deck registers it for the draft's tournament when the
  caller is a participant and the deck is not locked.
- `POST /api/drafts/[slug]/tournament` accepts `bestOf`.

## Bot

- New `AnnouncePayload` kind `duel-invite`: `{ kind: "duel-invite", guildId,
  opponentDiscordUserId, challengerName, duelName, bestOf, ranked,
  tournamentName: string | null, url }`. The bot DMs the opponent an embed
  with a **Join duel** link button. DM failure is logged, not thrown.
- The bot tournament timer (60 s) announces completed tournaments with
  `claimTournamentCompletionAnnouncement` (covers results from online duels).

## UI

- Duel creator: opponent picker (optional; empty = open table), Ranked
  toggle, Best of 1/3. Challenge result: copy link + "DM sent".
- Series game lobby: series header (Bo3, score, Ranked/tournament badge).
  Tournament game: locked registered deck + **Ready** button. Casual game 1:
  today's deck flow.
- Result screen: series score; Bo3 between games: side panel (only when
  `hasSide` for me), 60 s countdown, **Ready**; follow `currentDuelSlug` to
  the next game automatically. Series final result at the end.
- Duel list: Bo3 / Ranked / score badges; **Challenge** entry.
- Tournament create/settings: Best of + basic duel rules (mode, banlist,
  turn time). Match card: **Start duel** / **Open duel**, game score, Report
  hidden while a series is open, organizer **Set result**. **My deck** panel
  for registration and lock state.
- Draft results: **Create deck** / **Edit deck** button (deck editor in pool
  mode), Best-of select in Create Tournament, YDK export as a small link.
- Deck editor pool mode: card browser shows only pool cards with remaining
  copies; adding past the count is blocked.

## File ownership (parallel agents)

Agents do not commit and do not run state-changing git commands. An agent
edits only its own files. A needed change in another track's file is written
in the agent's final report instead.

| Track | Owns |
|---|---|
| Series core | `shared/src/services/duel-series.ts`, `shared/src/services/duels.ts`, `shared/src/services/matches.ts`, their tests |
| Tournament + decks (shared) | `shared/src/services/tournament-duels.ts`, `tournaments.ts`, `draft-tournament.ts`, `saved-decks.ts`, their tests |
| Duel-server | `packages/duel-server/**` |
| Web API + bot | `web/app/api/duels/**` (new routes + `route.ts` POST), `web/app/api/players/**`, `web/app/api/tournaments/**`, `web/src/lib/duel-host.ts`, `web/src/lib/announce-bot.ts`, `shared/src/notify/**`, `packages/bot/**`, tests |
| Web duel UI | `web/src/components/duel/**` (creator, room, room-lobby, duel-result, lobby, api.ts), `web/app/(app)/duels/**` |
| Web tournament UI | `web/src/components/tournament/**`, `web/app/(app)/tournament/**`, `web/app/(app)/tournaments/**` |
| Draft deck | `web/src/components/decks/**`, `web/app/api/decks/**`, `web/app/api/drafts/**`, `web/app/(app)/decks/**`, `web/app/(app)/draft*/**`, draft summary components. Pool mode filters on the client: the pool is small, and `getDeckCards(codes)` (card-details) already loads the card data. |
