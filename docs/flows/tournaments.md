# Tournaments

A tournament is a bracket of 1v1 matches. Players join from an invite link, register a deck, and play each match online as a series (or report the result). Data flow: [architecture/data-flow.md](../architecture/data-flow.md). Series and result contract: [specs/2026-09-30-duel-results-tournaments-draft-decks-design.md](../specs/2026-09-30-duel-results-tournaments-draft-decks-design.md).

## Entry points

| URL | What it is | Source (`packages/web/`) |
| --- | --- | --- |
| `/tournaments` | Tournament list | `app/(app)/tournaments/page.tsx` |
| `/tournaments/new` | Create form | `app/(app)/tournaments/new/page.tsx`, `src/components/tournament/create-tournament-form.tsx` |
| `/tournament/[slug]` | Lobby, bracket, matches, standings. `?invite=<code>` admits | `app/(app)/tournament/[slug]/page.tsx` |
| `/tournament/[slug]/standings` | Redirects to `?tab=standings` | `app/(app)/tournament/[slug]/standings/page.tsx` |
| Draft finale | "Create tournament" from a finished draft | see [cubes-and-drafts.md](cubes-and-drafts.md#after-the-draft) |

Service: `createTournamentService` (`packages/shared/src/services/tournaments.ts`).

## Create

1. The organizer opens `/tournaments/new`.
2. Event: name and format.

   | Format | Rule |
   | --- | --- |
   | Round robin | Everyone plays everyone once. Matches can be played in any order |
   | Single elimination | Lose once and you are out. Each round is paired when the last one ends |

3. Match: the duel rules for every online duel (mode, Genesys, banlist, turn timer, best of). They lock when the first duel opens.
4. Timing: a deadline and a confirm window (1 to 720 hours, 24 by default). Both can be changed later.
5. Create: `POST /api/tournaments`. The organizer lands in the lobby as a player and can leave.

A tournament made from a draft keeps the draft's visibility and fixed rules, with Genesys off. Its saved draft decks are registered.

## Join

| Step | Who | Route |
| --- | --- | --- |
| Get or reset the invite link (`/tournament/[slug]?invite=<code>`) | Organizer | `GET /api/tournaments/[slug]/invite`, `POST .../invite/reset` |
| Open the link (read access) | Any signed-in user | `POST /api/tournaments/[slug]/invite` |
| Set visibility (private or open) | Organizer | `PATCH /api/tournaments/[slug]/visibility` |
| Join | Player | `POST /api/tournaments/[slug]/join` |
| Leave | Player | `POST /api/tournaments/[slug]/leave` |
| Remove a player | Organizer | `POST /api/tournaments/[slug]/kick` |
| Register a deck | Player | `GET` / `PUT /api/tournaments/[slug]/deck` |
| Add dev bots | Organizer, non-production only | `POST /api/tournaments/[slug]/join-bot` |
| Change name, deadline, confirm window | Organizer | `PUT /api/tournaments/[slug]` |
| Cancel | Organizer | `DELETE /api/tournaments/[slug]` |

## Start and rounds

1. The organizer presses Start: `POST /api/tournaments/[slug]`. Pairings are made. Nobody else can join.
2. Each bracket slot is a match. A match player or the organizer opens its online series: `POST /api/tournaments/[slug]/matches/[tmId]/duel`. Both players go to the duel room (see [duels-and-tables.md](duels-and-tables.md)).
3. The series uses the tournament rules and its clock bank. A clock loss counts. A series that idles for 10 minutes is interrupted with no result.
4. When the series ends, its winner is recorded for the slot. Single elimination pairs the next round when the last one ends.

Live updates: `GET /api/tournaments/[slug]/connection` gives the ws token. Events: `tournament:participant-joined`, `tournament:participant-left`, `tournament:started`, `tournament:match-updated`, `tournament:completed`, `tournament:cancelled`.

## Results without an online series

| Action | Who | Route |
| --- | --- | --- |
| Report a win or loss | A player in the match | `POST /api/tournaments/[slug]/report` |
| Approve or deny the report | The opponent | `POST /api/matches/[id]/approve`, `POST /api/matches/[id]/deny` |
| Set a result by hand (cancels the open series) | Organizer | `POST /api/tournaments/[slug]/matches/[tmId]/result` |
| Reopen a match | Organizer | `POST /api/tournaments/[slug]/reopen` |

A report is refused while an online series for that slot is running. If the opponent does not answer within the confirm window, the worker approves the report (`packages/worker/src/tournament-timer.ts`).

## End

- The organizer ends it: `POST /api/tournaments/[slug]/complete`.
- At the deadline, the worker tournament timer closes it.
- Standings: `GET /api/tournaments/[slug]/standings`, shown on `?tab=standings`.
- An approved match updates Elo and season points (see [duels-and-tables.md](duels-and-tables.md#results-and-elo)).
- With `DISCORD_BOT_ENABLED=1`, the organizer can post to Discord (`POST .../announce`) and the worker queues a completion post. Otherwise these are off (404).
