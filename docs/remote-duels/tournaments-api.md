# Remote tournament API

Contract for B1 and UI fixtures; B3 routes below are planned, not implemented by B1.
All routes require the normal authenticated web session and configured guild. IDs are
numbers (application user IDs and gameplay player IDs are different). Timestamps in
Remote result/evidence JSON are Unix milliseconds; existing tournament dates retain
ISO strings. Errors use `{ "error": "human readable message", "code": "CODE" }`
for the new Remote checks; existing route validation/auth errors retain their current
shape. Responses containing private Remote data use `Cache-Control: private, no-store`.

## B1: tournament lifecycle

`POST /api/tournaments`

```json
{"name":"Physical Cup","format":"round_robin","visibility":"private","duelType":"remote","bestOf":3,"duelRules":{"mode":"normal","masterRule":5}}
```

`format`: `round_robin | single_elim`; `duelType`: `online | remote` (omitted =
`online`). Remote supports Advanced (`normal`) only, with no Genesys rules.
`bestOf`: `1 | 3`. No registered deck is required for Remote entrants.
201 response:

```json
{"id":12,"name":"Physical Cup","format":"round_robin","status":"pending","visibility":"private","webSlug":"cup","duelType":"remote"}
```

`GET /api/tournaments/{slug}` retains the existing tournament payload and adds
`duelType`. Tournament statuses: `pending | active | completed | cancelled`.
Duel type is fixed at creation in B1 (no update API); Remote rules lock at start.
`POST /api/tournaments/{slug}/join` takes no body and returns
`{"success":true,"playerId":21,"displayName":"Alice"}` (200). Invite entry
uses this same route. Valid invite redemption via
`POST /api/tournaments/{slug}/invite` (`{"code":"invite-code"}` -> `{"ok":true}`)
also enforces Remote access before granting admission. The development-only
`POST /api/tournaments/{slug}/join-bot` uses the same entrant checks for Remote;
its online behavior is unchanged. `POST /api/tournaments/{slug}` starts the tournament, takes
no body, and returns `{"id":12,"status":"active"}` (200).

Remote create/join/start require literal `REMOTE_DUELS=1`. Create and join check
`REMOTE_DUELS_USERS`; start checks every entrant again. Unset or `*` allows all;
empty allows nobody. Start refusal includes:

```json
{"error":"Some entrants do not have Remote Duel access","code":"REMOTE_ENTRANTS_BLOCKED","entrants":[{"playerId":22,"displayName":"Bob"}]}
```

## B1: start or return a table

`POST /api/tournaments/{slug}/matches/{tmId}/remote` takes no body. Either paired
player may call; an organizer who is not paired cannot. 201 when created, 200 on
repeat (same table, including when called by the opponent):

```json
{"created":true,"table":{"slug":"table-slug","tournamentMatchId":45,"seatCount":2,"status":"lobby","bestOf":3,"format":{"id":"normal"},"visibility":"private","detectionDefault":"auto"},"tableUrl":"/duels/remote/table-slug"}
```

`table` is the normal RemoteTable metadata (additional normal fields, including
seats and format rules, are present); it contains no board, events or private decks.
Table statuses: `lobby | active | ended`. Slot statuses remain `open | pending_approval | completed`. Creator occupies seat 0; seat 1 is
reserved for the other paired account. Only these accounts can use
`POST /api/remote/{tableSlug}/seat` with `{}` or `{"seat":1}` (200 normal RemoteRoom
response, containing `state`, `events`, `mySeat` and table metadata). Existing room,
ready, start, actions and deck APIs are unchanged. Tournament format/best-of cannot
be reconfigured through the room API. Private tables have no spectators.
`detectionDefault: "auto"` is a tournament-only instruction for U4 to override the
device preference for this table; B1 does not implement detector UI or mode events.
An ended idle/creator-left table without a winner can be replaced; a finished
result cannot be bypassed by starting again. One live table per pairing is enforced
transactionally and by a unique partial index.

New Remote errors (the same codes apply in shared services):

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | INVALID_DUEL_TYPE | duelType is not online/remote |
| 400 | REMOTE_FORMAT_UNSUPPORTED | Remote format is not Advanced |
| 403 | REMOTE_ACCESS_REQUIRED | This tournament uses Remote Duels. Ask for access first. |
| 403 | REMOTE_MATCH_PLAYER_REQUIRED | Only paired players may start/join |
| 404 | REMOTE_DISABLED | Remote switch is off |
| 404 | TOURNAMENT_NOT_FOUND | Missing tournament or unreadable guild/slug |
| 404 | TOURNAMENT_MATCH_NOT_FOUND | Missing slot or wrong tournament |
| 409 | REMOTE_ENTRANTS_BLOCKED | Entrants lost access; includes entrants array |
| 409 | TOURNAMENT_NOT_ACTIVE | Tournament is not active |
| 409 | WRONG_DUEL_TYPE | Wrong online/Remote start endpoint |
| 409 | TOURNAMENT_MATCH_UNAVAILABLE | Bye, reported/completed slot, or outstanding result |
| 409 | TOURNAMENT_RULES_LOCKED | Linked table rules or started Remote tournament rules cannot change |
| 409 | SEAT_UNAVAILABLE | Requested seat is occupied/unavailable |
| 409 | TABLE_ENDED / TABLE_IDLE | Existing room ended/expired (normal Remote API) |
| 409 | REMOTE_TABLES_FULL | Existing rollout room cap reached |

## Planned B3: proposal, confirmation, dispute and organizer decision

These routes are fixture contracts for the next worker. They do not exist in B1.
Prefix: `/api/tournaments/{slug}/matches/{tmId}`.

`GET {prefix}/remote-result` (paired player or organizer) returns 200:

```json
{"remoteResult":{"tournamentMatchId":45,"tableSlug":"table-slug","status":"proposed","winnerPlayerId":21,"score":{"playerOne":2,"playerTwo":1},"source":"concede","proposedAt":1794074400000,"confirmDeadlineAt":1794081600000,"reports":[{"playerId":21,"choice":"confirm","note":null,"at":1794074405000},{"playerId":22,"choice":null,"note":null,"at":null}],"finalizedAt":null,"finalizationReason":null,"organizerDecision":null}}
```

Before any table: `{"remoteResult":null}`. Statuses: `playing | proposed |
disputed | final | void`. While playing, winner/score/source/proposal/deadline are
null. Source: `concede | declared | lp`. Finalization reason:
`both_confirmed | timeout | organizer` (null until final). An organizer decision
is null or `{"userId":1,"winnerPlayerId":21,"note":null,"at":1794074405000}`;
void decisions use a null winner. The normal slot remains `open` while playing,
proposed or disputed, and becomes `completed` through the existing scoring path.

`POST {prefix}/remote-result/confirm` with `{}` and
`POST {prefix}/remote-result/dispute` with `{"note":"LP entry was incorrect"}`
(note optional, maximum 280 characters) return 200 with the same `remoteResult`
envelope. Only paired players may report; repeat same confirmation is idempotent.
Both confirmations finalize immediately. One confirmation permits finalization
at the two-hour deadline; a final concede/declared admission permits that same
timer without a further losing-player response. LP alone with no confirmation
does not auto-finalize. Any dispute stops the timer until an organizer rules.

Existing `POST {prefix}/result` with `{"winnerPlayerId":21}` is the organizer
ruling path, returning `{"success":true}` (200). B3 will extend it to resolve a
Remote dispute and record organizer ID/time. Planned
`POST {prefix}/remote-result/void` with `{"note":"Replay required"}` is organizer
only, returns 200 with the void `remoteResult`, and reopens an unresolved slot.
Completed single-elimination matches cannot be reopened; existing round-robin
reopen behavior stays authoritative.

Planned errors: 403 `REMOTE_RESULT_PLAYER_REQUIRED` or `ORGANIZER_REQUIRED`;
404 `REMOTE_RESULT_NOT_FOUND`; 409 `REMOTE_RESULT_NOT_PROPOSED`,
`REMOTE_RESULT_DISPUTED`, `REMOTE_RESULT_FINAL`, `REMOTE_REPLAY_UNAVAILABLE`;
400 `INVALID_REMOTE_REPORT` for invalid notes/body. Existing manual report will
reject live Remote tables with 409 `REMOTE_MATCH_OPEN`; it remains a fallback
when no table or unresolved proposal/dispute is open. B3 owns these block rules.

B4 supplies internal evidence capture and deletion; organizer evidence HTTP reads
remain integration/UI work. No evidence endpoint is implemented by B1 or B4. Evidence survives normal table deletion through
nullable table references and copied minimal facts, never videos/images or decks.

## Storage handoff for B3 and B4

`tournament_remote_matches` has one row per `tournament_match_id`. B1 writes
`playing`, `table_id`, `table_slug`, both player IDs and creation/update times.
B3 owns `winner_player_id`, `player_one_wins`, `player_two_wins`, `result_source`,
`proposed_at`, `confirm_deadline_at`, each `player_{one,two}_{choice,note,responded_at}`,
`finalized_at`, `finalization_reason`, `recorded_match_id` and
`organizer_{user_id,decided_at,note}`. Seat order is independent of player-one/two
order: resolve it from the table's seats when proposing a result. No-result replay
replaces the playing row; a proposed/disputed/final row blocks another start.

`tournament_remote_evidence` is empty in B1. B4 writes the copied table slug,
both user IDs, `players_json` (seat/account mapping), `table_started_at`,
`table_ended_at`, `end_reason`, `games_json`, `result_events_json`, `final_lp_json`,
`public_board_json`, `reports_json`, `detection_summary_json`, `captured_at`,
`purge_after_at` and `hard_delete_at`. JSON fields hold only the allowlisted facts
in plan section 5.2. Result/evidence `table_id` becomes null on normal room purge;
copied facts and `table_slug` survive. B4 must implement account/tournament
cancellation cleanup and the accepted 1-hour/48-hour/14-day retention rules before
writing evidence. B1 does not capture evidence or finalize any results.

## B4: internal evidence capture and retention

Export from `@yugidraft/shared/services`:

```ts
captureRemoteTournamentEvidence(db: Database.Database, tableId: number, now?: number): void
```

B3 calls this inside the proposal writer transaction after persisting the ended
room. B4 also calls it at match completion, idle close and creator departure;
`purgeEnded` is the missing-copy safety net. Capture is atomic, idempotent for the
same room/end time and a no-op for missing/live/unlinked rooms, obsolete replay
rooms, cancelled tournaments or evidence whose retention has elapsed. The
optional server clock defaults to `Date.now()`; retention supplies its fixed time.
Never expose this function or raw evidence through an unguarded endpoint.

The B1 JSON columns have these shapes (IDs here are **account** IDs unless named
otherwise; timestamps are Unix milliseconds):

```ts
players_json: { userId: number; seat: number }[] // actual occupied seats
// player_one_user_id/player_two_user_id follow the pairing, not seat order
games_json: { n: number; winnerSeat: number | null;
  reason: "lp" | "concede" | "declared" | "timeout"; endedAt: number }[]
result_events_json: { seq: number; at: number; userId: number | null;
  seat: number | null; action: ResultAction }[]
final_lp_json: { n: number; seats: { seat: number; lp: number }[] }[]
public_board_json: { seat: number; cards: { zone: string; slot?: number;
  cardId?: number; passcode?: number; name?: string;
  position: "attack" | "defense" }[] }[]
reports_json: { userId: number; choice: "confirm" | "dispute" | null;
  note: string | null; at: number | null }[] // player one, then player two
// Reports update when B3 writes the result row, even after the room is gone.
detection_summary_json: { seat: number; autoSeconds: number; tapSeconds: number;
  identifiedByClick: number; identifiedByTyped: number; manualCorrections: number;
  unknownAtGameEnd: { n: number; count: number }[] }[]
```

`ResultAction` is an explicit allowlist:

```ts
type ResultAction =
  | { type: "lp.change"; seat: number; delta: number; reason: string }
  | { type: "player.concede" }
  | { type: "match.declare"; winnerSeat: number | null }
  | { type: "match.confirm"; declarationSeq: number | null; accept: boolean }
  | { type: "undo"; targetSeq: number | null }
  | { type: "detection.mode"; mode: "auto" | "tap";
      reason: "player" | "slow-offer" | "start" };
```

Declaration/undo references use log sequences in place of arbitrary action IDs;
a target may be outside the excerpt. No idempotency key, effects, messages, card
movement, raw identification event or other log payload is copied. Final LP is
reconstructed from stored reducer inputs at each surviving game end, including
Undo and siding resets. The last board uses the final authoritative state, preserving each eliminated
seat’s last public cards before concede/LP clears its board.
Only face-up cards in monster/spell zones (including Extra Monster, Field and
Pendulum zones), graveyard and banished qualify; Extra Deck and hands never do,
even when revealed. Only the listed card fields are kept.

Auto is the initial per-seat default. Durations use server times from table start
to end and logged mode changes; they cannot prove a camera/detector was running.
Identification counts include each click/typed batch item. Manual corrections
count logged non-auto twin/pile actions plus `twin.merge` and `deck.flag.dismiss`,
including later-undone actions. Unknown counts include face-up public cards
without an ID/passcode/name at each finished game end. These are completeness
indicators; Tap and Auto accuracy remain unmeasured.

B3 must write `finalized_at` and `finalization_reason` on finalization, and
`organizer_decided_at` for a ruling or void. Database triggers maintain
`reports_json` and `purge_after_at` as those fields change. Both-confirmed final
rows are eligible immediately, so the **next hourly run** removes evidence within
one hour. Timeout finalization and organizer decisions retain it for 48 hours.
Disputes have no soft deadline until decided. `hard_delete_at` is always table
end + 14 days, including unresolved disputes. Cancellation deletes immediately;
account deletion removes either participant's evidence even after room deletion.
Starting a replay leaves the previous copy on its original deletion deadline;
a newly ended room replaces that per-pairing copy. Room deletion
still runs after 24 hours by default and only nulls evidence/result room IDs.
The worker's existing hourly `pruneRemoteDuels` performs evidence deletion too;
expired evidence is never recaptured by its purge safety net.
