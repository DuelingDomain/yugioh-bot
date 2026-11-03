# Remote match flow

Backend contract for `feat/remote-match-ui`. Import from `@yugidraft/shared/remote`.
`match-contract.ts` exports the match types, action schemas/names and timer constants.

- Create a room with `bestOf: 1 | 3`. Default: 3 for two seats, 1 for larger tables. The host can change `bestOf` in the lobby through `POST /api/remote/:slug/format` (other format fields are optional). The room also exposes `bestOf`. Physical players can ready without an attached deck; attached decks must pass validation.
- `state.match = { bestOf, games, phase, siding?, winnerSeat?, pendingResult?, firstChooser?, firstSeat? }`. `phase` is `duel | result | siding | done`. Each game is `{ n, winnerSeat: number | null, reason: 'lp' | 'concede' | 'declared' | 'timeout', endedAt }`. Times are Unix milliseconds from the server.
- `state.ended` and `state.winnerSeat` describe the current game. Room `status` stays `active` through results/siding and becomes `ended` when the match is done. Two wins decide BO3; draws add a game without a win. BO1 ends after one game, including a draw (`match.winnerSeat: null`). Larger tables use individual seats and elimination, as before.
- LP elimination or `player.concede` ends the game when at most one seat remains. A nonfinal game enters `result`. A decided match enters `done`; the last game still supplies the result screen. `match.continue` opens siding from `result`.

Send actions to the existing `POST /api/remote/:slug/actions` as `{ baseSeq, action: { type, actorSeat, idempotencyKey, ...payload } }`.

| Action | Payload / effect |
| --- | --- |
| `player.concede` | Concede your own seat. No confirmation. |
| `match.declare` | `{ winnerSeat: number | null }`. Propose a win or draw. The proposer confirms automatically. |
| `match.confirm` | `{ declarationId, accept: boolean }`. Each other seat confirms once. A rejection clears the proposal. The game ends only after all seats confirm. |
| `match.continue` | Open siding. Any seated player, including the loser, can continue. |
| `match.first` | `{ seatGoesFirst }`. Only `match.firstChooser` can choose during siding. |
| `side.ready`, `side.unready` | `{ seat }`. Only that seat's actor can change its Ready state. |
| `side.swap` | `{ deckChanges: { main: number[], extra: number[], side: number[] } }`. Replace your attached deck's sections; keep every card and each section's size. Main 40–60; Extra and Side at most 15. Deck Master stays fixed. A save clears your Ready state. The saved deck library stays unchanged. |
| `side.timeout` | No payload. A clock check, never a game loss. The server supplies time and also checks deadlines in its periodic room sweep. Early checks are rejected. |

`pendingResult = { id, winnerSeat, confirmed: number[] }`. Confirm the current ID; stale/duplicate confirmations are rejected. LP elimination or a concession clears a pending declaration.

`siding = { deadline, ready: number[], extendedFor: number[] }`. Physical-only seats get 180 seconds. Seats with an attached deck get 300 seconds and appear in `extendedFor`. `deadline` is the last seat's deadline. In a mixed room, a physical seat's deadline is `deadline - 120000`; attached seats use `deadline`. Expired seats become Ready and cannot edit their decks or readiness. The chooser can set the first player until the final deadline. The next game starts when all seats are Ready and the first-player choice is set, or when the final deadline passes. Timeout defaults to the previous loser going first. After a draw, the previous first player goes first. Larger-table BO3 uses the seat after the winner as chooser. The existing server sweep runs every 30 seconds; a `side.timeout` request can check an elapsed deadline sooner.

The next game resets LP to the room's configured starting LP, all field/pile/hand twins, eliminations, turn/phase, pending attacks, recognition/effect tracking and live deck warnings. It keeps deck registrations, room rules and the match record. Undo can correct LP/concession results before siding. Siding and match actions clear history; Undo cannot cross games. Match state uses normal room snapshots, private projection, event replay and WebSocket broadcasts. Deck swap contents remain private to their owner.
