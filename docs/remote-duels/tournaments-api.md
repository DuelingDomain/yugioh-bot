# Remote tournament API

Contract for B1 and B3, including UI fixtures. Evidence capture/retention remains B4 work.
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

## B3: proposal, confirmation, dispute and organizer decision

These routes are implemented by B3.
Prefix: `/api/tournaments/{slug}/matches/{tmId}`.

`GET {prefix}/remote-result` (paired player or organizer) returns 200:

```json
{"remoteResult":{"tournamentMatchId":45,"tableSlug":"table-slug","status":"proposed","winnerPlayerId":21,"score":{"playerOne":2,"playerTwo":1},"source":"concede","proposedAt":1794074400000,"confirmDeadlineAt":1794081600000,"reports":[{"playerId":21,"choice":"confirm","note":null,"at":1794074405000},{"playerId":22,"choice":null,"note":null,"at":null}],"finalizedAt":null,"finalizationReason":null,"organizerDecision":null},"now":1794074406000}
```

`now` is the server's current Unix time in milliseconds, included on every
successful GET, including before any table:
`{"remoteResult":null,"now":1794074406000}`. For a proposed result, start the
countdown at `Math.max(0, confirmDeadlineAt - now)` and subtract elapsed monotonic
time (`performance.now()`) since receiving the response. Refresh to resynchronize;
the client's wall clock is not used. A zero countdown does not imply finalization:
the response status remains authoritative, including when LP lacks confirmation.

The tournaments list can use this existing GET directly for a slot; no table slug
or table creation is needed. Use the pairing's `id` as `{tmId}` (the tournament
slot ID, not its recorded `matchId`). If only the tournament slug is available,
`GET /api/tournaments/{slug}` returns pairings in `matches`; select the desired
pairing and request `/api/tournaments/{slug}/matches/{matches[i].id}/remote-result`.
This returns the latest durable Remote status even after the room is purged.
Only the two paired players and the organizer can read it; a viewer who can read
the tournament but is neither receives 403 `REMOTE_RESULT_PLAYER_REQUIRED`.
The response uses `Cache-Control: private, no-store`; refresh it on the usual
tournament `match-updated` invalidation. A null result means no Remote table/result
has been recorded for that slot.

The GET (only) also carries `tableOpen` inside `remoteResult`: `false` when the linked table
has ended or was purged. An idle-closed or creator-left table with no winner leaves a `playing`
row with `tableOpen:false`; clients treat it as no result, so Start Remote Duel and the manual
report show again (the start route replaces the row with a new table).

Statuses: `playing | proposed |
disputed | final | void`. While playing, winner/score/source/proposal/deadline are
null. Source: `concede | declared | lp`. Finalization reason:
`both_confirmed | timeout | organizer` (null until final). An organizer decision
is null or `{"userId":1,"winnerPlayerId":21,"void":false,"note":null,"at":1794074405000}`;
void decisions use `{"userId":1,"winnerPlayerId":null,"void":true,"note":"Replay required","at":1794074405000}`.
When the organizer awards a winner, the result's top-level `winnerPlayerId` and
the decision's `winnerPlayerId` both reflect that ruling, even if it overturns the
proposal; `finalizationReason` is `organizer`. A void sets top-level
`winnerPlayerId` and `finalizationReason` to null. The score and source retain the
table's original outcome; use the ruling winner for the final result.
The normal slot remains `open` while playing,
proposed or disputed, and becomes `completed` through the existing scoring path.

`POST {prefix}/remote-result/confirm` with `{}` and
`POST {prefix}/remote-result/dispute` with `{"note":"LP entry was incorrect"}`
(note optional, maximum 280 characters) return 200 with the same `remoteResult`
envelope. Only paired players may report; repeat same confirmation is idempotent.
Both confirmations finalize immediately. One confirmation permits finalization
at the two-hour deadline; a final concede/declared admission permits that same
timer without a further losing-player response. LP alone with no confirmation
does not auto-finalize. An accepted terminal Undo retracts a proposed result and
clears its reports atomically; the next finish proposes afresh. Final or disputed
results cannot be undone through the room (409 `REMOTE_RESULT_FINAL` or
`REMOTE_RESULT_DISPUTED`); voided/replaced outcomes reject terminal Undo with
`REMOTE_RESULT_NOT_PROPOSED`. Either player may add their own dispute note;
confirmations are blocked once either disputes. Any dispute stops the timer until an organizer rules.

Existing `POST {prefix}/result` with `{"winnerPlayerId":21}` is the organizer
ruling path, returning `{"success":true}` (200). B3 extends it to resolve a
Remote dispute and record organizer ID/time.
This is an organizer override; the player manual-report block does not apply to it.
`POST {prefix}/remote-result/void` with `{"note":"Replay required"}` is organizer
only, returns 200 with the void `remoteResult`, and reopens an unresolved slot.
Completed single-elimination matches cannot be reopened; existing round-robin
reopen behavior stays authoritative.

Errors: 403 `REMOTE_RESULT_PLAYER_REQUIRED` or `ORGANIZER_REQUIRED`;
404 `REMOTE_RESULT_NOT_FOUND`; 409 `REMOTE_RESULT_NOT_PROPOSED`,
`REMOTE_RESULT_DISPUTED`, `REMOTE_RESULT_FINAL`, `REMOTE_REPLAY_UNAVAILABLE`;
400 `INVALID_REMOTE_REPORT` for invalid notes/body. Existing manual report will
reject live Remote tables with 409 `REMOTE_MATCH_OPEN`; it remains a fallback
when no live table or unresolved proposal/dispute is open. Ended idle/creator-left rooms without a winner do not block manual reporting. The report route also requires an active tournament.
Both shared reporting methods (`report` and `reportTournamentMatch`) enforce this
inside their write transaction. The current Discord command registry has no
tournament report command; any caller of these shared methods gets the same block.
Confirmation and timeout finalization recheck that the slot is open, so a stale
proposal cannot replace an already completed result. Lifecycle closure may append
`table.ended`; clients must refresh its sequence before issuing further actions,
and a closed table rejects Undo with 409 `TABLE_ENDED`.

B4 supplies evidence capture, deletion and the organizer evidence read route below.
Evidence survives normal table deletion through
nullable table references and copied minimal facts, never videos/images or decks.

## B4: organizer evidence read

`GET /api/tournaments/{slug}/matches/{tmId}/remote-evidence` requires an
authenticated tournament organizer or admin (`OWNER_USER_IDS`). Players and
spectators cannot read evidence unless they also hold one of these roles. The
tournament slug is scoped to the configured guild, and the match must belong to
that tournament. Admins may also read private tournaments in that guild.

Returns 200 with `{"evidence": row}`, where `row` is the stored
`tournament_remote_evidence` row described below: column names use snake_case,
and the `*_json` fields remain JSON strings. `table_id` may be null after room
deletion. Returns 404 when no evidence exists (including after retention cleanup),
the tournament is unavailable, or the match is invalid or belongs elsewhere;
unauthorized readers receive 403 (404 for an unreadable private tournament).
Responses use `Cache-Control: private, no-store`.

## Storage handoff for B3 and B4

`tournament_remote_matches` has one row per `tournament_match_id`. B1 writes
`playing`, `table_id`, `table_slug`, both player IDs and creation/update times.
B3 owns `winner_player_id`, `player_one_wins`, `player_two_wins`, `result_source`,
`proposed_at`, `confirm_deadline_at`, each `player_{one,two}_{choice,note,responded_at}`,
`finalized_at`, `finalization_reason`, `recorded_match_id` and
`organizer_{user_id,decided_at,note}`. Seat order is independent of player-one/two
order: resolve it from the table's seats when proposing a result. No-result replay
replaces the playing row; a proposed/disputed/final row blocks another start.
An idle/creator-left table with no result keeps a `playing` row with null
`proposed_at`; its evidence expires 48 hours after table end. Starting a replay
does not extend that earlier copy's deadline.

`tournament_remote_evidence` stores the copied table slug,
both user IDs, `players_json` (seat/account mapping), `table_started_at`,
`table_ended_at`, `end_reason`, `games_json`, `result_events_json`, `final_lp_json`,
`public_board_json`, `reports_json`, `detection_summary_json`, `captured_at`,
`purge_after_at` and `hard_delete_at`. JSON fields hold only the allowlisted facts
in plan section 5.2. Result/evidence `table_id` becomes null on normal room purge;
copied facts and `table_slug` survive. Account deletion, tournament cancellation
and the 1-hour/48-hour/14-day retention rules apply to those copied facts.

## B4: internal evidence capture and retention

Export from `@yugidraft/shared/services`:

```ts
captureRemoteTournamentEvidence(db: Database.Database, tableId: number, now?: number): void
```

The result service calls this inside the proposal writer transaction after
persisting the terminal action/event, ended room and proposal, using the same
server timestamp. A terminal Undo deletes that copy when it retracts the
proposal; a later finish captures a fresh copy. Capture uses a savepoint: a failed
copy is skipped while the room and proposal commit, unless the failure rolls back
the entire transaction. Idle close, creator departure and a finish without a
winner also capture evidence;
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
  manualSeconds: number;
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
  | { type: "detection.mode"; mode: "auto" | "tap" | "manual";
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
to end and logged Auto, Tap and Manual mode changes; they cannot prove a
camera/detector was running. Manual time is counted separately from Tap.
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
a newly ended room replaces that per-pairing copy. Started rooms, their history
and board-state replays are kept indefinitely by default. An optional positive
`REMOTE_DUELS_RETENTION_DAYS` cap can delete ended rooms and only nulls
evidence/result room IDs; unset or `0` keeps started rooms forever. Abandoned
ended lobbies that never started are still deleted after one day without a cap.
The worker's existing hourly `pruneRemoteDuels` performs evidence deletion too;
expired evidence is never recaptured by its purge safety net.

The existing 60-second tournament worker tick (including startup) finalizes due
eligible proposals before tournament deadline closure. It uses the durable row,
so room deletion does not affect confirmation or timeout. Scoring failures roll
back that finalization for retry and do not stop other due proposals. Confirmation,
dispute, void, proposal/retraction and organizer result changes publish the usual tournament
`match-updated` invalidation; completion also publishes `completed`.
`strictScoring` remains the existing second options argument to
`matches.recordConfirmedResult(input, {strictScoring:true})`.
