# Remote Duels contract

Remote Duels track physical games without running ocgcore or resolving effects or battle damage. Saved decks are checked against the table's format; live deck checks are assistive and require explicit recognition or simultaneous public evidence. The module supports Advanced, Domain, Genesys and Genesys Domain with 2-player play and 3/4-player FFA. The owner MVP spec takes precedence over the earlier engine/app design report (LiveKit, 2–4 seats, and `lobby|active|ended`).

## Imports and ownership

- Browser-safe types, schemas, registry and reducer: `@yugidraft/shared/remote` (`packages/shared/src/remote/`). No Node, database, media or engine dependencies.
- Server service: `createRemoteDuelService(db)` from `@yugidraft/shared/services` (`packages/shared/src/services/remote-duels.ts`).
- Room token helpers: `@yugidraft/shared/ws` (`remote-token.ts`). Server only.
- UI: `packages/web/src/components/remote/remote-workbench.tsx` and adjacent seat, command and local-camera components. Keep the HTTP/action/event contract when replacing the UI.
- Video extension: `POST /api/remote/[slug]/livekit`. Solo uses local webcam preview; multiplayer mints seated, guild-scoped LiveKit credentials. See [video runbook](video.md). Speech uses optional browser SpeechRecognition with a typed-command fallback. Recognition uses on-demand browser OCR and the existing card catalog; `RemoteDataMessage` remains the remote recognition relay extension.

`GameModule` exposes `id`, `name`, `phases`, `seatsAllowed: readonly (2|3|4)[]`, `resources`, `zones`, `initialState`, `reduce(state, action, context?)`, `resolveAttack(state, input, actorSeat)` and `parseCommand(input): RemoteActionProposal | null` (the action union without key/time). Register additional modules in `remoteGames`. Game rules live in the module; transport and membership stay generic. Resource values are `state.seats[seat].resources[id]`. Phase/zone identifiers are strings owned by the module.

## Identity, seats and lifecycle

All HTTP operations use the existing `requireWebAccess()` session guard and configured `DISCORD_GUILD_ID`, matching current duel access. Application `users.id` is the remote identity; it is neither a Discord snowflake nor `players.id`. The current app has no separate Discord membership gate. Do not introduce a Discord REST lookup. The server checks that the command's actor seat equals the session user's stored remote seat, or is a persisted bot belonging to that user's own solo table.

Seats are **zero-based**, fixed in clockwise order. The creator occupies seat 0. A signed-in user can list open lobbies and join an available seat in the configured guild. Only seated users can read state/events or mint media/room credentials; there are no spectators. Open-list responses contain table metadata and seats with deck registrations stripped, never game state/events. This foundation uses open guild lobbies; private invites and ranked results are outside this contract.

Players select a valid saved deck before readying; only the creator starts after every seat is occupied, ready and valid. Solo permits an omitted deck. Seat 0 starts. Lobby guests can leave and free their seat; creator departure ends the lobby. An active player uses `player.concede`; their membership remains so they can read the result and undo. Tables end on a game winner or idle closure. No Elo, seasons, tournament results, engine workers or engine `duels.kind` writes occur.

## Solo test tables

`create({..., seatCount: 2|3|4, solo: true})` creates one real user at seat 0 and fills seats 1–N with **Test Bot 1**, **Test Bot 2**, **Test Bot 3** as needed. `solo` defaults to false and is immutable. Every `RemoteTable`/`RemoteRoom`/snapshot includes `solo:boolean`; every seat includes `{seat,userId:number|null,bot:boolean,displayName,ready}`. Human seats have `bot:false`; bots have `bot:true`, `userId:null`, and are always ready. No synthetic accounts or user tokens are created. The owner toggles their own readiness and starts normally.

Solo tables are excluded from `scope=open` and reject other users joining (`403 SOLO_OWNER_ONLY`). Reads, actions, tokens, readiness, leave and start still require the real owner's session; knowing a slug grants no access. The owner's own repeated join returns their seat. Room/WS tokens always identify seat 0; bots never get credentials or recognition feeds.

To edit a bot, submit the normal action with **`actorSeat` equal to that bot's seat**. The service verifies `solo`, `createdBy === session.userId` and the persisted bot seat before reducing. Reducer ownership/turn/attack/elimination checks are unchanged: a bot's `twin.*` action must target its own seat; bot phase/turn and attacks must respect its turn. The owner's session remains able to control living bots even if seat 0 is eliminated. Every resulting event stores the owner's real `userId` and the selected bot's `actorSeat`. Replay, sequence checks, idempotent retry, five-second undo, game-end reopening by undo, and idle close use the same code path as multiplayer.

On `/duels/remote`, choose **Solo test** and 2, 3 or 4 seats. The page renders one local webcam preview and static bot feed tiles, with independent LP and editable public board twins. Phase/End turn buttons automatically act as the current living turn seat in solo; **Acting as** selects the seat for commands, attack proposals and concession. Click controls on each board act as that board's seat. Attack proposals offer ranked choices and confirmation; resolution clears the attack and damage remains a separate LP change. Recent events and corrections appear in the event log. Reloading restores all seats and annotations from the DB.

Solo never requests a LiveKit token, joins a media room or sends video over WS. Camera preview uses `getUserMedia({video:{facingMode:'environment'},audio:false})` after **Enable camera**, requiring localhost/HTTPS and browser permission. Stop/unmount releases tracks. All gameplay is usable when the camera or microphone is unavailable; recognition needs an enabled camera.

**Recognize card** captures only the centered portrait guide from the owner's feed. An owned `/remote-ocr-worker.js` host dynamically loads [Tesseract.js](https://github.com/naptha/tesseract.js/blob/master/docs/api.md) 7.0.0 from jsDelivr and reads it locally. Its default worker/WASM/English-language assets download on first use. The worker tree is released on success, startup/scan failure, timeout (60 seconds), Stop camera and navigation, including failures before OCR initialization resolves. Only extracted public passcodes or names are posted to `/api/cards/resolve`; frames are never uploaded or persisted. Name/passcode matching depends on the existing catalog/provider and OCR quality, lighting and framing. Up to five suggestions require explicit **Identify** selection, which submits `card.identified` for the owner's seat through the normal action route. Identification does not automatically place a twin. Bots have no feed to recognize; their twins are populated manually or by commands.

### Command proposals

`parseCommand({text,actorSeat,state})` is a pure bounded grammar in `command-parser.ts`, with no STT or catalog calls. The UI's **Use microphone** fills the command input through the browser's speech service (browser support/permission/network apply); typing uses the identical parser. **Preview command** always precedes confirmation and action submission. A changed table sequence or selected seat disables stale confirmation. Raw speech is never sent to remote APIs or logged; an explicit `note ...` command persists its requested note text.

Supported examples (all act as the selected seat):

- `next phase`, `end turn`, `main 1 phase`, `set phase to battle`.
- `lose 500 LP`, `gain 1000 LP`, `set LP to 8000` (numeric amounts).
- `place Dark Magician in monster slot 3`, `add Blue-Eyes White Dragon to extra monster slot 1`.
- `flip Dark Magician face down`, `flip slot 3 face up`, `move slot 3 to graveyard`, `remove Dark Magician`. Card names/refs/slots must identify exactly one twin on that seat; ambiguous edits return no proposal.
- `identify 89631139`, `resolve attack`, `cancel attack`, `undo`, `concede`, `note agreed correction`.
- Attack phrases described below, including `my dragon attacks Test Bot 1's magician`. The same assistant also supports selecting attacker/target cards by click.

## Deck registration and live checks

The host chooses `format: 'normal'|'domain'|'genesys'|'genesys-domain'`; `normal` is labeled **Advanced**. `normalizeRemoteFormat(format, rules?)` uses shared `normalizeDuelSettings`, the current pinned TCG banlist default for Advanced, no banlist for Domain, and the existing Genesys points/cap normalizer. Deck validation stays enabled. Setup offers the format, existing banlist options, Genesys cap and starting LP. Rules are immutable after start; changing them in the lobby clears human readiness and revalidates selected decks.

`POST .../deck` selects an existing saved deck owned by the session user in this guild. Solo owners may select one of their decks for each bot too. The table snapshots `{savedDeckId,name,deck,validation}`; source-deck edits/deletion do not change the snapshot. Invalid selections remain visible with the full validator's `issues` and deck-editor error messages. Both ready-up and start rerun validation; `DECK_REQUIRED` or `DECK_INVALID` returns 409. Solo permits an omitted deck, but selected decks, including bots', must validate before start.

The canonical validator and compiled banlists live in `packages/shared/src/deck-legality/` (`@yugidraft/shared/deck-legality`); duel-server retains compatibility exports and its existing operational admission policy. Remote uses the same sizes, identity/copy groups, banlists, playable sections, Domain singleton/Deck Master/membership and Genesys points/type checks. Physical tables omit engine-script executability and engine-only operational blocks. Read-only engine card data, strings and Domain script metadata are still needed; **no running duel host or WASM core is needed**. Genesys uses the application's current verified points snapshot and refuses unknown points; see [points sync](../architecture/card-data/genesys-points.md).

`card.identified` always preserves recognition. When absent from that seat's registered list (including proven artwork/name identities), `state.identified` carries `{name?,notInDecklist:true,addErrors:string[]}`. The page shows **Not in decklist** and one **Add to decklist** action. The service constructs a candidate in the correct Main/Extra section and reruns the full validator. A failing addition returns its reasons with no event/deck mutation; recognition and play remain available. Successful `deck.add` edits only the table snapshot and logs “Sulman added Ash Blossom to their decklist” for every seated player. Undo restores state and seat columns together.

`state.deckChecks` contains normalized `format`, per-seat `registrations`, physical `instances` and `flags`. Repeated scans never accumulate lifetime copy counts:

- A known twin ref moves/flips the same instance. Moving to hand/deck, removing a twin, or turning it face down hides it; later sightings reuse a hidden instance before creating another. Replacing a hidden/same-place tile removes the stale alias.
- Cross-event proof requires another known copy to remain in a public **twin** location with no intervening logged move. Public locations include field rows, GY, banished, face-up Extra and Pendulum. An unlocated scan or old untwinned scan supplies no independent anchor. Overlapping coordinates cannot prove two places.
- `cards.identified` represents **one frame/batch of distinct physical detections**, never OCR candidate alternatives or observations assembled across time. Each detection needs a unique `observationId`; optional zone/slot/ref adds location evidence. Hand reveals can prove simultaneous copies inside this batch, then become hidden. A one-card batch reuses the existing instance. Referenced scans use the twin's actual position and visibility, and only its owner can attach recognition.
- Only proven concurrent copies beyond the selected limit create “Deck no longer valid” flags. Domain/Genesys Domain allow 1; Advanced uses its banlist limit or 3; Genesys uses 3. A forbidden card needs one recognized copy. Each flag includes instance IDs, count, limit and proof, e.g. “2 copies of Ash Blossom seen at the same time: field zone 2 and GY.” Flags **never** prevent LP, phases, attacks or other duel actions.
- Any living player can `deck.flag.dismiss` with a reason; the owner can `twin.merge` two same-card instances with a reason. Both are logged and replayable. Merge removes the duplicate tile and dismisses proof involving the removed instance. Dismissed proof is not repeated for the same instance set. Unknown catalog/identity data produces no inferred violation.

Pure browser-safe exports in `shared/remote`: `normalizeRemoteFormat`, `initialDeckChecks`, `applyRemoteFormat`, `isInRemoteDeck`, `proposeRemoteDeckAddition` (with an injected deterministic full-validator callback), `observeRemoteCard` (returns new checks and instance), `remotePhysicalSlot`, `remoteLocationsDistinct`, `flagRemoteCopies` and `applyLiveDeckChecks`. None reads a clock, catalog, database or network, or mutates its inputs. `game.reduce(state, action, context?)` accepts server-resolved `RemoteReductionContext` facts and validated registrations. The service persists facts beside the original command so replay never consults a newer banlist/points/catalog. Context is forbidden in client action bodies.

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
| `card.identified` | `seat`, `cardId` and/or `passcode`, optional `name,zone,slot,cardRef`, `source: 'click'|'auto'|'voice'|'typed'` | Public recognition, badge/add verdict and assistive proof. Referenced twin edits require its owner. |
| `cards.identified` | `seat,source,cards` (1–20 sightings, each with identification fields and unique `observationId`) | One simultaneous frame/batch. Last detection is shown by the minimal UI. |
| `deck.add` | `seat,cardId` | Owner adds one copy to the table deck; full validation required. |
| `deck.flag.dismiss` | `flagId,reason` | Log a correction and dismiss proof without stopping play. |
| `twin.merge` | `seat,keepInstanceId,removeInstanceId,reason` | Owner merges two same-card instances and removes the duplicate tile. |
| `twin.place` | `seat`, `zone`, `card` | Field owner only. `card: {ref, cardId?, passcode?, name?, race?, slot?, faceUp?:true, position?:'attack'|'defense'}`; instance ref is unique within the seat. Defaults: face-up, attack. Public `name` is 1–200 trimmed chars, `race` 1–40; optional integer `slot` is 1–5. |
| `twin.move` | `seat`, `zone`, `cardRef`, optional `slot` | Owner moves an existing instance. An explicit slot replaces its old slot; omitting it preserves the slot within the same zone and clears it when changing zones. |
| `twin.flip` | `seat`, `cardRef`, `faceUp` | Owner sets face visibility. |
| `twin.remove` | `seat`, `cardRef` | Owner removes the instance. |
| `log.note` | `text` (1–500 chars) | Shared note; also the explicit “Still playing” action. |
| `undo` | `targetActionId` | Any seated user can undo the latest reversible action within **5000 ms inclusive**, including an elimination/winning action. |
| `player.concede` | none | Eliminates the actor; last living seat wins. |

Undo restores a bounded pre-action game position; it never deletes events. All board-changing actions replace the undo slot; `log.note` preserves it. Undo clears the slot and cannot itself be undone. A newer board-changing action makes older actions unavailable. Only `undo` may reopen a game-ended table; idle/creator closures cannot reopen. Idempotent retries do not renew the undo window. Logs remain visible after undo so readers see the correction.

Yu-Gi-Oh phase IDs: `draw`, `standby`, `main1`, `battle`, `main2`, `end`. Display names: Draw, Standby, Main 1, Battle, Main 2, End. LP starts at the configured value (default 8000) independently for each seat. Zone IDs: `monster`, `spell-trap`, `extra-monster`, `field`, `graveyard`, `banished`, `hand`, `deck`, `extra`, `pendulum`, `hand-reveal`. Hand/deck annotations are hidden instance locations, never private hand contents or deck order. Twins are optional **public** field annotations, max 100 instances per seat, not an authoritative inventory. Do not put private hands, Deck order, face-down identities or unannounced cards into them. The UI must omit private card IDs when placing face-down cards; the server does not maintain private views.

Relevant rules from [ADR 0002](../adr/0002-multiplayer-duel-rules.md): clockwise order and fixed seats (`R-FFA-ORDER`); 2-player turn 1 skips Battle; in FFA Battle opens when the last currently living duelist starts their first turn (`R-FFA-NO-ATTACK`), accounting for early elimination. Zero LP and concession eliminate; future turns skip that seat; last living seat wins. If the turn player leaves, remaining living players may advance the remaining phases/end that turn, preserving fixed seats. Normal effects/response windows remain physical, with no chain simulation. Standard MR5's first player skips their first draw (`R-FFA-FIRST-DRAW`), a physical instruction, not an automatic card change. An opponent monster/direct target follows `R-FFA-ATTACK`; because the twin is optional, physical monster presence and direct-attack legality are agreed by the players rather than inferred from missing twin cards.

## Tolerant voice attack resolution

`resolveAttack` is exported from `@yugidraft/shared/remote` and installed as `getRemoteGame('ygo').resolveAttack`. It is a pure, deterministic, browser-safe function in `packages/shared/src/remote/attack-resolver.ts`, with no clock, I/O, catalog, engine or speech-model calls. It accepts current `RemoteState`, a raw utterance string or `AttackHints`, and the authenticated actor seat:

```ts
import { getRemoteGame } from '@yugidraft/shared/remote';

const game = getRemoteGame(room.gameId);
const result = game.resolveAttack(room.state, {
  text: "attack Imran's dragon",
  players: room.seats.map(player => ({
    seat: player.seat, displayName: player.displayName,
    nicknames: player.seat === 1 ? ['Immy'] : [],
  })),
}, room.mySeat);

// Parsed speech workers can bypass sentence parsing:
const parsed = game.resolveAttack(room.state, {
  attacker: { text: 'Blue Eyes' },
  target: { text: 'dragon', slot: 5 }, targetSeat: 1,
}, room.mySeat);
```

`AttackHints` has optional `text`, `attacker`, `target`, `targetSeat`, `targetPlayer`, `direct` and `players`. Each card hint accepts `text`, `cardRef`, `slot`, and `side: 'left'|'middle'|'right'`. Raw utterance fragments and parsed text hints must both fit; explicit ref, slot, side, player and seat constraints are also combined. Conflicting hints return no match, and an empty parsed text cannot erase spoken constraints. `players` is transient `{seat, displayName, nicknames?: readonly string[]}[]` context from the current room; it is required for named-player phrases, and is never copied into game state or events. Display-name words (for example “Imran” from “Imran Khan”) and complete nicknames match without regard to case, punctuation or accents. Shared names/nicknames retain all matching seats. Possessives identify owners in monster-target speech; bare card words stay card words even if a player has the same name. Bare names can select a player for an explicit direct attack, or use `targetPlayer` in parsed hints.

The result is `{status: 'unique'|'ambiguous'|'none', candidates: AttackCandidate[]}`. Each candidate contains `score` in `[0,1]`, a typed `proposal` for `attack.declare` (with actor, attacker/target seats and card refs, without key/time), `attacker` and optional `target` display metadata `{seat, cardRef, name?, race?, zone, slot?}`. Direct proposals omit `target` and have `direct:true`. Candidates sort by descending score, then target seat, attacker ref and target ref for stable ties. Scores are matching weights, not probabilities. Every fitting attacker/target pair remains available, even when one scores higher. `unique` means exactly one pair; `ambiguous` means at least two; `none` means an empty candidate list.

Matching uses only the actor's and living opponents' `monster`/`extra-monster` twins. It excludes graveyard, banished, spell/trap and field-zone annotations, self targets, eliminated seats, invalid actors and ended games. Optional public `name`/`race` metadata must be supplied on `twin.place` by the caller that already knows the card; numeric IDs alone cannot supply names without a catalog. Old twins without these annotations still support generic, slot and explicit-ref selection. As with public card IDs, omit private names/races on face-down cards. Face-down name/race annotations never participate in matching or returned display labels.

- **Partial, fuzzy and phonetic names:** case/accents/punctuation are folded; each meaningful query word must match a name or race word. Exact words, prefixes of at least three characters, Soundex-style phonetic matches (including “blew”/“blue” and “ice”/“eyes”), and spelling similarity of at least 65% with adjacent-transposition support are accepted. Full exact names rank above partial names; exact word matches rank above prefix, phonetic and typo matches. Race words such as “dragon”, “spellcaster” and “warrior” work even when absent from the printed name. “Magician” also matches card-name words.
- **Ownership:** attackers always come from the actor's field. “Imran's dragon”/“Immy's dragon” constrain the target to matching current player context. “My dragon attacks his/her/their monster” considers living opponents; a sole matching monster gives one pair if the attacker is also unique. FFA pronouns do not invent a target seat. Unspecified attackers, as in “attack Imran's dragon”, include every fitting monster on the actor's field.
- **Position:** slots are one-based, fixed from each field owner's view; they are never inferred from array order or renumbered around gaps. In the main monster row, “left”/“middle”/“right” mean slots 1/3/5. In the extra monster row, left/right mean 1/2 and there is no middle slot. “Zone 1” through “zone 5” (also spoken one–five or “slot”) constrain the public slot. “Extra monster” explicitly selects that row. Missing slots or conflicting position hints do not match.
- **Direct attacks:** only explicit `direct:true` or “directly”/“direct attack” speech produces a direct proposal. An empty opponent twin never implies a direct attack; physical legality is still agreed at the table.

The speech/UI adapter shows a **quick pick** for `ambiguous`, then confirmation of the chosen proposal; `unique` offers **one-tap confirm**. Only a confirmed proposal gets a new `idempotencyKey` and is submitted through the existing action endpoint with the current `baseSeq`. The resolver never executes or persists anything. Turn/phase rules and authoritative validation still run in `reduce`/the service; resolve again after a board update or `STALE_SEQUENCE`. Keep the raw utterance and nickname context in memory; events contain only the confirmed action.

## Persistence and service

Additive, rerunnable migration in `packages/shared/src/db/schema.ts`:

| Table | Columns and invariants |
| --- | --- |
| `remote_tables` | `id`, unique `slug`, `guild_id`, `game_id`, `seat_count` (2/3/4), `status` (lobby/active/ended), `created_by` → users, `state_json`, `last_seq`, `created_at`, `started_at`, `ended_at`, `last_event_at`, `idle_warning_at`, `end_reason` (game/idle/creator-left), `solo` (0/1, default 0). All timestamps integer epoch ms. |
| `remote_seats` | `table_id`, `seat`, `user_id` → users, `display_name`, `ready`. PK `(table_id,seat)`; unique `(table_id,user_id)`. |
| `remote_bot_seats` | `table_id` → remote_tables, `seat` (1–3), `display_name`; PK `(table_id,seat)`. No user column/FK. Always-ready bots are unioned with human seats when reading the public contract. |
| `remote_events` | increasing storage `id`, `table_id`, contiguous `seq`, `idempotency_key`, nullable `actor_seat`, nullable `user_id`, `action_json`, `created_at`. Unique `(table_id,seq)` and `(table_id,idempotency_key)`. UPDATE/DELETE triggers enforce append-only. |

`remote_tables.state_json` caches the game state. `service.replay(slug,guildId,userId)` reconstructs it from initial state and gameplay events. Lifecycle metadata/seats are materialized transactionally; their system events remain in the same log. Game state can have `ended:false` when the *table* ended from idle or lobby departure: table status is authoritative for lifecycle.

The solo migration adds `remote_tables.solo` and creates `remote_bot_seats`. The deck migration adds nullable `remote_tables.format_json`, `saved_deck_id`/`deck_json` on both seat tables, and nullable `effects_json`/`messages_json` on events. No rows or old events are rebuilt or rewritten; migrations are safe to rerun. Old rows default to Advanced and no registered deck. Historical source-deck IDs have no saved-deck FK, so deleting a source cannot destroy a table snapshot. Human-seat NOT NULL user FKs and account history remain intact.

Service methods: `create`, `configure`, `selectDeck`, `join`, `leave`, `ready`, `start`, `get`, `list`, `act`, `replay`, `sweepIdle`; `snapshot` is a trusted internal transport read with **no** viewer authorization and must never be exposed through an unguarded route. The exported TypeScript signatures are the source for argument details. Mutations run in one `BEGIN IMMEDIATE` transaction: load guild/slug, verify identity, check sequence, reduce, append event, update cache and timestamps. An invalid action rolls back entirely. Duplicate gameplay keys return current state only when the same authenticated user submits the same command (client `at` excluded). Different contents/user give `409 IDEMPOTENCY_CONFLICT`. Duplicate lookup precedes the sequence/lifecycle check, so a lost response can be retried safely even after later actions or game end.

System actions: `table.created {gameId,seatCount,solo?:boolean,format?}`, `table.configured {format,registrations}`, `seat.deck {seat,registration}`, `seat.joined {seat,userId:number|null,bot?:boolean}`, `seat.left {seat,userId}`, `seat.ready {seat,ready}`, `table.started`, `idle.warning {closesAt}`, `table.ended {reason:'idle'|'creator-left'}`. Old events may omit solo/bot flags. Bot creation emits `seat.joined` with null user and `bot:true`, attributed to the owner. System event IDs start `sys:` and cannot be submitted as gameplay actions. Join events deliberately contain no personal-name snapshot; names are read from seats. Remote references count as account history, and account deletion anonymizes seat names while preserving event history and IDs.

`RemoteEvent = {id,seq,actorSeat,userId,at,action,effects?,messages?}`; `id` equals the idempotency key, not the integer storage ID. All event history is public to the table. `effects_json` stores authoritative validation/card facts. `messages_json` stores `{seat,text}` templates without copied player names; `messages` resolves current seat names when read, preserving account anonymization and the append-only log. Do not store audio, video, frames or raw speech transcripts; voice workers emit parsed actions only.

## HTTP routes

All responses use `Cache-Control: private, no-store`. All routes return 404 when `REMOTE_DUELS` is not exactly `1`, and require a session when enabled. Mutation JSON is bounded to 8 KiB and rejects unknown top-level fields. Actor, guild, display name and user identity come from the session, never a request body.

| Method and route | Input | Response |
| --- | --- | --- |
| `POST /api/remote` | `{gameId:'ygo',seatCount:2|3|4,solo?:boolean,format?:string,rules?:Partial<DuelSettings>}` | `201 RemoteRoom`, creator seat 0; solo fills the remaining seats with bots. Nonboolean solo is rejected. |
| `GET /api/remote?scope=mine|open` | default mine | `{tables:RemoteTable[]}`; max 100. Open means unfilled lobbies. |
| `POST /api/remote/[slug]/seat` | `{seat?:0|1|2|3}`; omitted seat selects first available | `RemoteRoom`. Repeated join by same user returns their existing seat. |
| `POST /api/remote/[slug]/leave` | none | `RemoteTable`. Lobby only. |
| `POST /api/remote/[slug]/format` | `{format,rules?}` | `RemoteRoom`. Host only, lobby only; clear readiness and revalidate decks. |
| `POST /api/remote/[slug]/deck` | `{savedDeckId:number|null,seat?:number}` | `RemoteRoom`. Lobby only; owned saved-deck selection; solo owner may target a bot. |
| `POST /api/remote/[slug]/ready` | `{ready:boolean}` | `RemoteRoom`. Lobby only. |
| `POST /api/remote/[slug]/start` | none | `RemoteRoom`. Creator only; all seats ready. |
| `GET /api/remote/[slug]` | optional `?afterSeq=N` | `RemoteRoom`: table metadata + `mySeat`, `state`, `events`. |
| `POST /api/remote/[slug]/actions` | `{baseSeq:number,action:RemoteAction}` | `RemoteRoom`. `action.actorSeat` must match the session seat or a persisted bot of the session owner's solo table. No separate identity override. |
| `GET /api/remote/[slug]/connection` | no query parameters | `{token,guildId,seat,expiresAt}`; seated, unexpired table only; 503 if WS secret missing. |
| `POST /api/remote/[slug]/livekit` | none | Solo: `200 {mode:'solo',required:false,code:'SOLO_LOCAL_PREVIEW',message}` with no token, independent of LIVEKIT configuration. Multiplayer: `200 {url,token,room,seat}`, five-minute token for `remote-{slug}`, authenticated `users.id` identity and immutable guild/table/seat metadata; camera/mic/data publishing and subscribe-all in that room. 503 `LIVEKIT_UNAVAILABLE` if any required LIVEKIT var is missing. Ended/expired tables are refused. |

`RemoteRoom` includes table fields, normalized `format`, `seats` (with registered `deck` snapshots), `mySeat`, `state`, and recent `events`. Default recent history is the latest 50 events. `afterSeq` returns up to 200 events in ascending order; page until caught up. The state and `lastSeq` are always the latest snapshot, even if event pagination lags. Use the last *returned event's* seq to page history, not snapshot `lastSeq`. Every lifecycle event also advances `lastSeq`.

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

`RemoteDataMessage` and `remoteDataMessageSchema` are browser-safe. The LiveKit adapter carries these messages on its reliable data channel (owner-targeted requests, broadcast results); see [video runbook](video.md) for correlation announcements and client-validation limits. The foundation exposes a Socket.IO fallback:

```ts
socket.emit('remote:data', {
  type: 'recognition.request', feedOwnerSeat: 1,
  x: 0.42, y: 0.65, requestId: crypto.randomUUID()
}, ack);
// Only feedOwnerSeat receives this request and runs recognition on its raw local feed.
socket.emit('remote:data', {
  type: 'recognition.result', requestId,
  candidates: [{cardId: 89631139, name: 'Blue-Eyes White Dragon', score: 0.91}],
  tier: 'sure',        // 'sure' | 'not sure' | 'low match', from the owner's reader
  faceDown: false,     // a card back: candidates are empty
  covered: false,      // the card is partly hidden: never auto-confirm
}, ack);
```

Normalized coordinates and scores are finite in `[0,1]`. Request IDs max 100 chars. At most five candidates, each name max 200 chars. Zero candidates means no match. Inbound message max 8 KiB; accepted-message cooldown 100 ms per **user/table** (shared across tabs), ack on refusal `{ok:false,error,retryAfterMs?}`. `remote:data` outbound is `{slug,fromSeat,message}` with server-bound sender seat. Requests route to connected sockets of the indicated seat only. Results broadcast to current authorized room members only, must match a request within 10 seconds, and must come from the requested feed owner; first result wins. Pending cap: 128 requests per room. Requests never leave their guild/table. No images/audio/SDP, no model calls, and no persistence. An accepted result is a suggestion; selection emits `card.identified` through the normal action endpoint. Data/presence/connection renewal does not renew table activity.

## Idle closure and deployment

With the flag enabled the ws process sweeps every 30 seconds, including once at startup. `idle.warning` appends once per idle period at 8 minutes; its `closesAt` is `last_event_at + 600000`. Warning does **not** advance `last_event_at`. At 10 minutes the table ends with `end_reason='idle'`. A real lobby/game action clears warning and renews activity; duplicate actions/ready/join retries, GETs, room joins, recognition data and Socket.IO heartbeat never do. New mutations/credentials are refused at the 10-minute threshold even before the next sweep. Actual background close delivery can lag by up to 30 seconds. The ws process must be running for timed warning/close delivery.

Remote tables, including active solo tables, never enter engine `duels`/`drafts`. `scripts/deployment/check-prod-activity.py` remains unchanged: it queries only those existing tables, so remote calls cannot hold a deploy. Solo uses the same idle warning/closure deadlines and requires the ws sweep process for timed delivery.

## Environment and local use

| Variable | Where / default |
| --- | --- |
| `REMOTE_DUELS=1` | Web and ws. Off by default (`0` in `.env.example` and Compose). Gates UI/nav/API/room registration/sweep. |
| `DUEL_DATA_DIR` | Web read-only card bundle (`cards.cdb`, `strings.conf`, `card-scripts`). Uses the existing deck data-directory resolver if omitted. Needed for selected-deck validation and live identity/banlist facts; not a running engine. |
| `DATABASE_PATH` | Web and ws; **same absolute path** recommended. Web migrates automatically; ws never creates/migrates DB. Use a worktree-local file for local work. |
| `DISCORD_GUILD_ID` | Web configured data scope. |
| `WS_INTERNAL_SECRET` | Same secret in web/ws; derives remote-room tokens and signed internal broadcast. |
| `WS_INTERNAL_URL` | Web → ws internal HTTP, local `http://127.0.0.1:4002`. |
| `WS_INTERNAL_PORT` | Ws internal listener, default 4002. |
| `WS_PORT` | Ws Socket.IO listener, default 3001. |
| `WEB_URL` | Ws allowed origin, local `http://localhost:3000`. |
| `NEXT_PUBLIC_WS_URL` | Browser ws URL, local `http://localhost:3001`; unset behind same-origin proxy. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Web only, multiplayer video provider config. Never needed for solo. Local: `ws://127.0.0.1:7880`, `devkey`, `secret`; or a Cloud URL and project credentials. See [video runbook](video.md). |
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

Web opens/migrates the DB before ws can read it; if ws starts first it retries on subsequent joins/sweeps. For solo, sign in with one existing local account, visit `/duels/remote`, select **Solo test** and 2/3/4 seats, create, toggle ready, and start. Enable the webcam when desired; bots remain static. Populate both twins, end turns through the opening round, choose Battle, then preview/confirm an attack against a bot monster. Test bot LP, voice/typed edits, notes and undo in the same page. No engine, autonomous bot service, LiveKit config or second account is needed. OCR downloads assets on first scan; speech capture depends on browser support, with typed commands always available.

For multiplayer, use two or more accounts/browser profiles, choose the format, create a table, join, select a saved deck at each seat, resolve every validation error, ready and start. In solo, deck selection is optional; chosen decks still must validate. Use a populated read-only DUEL_DATA_DIR and current application Genesys points for deck checks. With a registered deck, recognize an unlisted card to see its badge/add action; place distinct copies in separate public zones to see proof, dismissal and merge controls. LP/phase changes appear in each room. The worktree's ignored `.env` (ws) and `packages/web/.env.local` (web) contain the local flag only; exports above configure both processes.

## Targeted validation

Use Node 22 and build shared before the web/ws/duel-server tests. Run Vitest directly with explicit paths; the duel-server npm test script includes its whole test directory.

| Workspace | Explicit test files / filter | Passed |
| --- | --- | --- |
| shared | `tests/remote/remote-duels.integration.test.ts`, `tests/services/account-deletion.test.ts`, `tests/services/users-linking.test.ts`, `tests/services/user-history.test.ts`, `tests/ws/duel-token.test.ts` | 182 (92 remote integration) |
| web | `tests/remote-deck-controls.test.tsx`, `tests/remote-solo-controls.test.tsx`, `tests/remote-room-ordering.test.tsx`, `tests/remote-recognition.test.ts`, `tests/duel-actor-auth.test.ts` | 55 |
| ws | `tests/duel-events.test.ts`, `tests/internal-http.test.ts` with `-t remote` | 2 |
| duel-server | `tests/deck-legality-domain-text.test.ts`, `tests/card-block-list-admission.test.ts` | 159 |

Total: **398 targeted tests**, plus shared/web/ws/duel-server typechecks and shared build. The remote integration fixture supplies its own private card database and scripts; no running engine, network points sync, or application data writes are needed. Coverage includes bounce/replay, GY/revive, simultaneous field/GY copies, hand batches, ambiguous/overlapping coordinates, hidden reuse/reveal, banned/limited cards, full Domain/Genesys validation, deck edits and undo, migration, ownership/privacy, account anonymization and replay. Generated shared build output and web typecheck cache are removed after verification.
