# Remote Duels contract

Remote Duels track physical games without running ocgcore or resolving effects or battle damage. Saved decks are checked against the table's format; live deck checks are assistive and require explicit recognition or simultaneous public evidence. The module supports Advanced, Domain, Genesys and Genesys Domain with 2-player play and 3/4-player FFA. The owner MVP spec takes precedence over the earlier engine/app design report (LiveKit, 2–4 seats, and `lobby|active|ended`).

## Imports and ownership

- Browser-safe types, schemas, registry and reducer: `@yugidraft/shared/remote` (`packages/shared/src/remote/`). No Node, database, media or engine dependencies.
- Server service: `createRemoteDuelService(db)` from `@yugidraft/shared/services` (`packages/shared/src/services/remote-duels.ts`).
- Room token helpers: `@yugidraft/shared/ws` (`remote-token.ts`). Server only.
- UI: `packages/web/src/components/remote/ui/table.tsx` and adjacent seat, command and camera components. Keep the HTTP/action/event contract when replacing the UI.
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

Create the table on the normal create screen: **Duels → Create game → Play: Remote Duel** (or `/duels/new?type=remote`). Pick the duel type (Standard or Domain, with the Genesys toggle), seats 1v1, 3-way or 4-way, a deck, **Solo test** and the **Cards Set from Deck** rule, then **Create room**. `/duels/remote` and the Remote Duels section of `/duels` only list and join tables; the create screen changes the address with the Play mode. A solo table renders one local webcam preview and static bot feed tiles, with independent LP and editable public board twins. Phase/End turn buttons automatically act as the current living turn seat in solo; **Acting as** selects the seat for commands, attack proposals and concession. Click controls on each board act as that board's seat. Attack proposals offer ranked choices and confirmation; resolution clears the attack and damage remains a separate LP change. Recent events and corrections appear in the event log. Reloading restores all seats and annotations from the DB.

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

Yu-Gi-Oh phase IDs: `draw`, `standby`, `main1`, `battle`, `main2`, `end`. Display names: Draw, Standby, Main 1, Battle, Main 2, End. LP starts at the configured value (default 8000) independently for each seat. Zone IDs: `monster`, `spell-trap`, `extra-monster`, `field`, `graveyard`, `banished`, `hand`, `deck`, `extra`, `pendulum`, `hand-reveal`. Twins are optional field annotations, max 100 instances per seat, not an authoritative inventory or Deck order. The server retains controller-only identities for private hand/face-down annotations and projects them per viewer. Deck and Extra Deck identities are redacted; ordinary face-down cards remain private. Effect-selected identities follow the default-on Deck publicity option described below. Candidate lists and unannounced strict-table choices remain controller-only across HTTP, WS, replay and undo.

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

## Effect sources, face-down cards and searches

The host sets **Cards Set from Deck are shown to all** (`showCardsSetFromDeck:boolean`, default **true**) in the create form or lobby Rules. The same option controls cards searched from Deck to hand. It is a separate table option, independent of format/banlist rules; changing it is host-only, lobby-only, and clears human readiness. **ON:** the chosen or shown identity is public. **OFF:** strict tables retain private choices and explicit reveals/announcements. Candidate lists remain controller-only in both modes. Ordinary face-down cards do not become public.

`effect.activated {source:{cardId?,cardRef?,name?}}` is a normal sequenced, idempotent action. The service resolves the actual catalog name/passcode and logs that public source. The shared speech parser accepts **I activate X**, **activate X**, and **activate** after identification. Card details on a controlled twin or identified feed card expose **Activate**; a chosen face-down card also exposes **Activate chosen card**, which reveals its source publicly.

The server reads the existing `createInsightCatalog` data: `card_tags` effect-search events (`set_spell_trap` / `add_to_hand`, Deck origin, controller/either player), plus the EDOPro `cards.cdb` text, type bits, Level, attribute, race and setcode memberships. It reuses the existing `CardFilter` representation and `filterReachesCard` matcher. Indexed add-then-Set actions inherit the Deck-search filter. Printed text fills clear missing facets: quoted archetypes/names, Spell/Trap, Normal/Continuous/Quick-Play/Field/Equip/Counter, Level ranges, attribute and exact monster race; exclusions and a same-name banish-then-Set copy requirement are also read. There is no new Lua execution, model call or per-card allowlist.

A recognized Deck-to-Set effect opens one private context for that seat. The next face-down field placement, move or face-down flip consumes it and adds the public `setBy` source to the twin. Another activation at the same seat replaces the context; phase/turn change, elimination, **Clear effect**, or two minutes of action time expire it. The screen offers **Set face-down** for the next empty row slot. Existing ordinary manual actions still work.

Only the controller receives `state.effectTracking.contexts` and the origin's `pool`, `candidates`, `eligibleIds`, `chosenCardId`, and copy requirements. Candidate identities come exclusively from the registered **Main Deck** (never Side/Extra), grouped by canonical artwork identity. Concurrent public physical instances, including identified face-down Sets and announced searched hand cards, are subtracted; an exhausted name disappears. Separate resolved searches preserve distinct physical copies, including same-name cards in hand. Trap Trick additionally requires two remaining copies of a name at activation; after a public banish cost, the remaining same-name copy stays eligible for the Set. If an action is recognizable but its target filter is unclear, the assistive fallback is all matching types (all Spell/Trap for an unknown Set). Multiple possible effects are suggestions; costs, opponent choices, random selection and complicated conditions remain physical table decisions.

With the option ON, the controller picks one candidate or uses **Identify shown card** for a ref-linked camera/manual read. All players receive that card's identity and the face-down twin is labelled **Face-down · Set from Deck by <source>: <card>**. Identity knowledge is independent of physical orientation: `publicIdentity:true` is server-authored, and `faceUp:false` is preserved. The origin exposes `announcedCard:{cardId,name}` for that chosen identity only. Before a choice, and with the option OFF until reveal, opponents receive **Face-down · Set by <source>**, public location/ref and the source only. HTTP responses, event pages, list responses, replay, undo-before states and WS room broadcasts remove other seats' registrations, candidate lists, hidden identities, recognition metadata and private warning proofs. Private event actions become neutral log placeholders; server replay still uses the original persisted action and facts. Previously public event information remains public. Historical private event payloads stay private, including events recorded before this option existed; migrating a table does not reveal old choices on unrelated actions. Event-time rule snapshots preserve old camera/reveal semantics during replay. Returning a card to Deck or Extra Deck hides its current twin identity. Solo's real owner controls its bot seats as well.

Click a face-down twin or a detected face-down card on your feed to open the private one-click candidate picker. If several tracked Sets exist, choose the physical slot in the picker. A pick renders the twin dimmed with its face-down label. With the option ON, the identity is immediately shared while the card remains face-down. With the option OFF, only the controller sees the picked identity; **Reveal chosen card**, **Activate chosen card**, or a ref-linked camera identification publishes it by turning it face-up. A unique camera match to a privately chosen Set reuses that ref, including **Read board**, only when no matching public twin already exists. Whole-frame reads consume each ref once and never reuse a single-card target across the frame; ambiguous or unexpected cards need **Identify shown card** (ON) or **Identify revealed card** (OFF) on the intended Set, then a camera read or manual name selection. This avoids inventing a second physical twin or attaching an uncertain read to another hidden card.

Each origin keeps the eligible list from its creation so revealing a copy does not invalidate itself. If the chosen/shown/revealed identity was outside that list, all seats see a soft **<card> could not be Set by <source>** note. The identification succeeds, including a public table's face-down identification. Any player may **Dismiss note**. Batch notes have distinct IDs and replay/undo follow normal action semantics.

Deck-to-hand effects immediately create a search entry with controller-only candidates. With the option ON, **Choose searched card** publishes only the chosen identity automatically; **Identify shown card** can instead create a blank hand ref and attach a camera/manual identification to the same physical card. All seats receive the chosen hand identity and **<card> added to hand by <source>**. With the option OFF, the choice and hand twin remain private; searches recommend announcing the physical reveal unless text explicitly says otherwise, and **Announce searched card** remains a separate controller action. Until that action, even recognition of the private hand ref stays private. Explicit announcement exposes `announcedCard:{cardId,name}` and its source. Off-candidate shown searches also produce soft **<card> could not be added to hand by <source>** notes. Peer camera requests use no private deck/twin priors and never return private fallback guesses.

Additional actions: `effect.choose {originId,cardId}`, `effect.announce {originId}`, `effect.context.clear {}`, `effect.note.dismiss {noteId}`. They carry the usual actor/key/server time, use existing owner/sequence guards, and persist in existing JSON state/events. Only the table option needs an additive SQL column. Choices/announcements require the origin's controller; all effects remain assistive.

### Reproducible sample deck and candidate lists

The existing remote integration fixture registers this 40-card Main Deck (no Extra/Side): Trap Trick ×1, Trap Tracks ×1, Lilith, Lady of Lament ×1, Terraforming ×1, Reinforcement of the Army ×1, Torrential Tribute ×2, Reckless Greed ×2, Infinite Impermanence ×1, Call of the Haunted ×1, Mystical Space Typhoon ×1, Book of Moon ×1, Necrovalley ×1, Chicken Game ×1, Marauding Captain ×1, Junk Synchron ×1, Blue-Eyes White Dragon ×1, Dark Magician ×3, Breaker the Magical Warrior ×3, Skilled Dark Magician ×3, Apprentice Magician ×3, Old Vindictive Magician ×3, Effect Veiler ×3, Magician of Faith ×2, Summoner Monk ×2. Printed metadata/text are fixture data copied from the existing read-only EDOPro catalog; the test needs no installed engine or network.

With no public copies yet accounted for, these real sources produce exactly:

| Source | Derived target | Private candidates |
| --- | --- | --- |
| Trap Tracks | Normal Trap, except itself | Infinite Impermanence ×1; Reckless Greed ×2; Torrential Tribute ×2; Trap Trick ×1 |
| Lilith, Lady of Lament | Normal Trap from Deck | Infinite Impermanence ×1; Reckless Greed ×2; Torrential Tribute ×2; Trap Tracks ×1; Trap Trick ×1 |
| Trap Trick | Normal Trap except itself; two remaining copies for banish + same-name Set | Reckless Greed ×2; Torrential Tribute ×2 |
| Terraforming | Field Spell from Deck to hand | Necrovalley ×1; Chicken Game ×1 |
| Reinforcement of the Army | Level 4 or lower Warrior from Deck to hand | Marauding Captain ×1; Junk Synchron ×1 |

The suite also anchors both Torrential Tributes in public zones and verifies their removal from the next Set candidates. Call of the Haunted (Continuous Trap), Mystical Space Typhoon / Book of Moon (Quick-Play Spells), higher-Level monsters and Spellcasters are excluded by the appropriate filters.

## Persistence and service

Additive, rerunnable migration in `packages/shared/src/db/schema.ts`:

| Table | Columns and invariants |
| --- | --- |
| `remote_tables` | `id`, unique `slug`, `guild_id`, `game_id`, `seat_count` (2/3/4), `status` (lobby/active/ended), `created_by` → users, `state_json`, `last_seq`, `created_at`, `started_at`, `ended_at`, `last_event_at`, `idle_warning_at`, `end_reason` (game/idle/creator-left), `solo` (0/1, default 0), `show_cards_set_from_deck` (0/1, NOT NULL, default 1). All timestamps integer epoch ms. |
| `remote_seats` | `table_id`, `seat`, `user_id` → users, `display_name`, `ready`. PK `(table_id,seat)`; unique `(table_id,user_id)`. |
| `remote_bot_seats` | `table_id` → remote_tables, `seat` (1–3), `display_name`; PK `(table_id,seat)`. No user column/FK. Always-ready bots are unioned with human seats when reading the public contract. |
| `remote_events` | increasing storage `id`, `table_id`, contiguous `seq`, `idempotency_key`, nullable `actor_seat`, nullable `user_id`, `action_json`, `created_at`. Unique `(table_id,seq)` and `(table_id,idempotency_key)`. UPDATE/DELETE triggers enforce append-only. |

`remote_tables.state_json` caches the game state. `service.replay(slug,guildId,userId)` reconstructs it from initial state and gameplay events. Lifecycle metadata/seats are materialized transactionally; their system events remain in the same log. Game state can have `ended:false` when the *table* ended from idle or lobby departure: table status is authoritative for lifecycle.

The solo migration adds `remote_tables.solo` and creates `remote_bot_seats`. The deck migration adds nullable `remote_tables.format_json`, `saved_deck_id`/`deck_json` on both seat tables, and nullable `effects_json`/`messages_json` on events. No rows or old events are rebuilt or rewritten; migrations are safe to rerun. Old rows default to Advanced and no registered deck. The Deck publicity migration adds `remote_tables.show_cards_set_from_deck INTEGER NOT NULL DEFAULT 1 CHECK (... IN (0,1))` without rebuilding rows or rewriting state/events. New actions persist `effects.showCardsSetFromDeck` as the event-time rule and public choice events carry `effects.publicEffectChoice`; these replay inputs remain server-only. Pre-option actions replay with strict semantics; current state and undo projections report the current table rule. Historical source-deck IDs have no saved-deck FK, so deleting a source cannot destroy a table snapshot. Human-seat NOT NULL user FKs and account history remain intact.

Service methods: `create`, `configure`, `selectDeck`, `join`, `leave`, `ready`, `start`, `get`, `list`, `act`, `replay`, `sweepIdle`; `snapshot(slug,guildId)` is a trusted internal transport read of the public projection with **no** viewer admission guard and must never be exposed through an unguarded route. `snapshot(slug,guildId,userId)` verifies membership and includes only that user's controlled seats. `replay` also returns the requesting user's projection. The exported TypeScript signatures are the source for argument details. Mutations run in one `BEGIN IMMEDIATE` transaction: load guild/slug, verify identity, check sequence, reduce, append event, update cache and timestamps. An invalid action rolls back entirely. Duplicate gameplay keys return current state only when the same authenticated user submits the same command (client `at` excluded). Different contents/user give `409 IDEMPOTENCY_CONFLICT`. Duplicate lookup precedes the sequence/lifecycle check, so a lost response can be retried safely even after later actions or game end.

System actions: `table.created {gameId,seatCount,solo?:boolean,format?,showCardsSetFromDeck?:boolean}`, `table.configured {format,registrations,showCardsSetFromDeck?:boolean}`, `seat.deck {seat,registration}`, `seat.joined {seat,userId:number|null,bot?:boolean}`, `seat.left {seat,userId}`, `seat.ready {seat,ready}`, `table.started`, `idle.warning {closesAt}`, `table.ended {reason:'idle'|'creator-left'}`. Old events may omit solo/bot flags. Bot creation emits `seat.joined` with null user and `bot:true`, attributed to the owner. System event IDs start `sys:` and cannot be submitted as gameplay actions. Join events deliberately contain no personal-name snapshot; names are read from seats. Remote references count as account history, and account deletion anonymizes seat names while preserving event history and IDs.

`RemoteEvent = {id,seq,actorSeat,userId,at,action,effects?,messages?}`; `id` equals the idempotency key, not the integer storage ID. Stored event history is authoritative and server-only. Viewer projections redact private commands and registrations while preserving event IDs and sequence numbers. `effects_json` stores authoritative validation/card facts. `messages_json` stores `{seat,text}` templates without copied player names; `messages` resolves current seat names when read, preserving account anonymization and the append-only log. Do not store audio, video, frames or raw speech transcripts; voice workers emit parsed actions only.

## HTTP routes

All responses use `Cache-Control: private, no-store`. All routes return 404 when `REMOTE_DUELS` is not exactly `1`, and require a session when enabled. Mutation JSON is bounded to 8 KiB and rejects unknown top-level fields. Actor, guild, display name and user identity come from the session, never a request body.

| Method and route | Input | Response |
| --- | --- | --- |
| `POST /api/remote` | `{gameId:'ygo',seatCount:2|3|4,solo?:boolean,format?:string,rules?:Partial<DuelSettings>,showCardsSetFromDeck?:boolean}` | `201 RemoteRoom`, creator seat 0; solo fills the remaining seats with bots. Nonboolean solo or showCardsSetFromDeck is rejected; omitted publicity defaults ON. |
| `GET /api/remote?scope=mine|open` | default mine | `{tables:RemoteTable[]}`; max 100. Open means unfilled lobbies. |
| `POST /api/remote/[slug]/seat` | `{seat?:0|1|2|3}`; omitted seat selects first available | `RemoteRoom`. Repeated join by same user returns their existing seat. |
| `POST /api/remote/[slug]/leave` | none | `RemoteTable`. Lobby only. |
| `POST /api/remote/[slug]/format` | `{format,rules?,showCardsSetFromDeck?:boolean}` | `RemoteRoom`. Host only, lobby only; clear readiness and revalidate decks. Omitted publicity retains the current setting; nonboolean values are rejected. |
| `POST /api/remote/[slug]/deck` | `{savedDeckId:number|null,seat?:number}` | `RemoteRoom`. Lobby only; owned saved-deck selection; solo owner may target a bot. |
| `POST /api/remote/[slug]/ready` | `{ready:boolean}` | `RemoteRoom`. Lobby only. |
| `POST /api/remote/[slug]/start` | none | `RemoteRoom`. Creator only; all seats ready. |
| `GET /api/remote/[slug]` | optional `?afterSeq=N` | `RemoteRoom`: table metadata + `mySeat`, `state`, `events`. |
| `POST /api/remote/[slug]/actions` | `{baseSeq:number,action:RemoteAction}` | `RemoteRoom`. `action.actorSeat` must match the session seat or a persisted bot of the session owner's solo table. No separate identity override. |
| `GET /api/remote/[slug]/connection` | no query parameters | `{token,guildId,seat,expiresAt}`; seated, unexpired table only; 503 if WS secret missing. |
| `POST /api/remote/[slug]/livekit` | none | Solo: `200 {mode:'solo',required:false,code:'SOLO_LOCAL_PREVIEW',message}` with no token, independent of LIVEKIT configuration. Multiplayer: `200 {url,token,room,seat}`, five-minute token for `remote-{slug}`, authenticated `users.id` identity and immutable guild/table/seat metadata; camera/mic/data publishing and subscribe-all in that room. 503 `LIVEKIT_UNAVAILABLE` if any required LIVEKIT var is missing. Ended/expired tables are refused. |

`RemoteRoom` includes table fields, normalized `format`, defaulted `showCardsSetFromDeck:boolean`, `seats`, `mySeat`, viewer-projected `state`, and recent `events`. Only controlled seats include registered `deck` snapshots; other seats expose `deckRegistered:boolean`. List responses strip every deck. Default recent history is the latest 50 events. `afterSeq` returns up to 200 events in ascending order; page until caught up. The state and `lastSeq` are always the latest snapshot, even if event pagination lags. Use the last *returned event's* seq to page history, not snapshot `lastSeq`. Every lifecycle event also advances `lastSeq`.

Errors: `{error,code?}` with 400 malformed/action failure, 401 missing session, 403 actor/turn/owner refusal, 404 missing guild-scoped table or nonmember read, 409 lifecycle/seat/sequence conflict, 503 unavailable provider. `STALE_SEQUENCE` means fetch current state and reconsider the action; do not blindly replay a phase/turn intent. For transport failure, retry the same body/key. The server never accepts stale `baseSeq` for a new action.

## WebSocket contract

Socket.IO uses the existing ws process and `NEXT_PUBLIC_WS_URL` (or same origin behind the existing proxy). Set `REMOTE_DUELS=1` on **both web and ws**.

- Room: `remote:{guildId}:{slug}`. Browser never chooses the room by untrusted IDs.
- Token: HMAC using purpose-derived key **`remote-room`** from `WS_INTERNAL_SECRET`. Claims `{slug,guildId,userId,seat,expiresAt}`, strict shape, max 5-minute minted TTL. Separate from `duel-room`; neither token opens the other's room.
- `remote:join {token}` → ack `{ok:true}` or `{ok:false,error}`. Rechecks exact persisted seat/user/guild. Renew by joining again with fresh credentials before expiry, and on reconnect. One remote room per socket.
- `remote:leave` has no payload. Disconnect/leave clears membership/expiry timer.
- `remote:subscription-expired {slug}` removes an expired/revoked subscription. Obtain fresh credentials only if still seated.
- `remote:changed {table:RemoteTable,state:RemoteState,events:RemoteEvent[]}` broadcasts only the public projection with the latest 50 events. All operations and idle transitions publish. Ignore an older `table.lastSeq`; deduplicate events by seq/id. Fetch/paginate after reconnect or a gap. The final ended snapshot goes to existing members too; new credentials are not issued for ended tables.
- `remote:private` has the same envelope and is sent directly to each authenticated socket after a membership recheck, never to the Socket.IO room. It contains only that user's controlled seats' private data. Public change notifications trigger a viewer-authorized HTTP revalidation; private snapshots can update immediately. A public snapshot must never replace a private client snapshot.
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

Web opens/migrates the DB before ws can read it; if ws starts first it retries on subsequent joins/sweeps. For solo, sign in with one existing local account, go to **Duels → Create game → Play: Remote Duel**, select **Solo test** and 2/3/4 seats, click **Create room**, toggle ready, and start. Enable the webcam when desired; bots remain static. Populate both twins, end turns through the opening round, choose Battle, then preview/confirm an attack against a bot monster. Test bot LP, voice/typed edits, notes and undo in the same page. No engine, autonomous bot service, LiveKit config or second account is needed. OCR downloads assets on first scan; speech capture depends on browser support, with typed commands always available.

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


### Initial private-origin validation (2026-11-01)

Node 22.23.3: shared build; shared/web/ws/e2e typechecks; **202 shared tests** (112 remote plus 90 related identity/token tests), **14 web tests**, **3 remote WS tests**, and **4 Playwright tests**. The existing remote integration, recognition, socket and e2e files contain all new cases. The two added browser cases cover pick/reveal/mismatch dismissal and separate controller/opponent browsers for Set privacy and hand announcement. Existing phase/undo and 3/4-seat layout cases also pass.

The remote-ui harness owns a small catalog, registered decks and SQLite file under its ignored stack directory. It needs no engine or card API. For an isolated run, build shared first, then from `packages/e2e` use `E2E_WEB_PORT=3360 E2E_WS_PORT=3362 E2E_WS_INTERNAL_PORT=4362 NEXT_PUBLIC_REMOTE_STT_URL=ws://127.0.0.1:4920/ws LIVEKIT_URL=ws://127.0.0.1:7890 npx playwright test -c playwright.remote-ui.config.ts -g 'phase rail|3-way and 4-way|private Set candidate|two browsers'`. No media service is needed for these cases. Stop the harness before rebuilding shared; if Next's dev manifest cache was interrupted, clear only this worktree's `packages/web/.next` before restarting. Generated artifacts remain untracked.


### Deck publicity revision validation (2026-11-01)

Node 22.23.3, after the owner change: **350 Vitest tests** and **6 Playwright tests** pass. Shared build and shared/web/ws/e2e typechecks pass. The independent review checked privacy boundaries and compared complete legacy reducer states against the original implementation; its compatibility findings are covered by regressions.

| Workspace | Explicit test files | Passed |
| --- | --- | --- |
| shared | `tests/remote/remote-duels.integration.test.ts` | 129 |
| shared | `tests/services/account-deletion.test.ts`, `tests/services/users-linking.test.ts`, `tests/services/user-history.test.ts`, `tests/ws/duel-token.test.ts` | 90 |
| web | `tests/duel-actor-auth.test.ts`, `tests/remote-recognition.test.ts`, `tests/remote-video.test.ts`, `tests/remote-vision-ai-route.test.ts` | 92 |
| ws | `tests/duel-events.test.ts`, `tests/internal-http.test.ts` | 39 |

New remote cases cover default-on/strict creation and configuration, additive rerunnable migration, public face-down choices without candidate leakage, searches to hand in both modes, shown-card identification and off-candidate notes, public-copy depletion, repeated same-name searches, Extra Deck privacy, and pre-option private choices/camera reads/hand announcements/Extra Deck replay. Browser coverage includes 1v1 phase/LP/undo/drawers, 3/4-seat layouts, strict pick/reveal/mismatch dismissal, separate controller/opponent browsers for **both** modes, and create/lobby setting persistence plus readiness reset.

After building shared, run the browser cases from `packages/e2e` with:

```bash
E2E_WEB_PORT=3456 E2E_WS_PORT=3457 E2E_WS_INTERNAL_PORT=4457 \
NEXT_PUBLIC_REMOTE_STT_URL=ws://localhost:4458/ws LIVEKIT_URL=ws://127.0.0.1:4459 \
E2E_NEXT_DIST_DIR=.next-deck-publicity \
npx playwright test -c playwright.remote-ui.config.ts \
  --grep '1v1 table|3-way and 4-way|private Set|two browsers|create and lobby'
```

The harness owns only its isolated web/WS processes and fixture SQLite/catalog; these cases need no media services or engine. Reserved ports and the main checkout are untouched. After stopping the harness, remove generated shared build output, web build/typecheck caches and the ignored remote-ui stack directory. No PR or attribution lines are added; commits are pushed to `feat/remote-facedown`.

## Phone field cameras and handheld scans

A seated desktop may pair a phone in the lobby or table with **Use phone as camera**. `POST /api/remote/[slug]/phone` requires the normal desktop session and returns a local QR URL `/duels/remote/[slug]/cam?pair=<token>`, an eight-character short code and `expiresAt`. Pair tokens use the existing derived-key HMAC token format with purpose `remote-phone-pair`, 128-bit random ID, immutable `{slug,guildId,userId,seat}` and a **five-minute** expiry. Short codes use 40 random bits, are stored as SHA-256 hashes and share the same expiry/one-use row. Redemption is a single conditional SQLite update, so simultaneous QR/code requests have one winner. GET/link previews do not consume it. Re-pair atomically revokes the previous invitation/device for that owner.

The camera shell is outside the authenticated app layout. Only that GET path and `POST .../phone/connect` bypass session middleware. The latter accepts exactly one of `{pair}`, `{code}`, `{device}`, with an 8-KiB body cap. Pair/code attempts are throttled to 30 per table/client bucket per five minutes; a trusted reverse proxy must sanitize forwarding headers. Invalid, expired, replayed, wrong-table and revoked credentials return the same 401. No game, catalog, socket-room or controller endpoint accepts these capabilities.

Successful redemption returns a separate `remote-phone-device` capability, bound to the same pair/table/user/seat, held in phone **sessionStorage** for at most 12 hours. The query token is removed from browser history. The device capability can renew only camera credentials, checking persisted revocation, membership, seat, table status and idle age every time. The phone checks every 20 seconds and renews before terminal reconnect. Reloading resumes the device and camera/scan mode within the same browser session; scan controls wait for a desktop ready acknowledgment. The page sends no camera frames to HTTP or storage.

LiveKit identity is `remote-phone-{pairId}`, with immutable signed metadata `{role:'field-phone',pairId,guildId,tableId,userId,seat}`. Its 30-second join JWT has `canPublish:true`, `canPublishSources:['camera']`, `canPublishData:true`, **`canSubscribe:false`**, `canUpdateOwnMetadata:false`, and no admin/game/voice grants. The phone publishes one `field-cam` track with audio disabled. LiveKit source grants do not express a hard per-source track count; the app publishes and accepts one camera. All table subscribers opt out of auto-subscription and subscribe only to allowed sources from current roster identities; phone identity validation additionally requires the current active pair ID from the authenticated roster.

`DELETE .../phone` revokes the desktop owner's invitation/device, clears publication permissions and removes that participant. SQLite triggers revoke in the same transaction as seat departure or table end, so leave/rejoin cannot revive a capability. Durable pending cleanup retries SFU failures; the web process also sweeps idle/expired devices every 15 seconds. The removal request supplies `revokeTokenTs` for providers supporting a cutoff. **Pinned LiveKit OSS 1.13.11 ignores that cutoff**: a captured/refreshed media JWT may attempt a later SFU join. Trusted clients reject the revoked pair ID (including its media/data) and the janitor removes rejoined revoked identities. This is application revocation plus active removal, not a claim of an OSS cryptographic JWT denylist. Hostile-client admission revocation needs provider support; see [LiveKit removal source](https://github.com/livekit/livekit/blob/v1.13.11/pkg/service/roommanager.go) and [token grants](https://docs.livekit.io/frontends/reference/tokens-grants/).

### Phone recognition path

The phone is the raw feed owner, but **the signed-in desktop of that seat runs recognition**. It joins LiveKit without `getUserMedia`, including in solo tables when a phone is selected. The original local-only solo webcam path remains available otherwise.

1. Any seated browser clicks that phone seat's field. The existing `recognition.request` goes to the owner's **desktop** identity `remote-user-{userId}`, never to an arbitrary participant sharing the seat. Phone-backed requests allow 60 seconds for desktop model/index cold start; webcam requests retain the existing ten-second deadline. OSS can omit new data-only participants from the SDK participant cache: in that case the SFU-authenticated sender identity is matched exactly against the current HTTP seat/pair roster. Message JSON never identifies its own sender.
2. The desktop prewarms the local recognizer when the table opens and when the phone selection changes: `warmup()` initializes the worker, index and model sessions without a camera permission request. Live phone reads start at **pointerdown**, bypassing redundant local detection on the compressed desktop preview; keyboard activation still works and the later click does not request a second still. The normalized point is relative to the displayed video content, excluding letterboxing, and reaches the phone unchanged.
3. In field-camera mode the phone keeps **one second / at most six native-resolution ImageBitmaps**, sampled about every 200 ms. On request it scores a cheap **64×64 Laplacian** near the requested video point and selects the sharpest available frame without waiting for a new burst. It encodes only a native-resolution crop plus context (85% of the shorter sensor side in each direction; scan framing is taller), clamped to the sensor edges, as JPEG at quality 0.9. Pixel detail is retained: only the quality sample is downscaled. Large/partially visible cards can exceed that window; reframing or using the existing frozen-frame tools is still needed in that case.
4. The selected JPEG is sent **only to the owner's desktop** as reliable 10,000-character chunks. Transfers allow one pending frame, 20 seconds, at most 150 chunks / 1.5M base64 characters and 1920×1080 pixels (portrait equivalent allowed). The desktop checks current phone identity, correlation, chunk metadata and JPEG SOF dimensions **before decode**, and drops late/cancelled/revoked results. No continuous still transfer or image server upload occurs.
5. Crop metadata includes integer offsets and original sensor dimensions. The desktop rejects inconsistent/out-of-bounds crops, checks that the requested point lies inside, and maps it into JPEG coordinates with `(point * sourceSize - offset) / cropSize`, including at sensor edges. Older uncropped stills retain the original normalized point. The desktop runs the existing `@yugidraft/vision` worker with its deck/seen priors, then broadcasts up to five public name/ID/similarity guesses using the existing result channel. The clicker uses the normal recognition tray. If the clicker already has a frozen still, its existing local outline/peek/board-read tools can read that still there. Those local tools do not make the phone run inference.

Timing diagnostics are browser-local CustomEvents, containing durations/quality/coordinates/size but no pixels, device capabilities or card identities. `remote-recognizer-warmup` reports initialization duration and success. `remote-phone-capture` reports selection/camera-start (`captureMs`), immediate JPEG/base64 encoding (`encodeMs`), chunk publication (`sendMs`), selected frame age, scores and crop geometry. `remote-phone-read` reports desktop request enqueue, those phone capture/encode durations, transport, bounded JPEG decode, recognition and total request-to-result time. Transport is the remaining desktop capture interval after subtracting measured phone work and request enqueue; it includes both network legs, reliable chunk publication and scheduling. It is **not a one-way wire latency** and assumes no synchronized device clocks. Recognition includes any remaining initialization and worker queue wait. UI-observed timings can be longer than the request-to-result event. A first read after table-open prewarming is reported separately from startup duration; it is not an uninitialized-worker inference.

The phone needs neither models nor WASM inference. Optional phone-local recognition is not implemented. Desktop recognition uses the existing vision asset installation/gate; missing assets produce the established manual/decklist fallback, not fabricated recognition. See [vision setup](../../packages/vision/README.md).

### Scan and manual modes

**Scan mode** stops live publication and releases camera capture and the frame ring between scans. Its next request starts the camera and uses the available frame(s) immediately; it has no preexisting one-second buffer and does not wait 500 ms to collect a burst. The phone offers M1–M5, S1–S5, FZ, GY, banished and hand reveal. **Scan card** sends a zone + ID to the owner desktop, which solicits the same sharpest-available cropped still and reads it. The desktop displays five guesses and a confirmation; no game action is emitted before selection. Choosing a card submits `card.identified` and `twin.place` for that seat through the normal authenticated action endpoint. Stable `phone:{scanId}:identify` / `phone:{scanId}:place` idempotency keys make retries safe. Scan requests, previews and pixels are ephemeral; only the accepted public identification/twin actions enter the game log. The phone cannot submit actions itself. Only one scan/confirmation remains open; cancel, owner disconnect, deadlines, roster changes and disposal stop late work.

The seat shows **Phone camera · connected** or **Scan mode**. Opponents follow the twin and log while live video is off. Phone hardware controls are best effort: rear camera preference, available lens labels (including ultra-wide), 1080p preference, torch, manual focus/exposure, wake lock and battery status depend on the browser/device. Quality meters only advise on light/detail; distance/heat are hints, not measured sensors. Backgrounded/locked phones can lose capture and must return to this page.

**No camera (manual)** is an explicit persisted seat mode. LP, phases, undo, typing, desktop voice where available, and public twin editing work without camera permission. Phone LP/phase/undo controls and phone voice/STT are follow-ups; the phone capability is not extended to game or voice access.

### Measured phone latency (2026-11-01)

Local Chromium + isolated LiveKit 1.13.11, real-photo 1920×1080 fixture with alternating blur. Field measurements throttle **both phone and desktop pages 4×**. Scan measurements throttle the phone 4× with desktop inference unchanged, matching the earlier scan proof. The field crop is 918×918, 72,501–73,404 JPEG bytes; scan mode uses its taller crop. Five field reads and three camera-restarting scans were verified.

| Stage (ms) | Field first | Field warm (4) | Scan first | Scan warm (2) |
| --- | ---: | ---: | ---: | ---: |
| Request enqueue | 3.8 | 1.1–4.9 | 0.2 | 0.1–0.1 |
| Capture/select | 24.0 | 12.9–25.4 | 59.3 | 48.7–62.5 |
| JPEG/base64 encode | 19.2 | 15.8–22.5 | 18.3 | 19.9–22.3 |
| Transport residual | 27.4 | 15.9–49.1 | 29.3 | 18.6–31.4 |
| Decode | 31.0 | 17.4–22.5 | 15.3 | 8.9–12.6 |
| Recognize | 522.9 | 349.3–903.2 | 670.4 | 566.6–662.9 |
| Request to result | 628.7 | 437.1–972.5 | 792.9 | 681.8–773.0 |
| UI result / confirmation | 635.2 | 440.7–976.7 | 1354 | 929–1025 |

**Measured read targets met:** first <3000 ms and all warm <1200 ms. “First” means the first read after table-open prewarming overlapped pairing. Fresh worker/model/index initialization itself was **12,846.9 ms** (13,768.9 ms in the previous verified field run); it is not a <3-second initialization claim. A click before prewarm completes can still wait for initialization, and that case is not established to meet the cold target.

Field UI latency is measured by a DOM MutationObserver from pointerdown; the separate Playwright observation includes polling/backoff (one 1478-ms observation corresponded to a result already rendered at 977 ms). Scan UI times are the polling-observed confirmation bounds. Transport is the combined residual defined above, not independent one-way network latency. The full step records, previous verified run, comparable baseline and target outcomes are in `data/briefs/remote-duels/phone-shots/timings.json` in the coordinator checkout; scan details are also in `scan-mode-timings.json`. No WAN/mobile-hardware guarantee is implied by this local fixture.

Verification: all seven phone integration cases, then the final pointer/DOM timing regression; 30 targeted vision checks, 13 transport/recognition checks, 92 shared remote integration checks, and vision/web typechecks. The media proof covers unsigned-in pairing, no desktop camera, actual card recognition, exactly-once twin confirmation, another player’s click, re-pair/reconnect/revoke, invalid/expired capabilities, and manual mode. The protected LiveKit instance on 7880–7882 was untouched; tests use their own 7890–7892 instance.
