# Remote Duels foundation contract

Remote Duels track physical games. They do not run ocgcore or infer hidden cards, battle damage, card legality, or effects. The current module is Standard MR5 Yu-Gi-Oh!, with 2-player play and 3/4-player FFA. The owner MVP spec takes precedence over the earlier engine/app design report (LiveKit, 2–4 seats, and `lobby|active|ended`).

## Imports and ownership

- Browser-safe types, schemas, registry and reducer: `@yugidraft/shared/remote` (`packages/shared/src/remote/`). No Node, database, media or engine dependencies.
- Server service: `createRemoteDuelService(db)` from `@yugidraft/shared/services` (`packages/shared/src/services/remote-duels.ts`).
- Room token helpers: `@yugidraft/shared/ws` (`remote-token.ts`). Server only.
- Proof UI: `packages/web/src/components/remote/remote-workbench.tsx`. Replace freely; keep the HTTP/action/event contract.
- Video extension: `POST /api/remote/[slug]/livekit`. STT extension: `GameModule.parseCommand` returning `RemoteActionProposal | null` (the full action union without key/time). Recognition extension: `RemoteDataMessage` and `card.identified`. No video, STT or recognition model is included in this foundation.

`GameModule` exposes `id`, `name`, `phases`, `seatsAllowed: readonly (2|3|4)[]`, `resources`, `zones`, `initialState`, `reduce(state, action)` and a `parseCommand` placeholder returning null. Register additional modules in `remoteGames`. Game rules live in the module; transport and membership stay generic. Resource values are `state.seats[seat].resources[id]`. Phase/zone identifiers are strings owned by the module.

## Identity, seats and lifecycle

All HTTP operations use the existing `requireWebAccess()` session guard and configured `DISCORD_GUILD_ID`, matching current duel access. Application `users.id` is the remote identity; it is neither a Discord snowflake nor `players.id`. The current app has no separate Discord membership gate. Do not introduce a Discord REST lookup. The server checks that the command's actor seat equals the session user's stored remote seat.

Seats are **zero-based**, fixed in clockwise order. The creator occupies seat 0. A signed-in user can list open lobbies and join an available seat in the configured guild. Only seated users can read state/events or mint media/room credentials; there are no spectators. Open-list responses contain table metadata and seats, never game state/events. This foundation uses open guild lobbies; private invites and ranked results are outside this contract.

Players set readiness explicitly; only the creator starts, after every seat is occupied and ready. Seat 0 starts. Lobby guests can leave and free their seat; creator departure ends the lobby. An active player uses `player.concede`; their membership remains so they can read the result and undo. Tables end on a game winner or idle closure. No Elo, seasons, tournament results, engine workers or engine `duels.kind` writes occur.

## Actions and reducer

An action is a discriminated union validated by `remoteActionSchema`. Every action has:

```ts
{ type: string; idempotencyKey: string; actorSeat: number; at?: number }
```

`idempotencyKey` is the action ID (1–100 characters; use `crypto.randomUUID()`). The `sys:` prefix is reserved. Persist this key through network retries. Optional `at` lets an optimistic client inject a clock. **The server always replaces `at` with its own epoch milliseconds**. Reducers perform no clock reads, I/O or randomness; replay uses the stored timestamp. For optimistic reduction, call `game.reduce(state, { ...action, at: Date.now() })`, then replace with authoritative server state.

| type | Additional fields | Behavior |
| --- | --- | --- |
| `phase.set` | `phase` | Only turn player; explicit phase selection permits agreed corrections. |
| `phase.advance` | none | Next available phase; End advances to next living seat's Draw. |
| `turn.end` | none | Next living seat's Draw. |
| `lp.change` | `seat`, integer nonzero `delta`, `reason` (1–200 chars) | Any living seated actor may record agreed damage/healing for a living seat. Clamp at 0; max LP 999999. Zero eliminates. |
| `attack.declare` | `attackerSeat`, optional `attackerCardRef`, `targetSeat`, either `targetCardRef` or `direct: true` | Turn player in an available Battle Phase; opponent target must be living. Supplied card refs must exist on the indicated twins. |
| `attack.resolve` | `attackId`, `outcome: 'resolved'|'cancelled'` | Attacker or target clears the pending attack. Does **not** change LP; emit confirmed `lp.change` separately. |
| `card.identified` | `seat`, `cardId` and/or `passcode`, optional `zone`, `source: 'click'|'auto'|'voice'|'typed'` | Public last-identified card plus event log. At least one positive numeric ID required. Does not automatically place a twin. |
| `twin.place` | `seat`, `zone`, `card` | Field owner only. `card: {ref, cardId?, passcode?, faceUp?:true, position?:'attack'|'defense'}`; instance ref is unique within the seat. Defaults: face-up, attack. |
| `twin.move` | `seat`, `zone`, `cardRef` | Owner moves an existing instance to a zone. |
| `twin.flip` | `seat`, `cardRef`, `faceUp` | Owner sets face visibility. |
| `twin.remove` | `seat`, `cardRef` | Owner removes the instance. |
| `log.note` | `text` (1–500 chars) | Shared note; also the explicit “Still playing” action. |
| `undo` | `targetActionId` | Any seated user can undo the latest reversible action within **5000 ms inclusive**, including an elimination/winning action. |
| `player.concede` | none | Eliminates the actor; last living seat wins. |

Undo restores a bounded pre-action game position; it never deletes events. All board-changing actions replace the undo slot; `log.note` preserves it. Undo clears the slot and cannot itself be undone. A newer board-changing action makes older actions unavailable. Only `undo` may reopen a game-ended table; idle/creator closures cannot reopen. Idempotent retries do not renew the undo window. Logs remain visible after undo so readers see the correction.

Yu-Gi-Oh phase IDs: `draw`, `standby`, `main1`, `battle`, `main2`, `end`. Display names: Draw, Standby, Main 1, Battle, Main 2, End. LP starts at 8000 independently for each seat. Zone IDs: `monster`, `spell-trap`, `extra-monster`, `field`, `graveyard`, `banished`. Twins are optional **public** field annotations, max 100 instances per seat, not an authoritative inventory. Do not put private hands, Deck order, face-down identities or unannounced cards into them. The UI must omit private card IDs when placing face-down cards; the server does not maintain private views.

Relevant rules from [ADR 0002](../adr/0002-multiplayer-duel-rules.md): clockwise order and fixed seats (`R-FFA-ORDER`); 2-player turn 1 skips Battle; in FFA Battle opens when the last currently living duelist starts their first turn (`R-FFA-NO-ATTACK`), accounting for early elimination. Zero LP and concession eliminate; future turns skip that seat; last living seat wins. If the turn player leaves, remaining living players may advance the remaining phases/end that turn, preserving fixed seats. Normal effects/response windows remain physical, with no chain simulation. Standard MR5's first player skips their first draw (`R-FFA-FIRST-DRAW`), a physical instruction, not an automatic card change. An opponent monster/direct target follows `R-FFA-ATTACK`; because the twin is optional, physical monster presence and direct-attack legality are agreed by the players rather than inferred from missing twin cards.

## Persistence and service

Additive, rerunnable migration in `packages/shared/src/db/schema.ts`:

| Table | Columns and invariants |
| --- | --- |
| `remote_tables` | `id`, unique `slug`, `guild_id`, `game_id`, `seat_count` (2/3/4), `status` (lobby/active/ended), `created_by` → users, `state_json`, `last_seq`, `created_at`, `started_at`, `ended_at`, `last_event_at`, `idle_warning_at`, `end_reason` (game/idle/creator-left). All timestamps integer epoch ms. |
| `remote_seats` | `table_id`, `seat`, `user_id` → users, `display_name`, `ready`. PK `(table_id,seat)`; unique `(table_id,user_id)`. |
| `remote_events` | increasing storage `id`, `table_id`, contiguous `seq`, `idempotency_key`, nullable `actor_seat`, nullable `user_id`, `action_json`, `created_at`. Unique `(table_id,seq)` and `(table_id,idempotency_key)`. UPDATE/DELETE triggers enforce append-only. |

`remote_tables.state_json` caches the game state. `service.replay(slug,guildId,userId)` reconstructs it from initial state and gameplay events. Lifecycle metadata/seats are materialized transactionally; their system events remain in the same log. Game state can have `ended:false` when the *table* ended from idle or lobby departure: table status is authoritative for lifecycle.

Service methods: `create`, `join`, `leave`, `ready`, `start`, `get`, `list`, `act`, `replay`, `sweepIdle`; `snapshot` is a trusted internal transport read with **no** viewer authorization and must never be exposed through an unguarded route. The exported TypeScript signatures are the source for argument details. Mutations run in one `BEGIN IMMEDIATE` transaction: load guild/slug, verify identity, check sequence, reduce, append event, update cache and timestamps. An invalid action rolls back entirely. Duplicate gameplay keys return current state only when the same authenticated user submits the same command (client `at` excluded). Different contents/user give `409 IDEMPOTENCY_CONFLICT`. Duplicate lookup precedes the sequence/lifecycle check, so a lost response can be retried safely even after later actions or game end.

System actions: `table.created {gameId,seatCount}`, `seat.joined {seat,userId}`, `seat.left {seat,userId}`, `seat.ready {seat,ready}`, `table.started`, `idle.warning {closesAt}`, `table.ended {reason:'idle'|'creator-left'}`. System event IDs start `sys:` and cannot be submitted as gameplay actions. Join events deliberately contain no personal-name snapshot; names are read from seats. Remote references count as account history, and account deletion anonymizes seat names while preserving event history and IDs.

`RemoteEvent = {id,seq,actorSeat,userId,at,action}`; `id` equals the idempotency key, not the integer storage ID. All event history is public to the table. Do not store audio, video, frames or raw speech transcripts; voice workers emit parsed actions only.

## HTTP routes

All responses use `Cache-Control: private, no-store`. All routes return 404 when `REMOTE_DUELS` is not exactly `1`, and require a session when enabled. Mutation JSON is bounded to 8 KiB and rejects unknown top-level fields. Actor, guild, display name and user identity come from the session, never a request body.

| Method and route | Input | Response |
| --- | --- | --- |
| `POST /api/remote` | `{gameId:'ygo',seatCount:2|3|4}` | `201 RemoteRoom`, creator seat 0. |
| `GET /api/remote?scope=mine|open` | default mine | `{tables:RemoteTable[]}`; max 100. Open means unfilled lobbies. |
| `POST /api/remote/[slug]/seat` | `{seat?:0|1|2|3}`; omitted seat selects first available | `RemoteRoom`. Repeated join by same user returns their existing seat. |
| `POST /api/remote/[slug]/leave` | none | `RemoteTable`. Lobby only. |
| `POST /api/remote/[slug]/ready` | `{ready:boolean}` | `RemoteRoom`. Lobby only. |
| `POST /api/remote/[slug]/start` | none | `RemoteRoom`. Creator only; all seats ready. |
| `GET /api/remote/[slug]` | optional `?afterSeq=N` | `RemoteRoom`: table metadata + `mySeat`, `state`, `events`. |
| `POST /api/remote/[slug]/actions` | `{baseSeq:number,action:RemoteAction}` | `RemoteRoom`. No separate actor/seat override. |
| `GET /api/remote/[slug]/connection` | no query parameters | `{token,guildId,seat,expiresAt}`; seated, unexpired table only; 503 if WS secret missing. |
| `POST /api/remote/[slug]/livekit` | none | Stub: 503 `LIVEKIT_UNAVAILABLE` if any required LIVEKIT var is missing; otherwise 503 `LIVEKIT_NOT_IMPLEMENTED`. Video worker fills this route. |

`RemoteRoom` includes table fields, `seats`, `mySeat`, `state`, and recent `events`. Default recent history is the latest 50 events. `afterSeq` returns up to 200 events in ascending order; page until caught up. The state and `lastSeq` are always the latest snapshot, even if event pagination lags. Use the last *returned event's* seq to page history, not snapshot `lastSeq`. Every lifecycle event also advances `lastSeq`.

Errors: `{error,code?}` with 400 malformed/action failure, 401 missing session, 403 actor/turn/owner refusal, 404 missing guild-scoped table or nonmember read, 409 lifecycle/seat/sequence conflict, 503 unavailable provider. `STALE_SEQUENCE` means fetch current state and reconsider the action; do not blindly replay a phase/turn intent. For transport failure, retry the same body/key. The server never accepts stale `baseSeq` for a new action.

## WebSocket contract

Socket.IO uses the existing ws process and `NEXT_PUBLIC_WS_URL` (or same origin behind the existing proxy). Set `REMOTE_DUELS=1` on **both web and ws**.

- Room: `remote:{guildId}:{slug}`. Browser never chooses the room by untrusted IDs.
- Token: HMAC using purpose-derived key **`remote-room`** from `WS_INTERNAL_SECRET`. Claims `{slug,guildId,userId,seat,expiresAt}`, strict shape, max 5-minute minted TTL. Separate from `duel-room`; neither token opens the other's room.
- `remote:join {token}` → ack `{ok:true}` or `{ok:false,error}`. Rechecks exact persisted seat/user/guild. Renew by joining again with fresh credentials before expiry, and on reconnect. One remote room per socket.
- `remote:leave` has no payload. Disconnect/leave clears membership/expiry timer.
- `remote:subscription-expired {slug}` removes an expired/revoked subscription. Obtain fresh credentials only if still seated.
- `remote:changed {table:RemoteTable,state:RemoteState,events:RemoteEvent[]}` sends authoritative snapshots with the latest 50 events. All operations and idle transitions publish. Ignore an older `table.lastSeq`; deduplicate events by seq/id. Fetch/paginate after reconnect or a gap. The final ended snapshot goes to existing members too; new credentials are not issued for ended tables.
- Internal update: signed `POST /internal/remote/changed {guildId,slug}` under the existing **`ws-broadcast`** signature purpose, 60-second signature window and 64-KiB body cap. WS reads its own DB snapshot and prunes revoked/expired recipients *before* emission. It never trusts caller-supplied state. HTTP mutations commit before publishing; failed publication leaves the committed action intact and logs a warning. Polling/reconnect GET recovers missed delivery.

The MVP follows the existing single-WS-process room pattern. It does not add a Redis adapter; multiple WS instances require the deployment's shared room/pubsub adapter before scaling out.

## Recognition data messages

`RemoteDataMessage` and `remoteDataMessageSchema` are browser-safe. The future LiveKit adapter may carry the same typed messages on its data channel. The foundation exposes a Socket.IO fallback:

```ts
socket.emit('remote:data', {
  type: 'recognition.request', feedOwnerSeat: 1,
  x: 0.42, y: 0.65, requestId: crypto.randomUUID()
}, ack);
// Only feedOwnerSeat receives this request and runs recognition on its raw local feed.
socket.emit('remote:data', {
  type: 'recognition.result', requestId,
  candidates: [{cardId: 89631139, name: 'Blue-Eyes White Dragon', score: 0.91}]
}, ack);
```

Normalized coordinates and scores are finite in `[0,1]`. Request IDs max 100 chars. At most five candidates, each name max 200 chars. Zero candidates means no match. Inbound message max 8 KiB; accepted-message cooldown 100 ms per **user/table** (shared across tabs), ack on refusal `{ok:false,error,retryAfterMs?}`. `remote:data` outbound is `{slug,fromSeat,message}` with server-bound sender seat. Requests route to connected sockets of the indicated seat only. Results broadcast to current authorized room members only, must match a request within 10 seconds, and must come from the requested feed owner; first result wins. Pending cap: 128 requests per room. Requests never leave their guild/table. No images/audio/SDP, no model calls, and no persistence. An accepted result is a suggestion; selection emits `card.identified` through the normal action endpoint. Data/presence/connection renewal does not renew table activity.

## Idle closure and deployment

With the flag enabled the ws process sweeps every 30 seconds, including once at startup. `idle.warning` appends once per idle period at 8 minutes; its `closesAt` is `last_event_at + 600000`. Warning does **not** advance `last_event_at`. At 10 minutes the table ends with `end_reason='idle'`. A real lobby/game action clears warning and renews activity; duplicate actions/ready/join retries, GETs, room joins, recognition data and Socket.IO heartbeat never do. New mutations/credentials are refused at the 10-minute threshold even before the next sweep. Actual background close delivery can lag by up to 30 seconds. The ws process must be running for timed warning/close delivery.

Remote tables never enter engine `duels`/`drafts`. `scripts/deployment/check-prod-activity.py` was inspected and remains unchanged: it queries only those existing tables, so remote calls cannot hold a deploy.

## Environment and local use

| Variable | Where / default |
| --- | --- |
| `REMOTE_DUELS=1` | Web and ws. Off by default (`0` in `.env.example` and Compose). Gates UI/nav/API/room registration/sweep. |
| `DATABASE_PATH` | Web and ws; **same absolute path** recommended. Web migrates automatically; ws never creates/migrates DB. Use a worktree-local file for local work. |
| `DISCORD_GUILD_ID` | Web configured data scope. |
| `WS_INTERNAL_SECRET` | Same secret in web/ws; derives remote-room tokens and signed internal broadcast. |
| `WS_INTERNAL_URL` | Web → ws internal HTTP, local `http://127.0.0.1:4002`. |
| `WS_INTERNAL_PORT` | Ws internal listener, default 4002. |
| `WS_PORT` | Ws Socket.IO listener, default 3001. |
| `WEB_URL` | Ws allowed origin, local `http://localhost:3000`. |
| `NEXT_PUBLIC_WS_URL` | Browser ws URL, local `http://localhost:3001`; unset behind same-origin proxy. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Web only, reserved video provider config. Never send API secret to browser. Stub always 503 until video worker implements minting. |
| existing Clerk config | Existing sign-in flow; or repository's explicitly enabled offline E2E session for local smoke tests. |

From the new worktree, using separate terminals with the same exported environment:

```sh
cd /home/sulman633/repos/yugioh-bot/.worktrees/remote-duels
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
npm ci
npm run build --workspace=packages/shared
export REMOTE_DUELS=1
export DATABASE_PATH="$PWD/data/remote-local.sqlite"
export DISCORD_GUILD_ID=local-remote
export WS_INTERNAL_SECRET=local-remote-change-me
export WS_INTERNAL_URL=http://127.0.0.1:4002
export WEB_URL=http://localhost:3000
export NEXT_PUBLIC_WS_URL=http://localhost:3001
npm run dev:web
# In another terminal, export the same values, then:
npm run dev:ws
```

Web opens/migrates the DB before ws can read it; if ws starts first it retries on subsequent joins/sweeps. Sign in with two or more existing local test accounts in separate browser profiles, visit `/duels/remote`, create a table, join, ready all seats and start. LP/phase changes appear in every room's raw JSON. No duel engine, bot, LiveKit, STT or recognition model is needed to prove the loop. The worktree's ignored `.env` (ws) and `packages/web/.env.local` (web) contain the local flag only; exports above configure both processes.
