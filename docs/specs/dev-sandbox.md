# Dev sandbox: design spec

Status: draft for owner review. Base: `engine-local` (origin/main + recent work), 2026-10-05.
Paths are relative to the repo root. `ds/` = `packages/duel-server/src`, `sh/` = `packages/shared/src`, `web/` = `packages/web`.

## 0. Goal and scope

An admin builds any board (per seat: LP, hand, Main/Extra Monster Zones, S/T Zones, Field, Pendulum, GY, banished,
Deck top + size, Extra Deck, Deck Master in Domain), then starts it in 1v1, ffa3, ffa4 or Tag. Bots auto-pass by
default. The admin can act for any seat at any time. Boards save by name (guild scope) and share by link. A running
sandbox duel has Restart (same seed + same board).

Reuse, do not fork: `BoardSpec` + `compileBoard` (`ds/presets/board.ts:79-240`), `resolveCard` (`ds/presets/catalog.ts:66`),
scripted bot with empty rules = pass (`ds/scripted-bot.ts:84-112`, `defaultAnswer`), practice bot, `startPreset`
(`ds/host.ts:1452-1530`) as the template for start, `card-query`/`card-facets` ops, `CardBrowser`/`CardFilters`
(`web/src/components/decks/card-browser.tsx:44`, `card-filters.tsx:281`), the duel room (`web/src/components/duel/room.tsx`).

Out of scope: counters, equip links, "this turn" flags (summoned/activated this turn), free Lua.

## 1. Data model

### 1.1 New table `sandbox_scenarios` (migration in `sh/db/schema.ts`, new `db.exec` block, `create ... if not exists`)

| column | type | rule |
|---|---|---|
| id | integer pk autoincrement | |
| guild_id | text not null | every query filters by guild |
| owner_player_id | integer not null references players(id) | same id space as `duels.organizer_player_id` |
| name | text not null | 1-80 chars, trimmed |
| format | text not null | `1v1`/`ffa3`/`ffa4`/`tag` (copy of board.format, for the list) |
| mode | text not null | `normal`/`domain` (copy, for the list) |
| board_json | text not null | `SandboxBoard`, max 32 KiB serialized |
| run_json | text not null | `SandboxRun`, max 1 KiB |
| created_at, updated_at | text default current_timestamp | |

Index: `(guild_id, updated_at)`. Limit: 200 scenarios per owner per guild (service check, 409).

### 1.2 `SandboxBoard` and `SandboxRun` (new `sh/duels/sandbox-board.ts`, exported from `sh/duels/index.ts`)

- `SandboxBoard` = JSON-only subset of `BoardSpec`: every card ref is a **number** (passcode). No `teams`, no
  `withoutCoreFunctions` (parser rejects them). Added fields: `startAt?: "draw" | "main1"` (default `main1`).
- `SandboxRun` = `{ bots: Record<"1"|"2"|"3", "pass"|"practice"|"manual">, seed?: [string,string,string,string] }`.
  Seat 0 is always the admin (manual).
- `parseSandboxBoard(unknown): SandboxBoard` throws `SandboxBoardError { path, message }`. Structure only, no catalog.
  Limits per seat: hand <= 20, monsters <= 7 (index 5-6 = EMZ, Master Rule >= 4 only), spells <= 5, pendulum <= 2,
  grave <= 60, banished <= 60, deck top <= 60, `deckSize` 0-60 and >= deck top, extra <= 30, Xyz materials <= 10,
  LP integer 1-999999. Seats outside the format are rejected. Tag: LP only on p0/p1 (team LP). Domain: every seat
  needs `deckMaster`. Turn player must be a seat of the format.
- This parser runs in web (before save and start) and in duel-server (before compile). One rule source.

### 1.3 Duel rows

- `duels.sandbox integer not null default 0` via `addColumnIfMissing` (`sh/db/schema.ts`, same style as line 578).
- `DuelSetup.sandbox?: { board: SandboxBoard; run: SandboxRun; scenarioId?: number }` in `sh/services/duels.ts:97`
  (add the key to `parseSetup` and to the allow list in `validateSetup:421`). Recover rebuilds bot modes from it.
- Sandbox duels: `visibility: "private"`, `turnSeconds: 0` (no clock, `sh/duels/settings.ts:102`), `ranked: false`,
  no series, no invite code.

## 2. Server ops (duel host)

New module `ds/sandbox.ts` holds the logic. `ds/host.ts` only wires ops and two small hooks.

| op | input | result | notes |
|---|---|---|---|
| `validate-board` | `board` | `{ ok, errors[], codes[] }` | parse + `resolveCard` per code + `compileBoard`; no engine start |
| `start-sandbox` | `board`, `run`, `scenarioId?` | `{ slug }` | like `startPreset`, board from body |
| `sandbox-control` | `slug`, `seat`, `control` | room | sets one bot seat to `pass`/`practice`/`manual` |
| `sandbox-restart` | `slug` | `{ slug }` | new duel, same board/run/seed; cancels the old one |
| `sandbox-info` | `slug` | `{ board, run, scenarioId }` | for "Back to builder" |
| `view`, `respond`, `surrender` | + `as?: number`, `reveal?: boolean` | as today | sandbox only, organizer only |

### 2.1 start-sandbox

1. `parseSandboxBoard`, then `compileBoard(board, dataDirectory)`. Errors -> 400 with the compiler message.
2. Same gates as `startPreset`: `multiplayerSeatsBlockReason`, `multiCoreAvailable`, Domain multi-seat via `multiStartProblem`.
3. `service.create({ ..., sandbox: true, settings: { ...compiled.settings, turnSeconds: 0, visibility: "private" } })`.
4. Seat 0 = actor deck; seats 1..n = `addPracticeBot` with the compiled decks (as `ds/host.ts:1490`).
5. `setup`: `startupScripts`, `firstTurnDraw`, `sandbox: { board, run, scenarioId }`, seed (body or random).
6. `LiveGame.policies`: seat with `pass` -> `[]` (scripted, passes); `practice` -> not in map (random practice bot);
   `manual` -> added to new `LiveGame.manualSeats: Set<number>`.
7. Limit: at most 3 active sandbox duels per player; a 4th start cancels the oldest. Max 10 starts per minute per
   player (in-memory counter in the host), 429 above.

### 2.2 Seat control (one user, many seats)

- **Acting seat.** For a sandbox duel where `actor === organizerPlayerId`, `view`/`respond`/`surrender` accept `as`.
  Rule (`resolveActingSeat` in `ds/sandbox.ts`): `as` must be 0 or a seat in `manualSeats`; else 409
  "Take control of seat N first". `respond` then uses `as` in place of `room.mySeat` (`ds/host.ts:2369`).
  `project()` (`ds/host.ts:1255`) returns `mySeat = as` and `myDeck` of that seat, so `room.tsx` works unchanged.
- **Auto seats.** `autoSeatsOf` (`ds/host.ts:417`) skips `manualSeats`. The bot loop stops when the prompt is on a
  manual seat. `sandbox-control` to `pass`/`practice` calls `driveBot` at once (the seat may hold the prompt now).
- **Persist.** `sandbox-control` writes `setup.sandbox.run.bots` (existing `updateSetup`, `sh/services/duels.ts:588`),
  so a recover keeps the modes. The journal records each command with its real seat; replay is unchanged.
- **Hidden info (proposal).** The sandbox user is the only player, so hiding does not protect anyone. With
  `reveal=true` (default ON in the UI) `project()` reads `game.view(s)` for each other seat and copies its `hand`
  and `extra` into the projected view (`mergeRevealedHands`). Prompts are never merged: a prompt shows only for the
  acting seat. Spectate on a sandbox duel: 403 for everyone except the organizer.
- **ws.** No change. The ws room only sends `duel:changed` and presence (`packages/ws/src/duel-events.ts`); the
  client then refetches over HTTP with its `as`. The duel token keeps the DB seat (0) (`sh/ws/duel-token.ts`).
  Presence shows seat 0 online; that is correct.
- **Restart.** `sandbox-restart` reads `setup.sandbox` + `seed_json`, calls the start path with the same seed and the
  current `run` (manual seats kept), then `service.cancel` on the old slug. The client goes to the new slug.

## 3. Security

- **Gate (web).** New `web/src/lib/sandbox-access.ts` `requireSandboxActor()` = `requireDuelActor()` +, when
  `NODE_ENV === "production"`, `checkDiscordWebAccess(userId, "admin")` (`web/src/lib/discord-web-access.ts:9`).
  Every sandbox route and every sandbox param (`as`, `reveal`, control, restart) on duel routes uses it. Statuses:
  401 / 403 / 503 as the rest of the app. The pages call it server side and `notFound()` on deny.
- **Gate (host).** Host trusts only signed calls (as today). It also checks: duel row `sandbox = 1` and
  `actor === organizerPlayerId` for `as`, `reveal`, control, restart, info. Sandbox ops do not need `DUEL_SCENARIOS`.
- **No stats.** Plain duels write no matches/ELO (only series do, `sh/services/duel-series.ts`). Enforce anyway:
  `sandbox = 1` duels refuse `ranked`, series, invite, `takeSeat`, `add-bot`, tournament links (service 409).
  Exclude `sandbox = 1` from `LIST_ACCESS_SQL` users (`sh/services/duels.ts:528`, live list, history list) and from
  `live-now` (`sh/services/live-now.ts:35-90`). Replay op stays for the organizer only; not listed anywhere.
- **Cleanup.** Archive sandbox duels 1 hour after end; delete sandbox duel rows older than 7 days (bot cleanup cron).
- **Cards.** Only numeric passcodes. `resolveCard` accepts only main passcodes with `alias=0` and OCG/TCG (`catalog.ts:42`).
  The UI sends codes from `card-query`, which are main codes.
- **Lua.** The only Lua is what `compileBoard` emits from parsed numbers and fixed constants. `withoutCoreFunctions`
  and `teams` are rejected by the parser. No text field of the board reaches Lua. The scenario `name` is never in Lua.
- **Size.** Body limit 64 KiB on sandbox routes; board 32 KiB; parser limits in 1.2.

## 4. Web UI

### 4.1 Routes and API (contract for parallel work)

- Pages: `/sandbox` (list + New), `/sandbox/new?format=ffa3&from=<slug>`, `/sandbox/[id]` (builder),
  `/sandbox/[id]?play=1` (share link that starts at once). Nav item for admins only (`web/src/lib/nav-items.ts`).
- API: `GET/POST /api/sandbox/scenarios`, `GET/PUT/DELETE /api/sandbox/scenarios/[id]`,
  `POST /api/sandbox/validate`, `POST /api/sandbox/start` (`{ board, run, scenarioId? }` -> `{ slug }`),
  `POST /api/duels/[slug]/sandbox` (`{ action: "control"|"restart", seat?, control? }`),
  `GET /api/duels/[slug]/sandbox` (info). Duel view route and actions route pass `as` and `reveal`.
- Rights: any admin of the guild can list, open and start a scenario. Only its owner can update or delete it;
  others get "Save as copy".

### 4.2 Builder layout (dark, minimal chrome, `.impeccable.md`)

- **Top bar:** name, Format (1v1 / 3-way / 4-way / Tag; disabled with reason from `capabilities` op), Mode
  (Normal / Domain), Master Rule, Start options (5), Seed (random / fixed), Save, Share, Start.
- **Seat tabs:** P0 (You), P1..P3, each with bot mode (Auto-pass / Practice bot / Manual) and LP. A summary strip
  shows counts per seat (hand, field, GY, deck).
- **Mini board** of the selected seat: 5 Main Monster Zones + 2 EMZ, 5 S/T, Field, Pendulum L/R, and pile rows:
  Hand, Deck top (ordered, drag to reorder) + Deck size, Extra, GY, Banished, Deck Master (Domain only).
- **Slot popover:** position (monster: ATK / DEF / Set; S/T: Face-up / Set), "properly summoned", Xyz materials
  (list + Add from search), Remove, Move to another slot.
- **Card search drawer (right, or bottom sheet on phone):** reuse `CardBrowser` + `CardFilters`. Click a slot or
  pile to make it the target, then click a card (or drag) to place it. Card thumbs use `card-face.tsx`, inspect uses
  `deck-card-preview.tsx`.
- **Feedback:** live `parseSandboxBoard` errors on the slot; server `validate-board` on Save/Start. Unsaved draft
  kept in `localStorage` (try/catch), never the source of truth.

### 4.3 In-duel sandbox bar (`web/src/components/duel/sandbox-bar.tsx`)

Shown in `room.tsx` when the room has `sandbox` info. One thin row on the top HUD:
- Seat chips: "P0 You", "P2 Auto-pass", "P3 Manual". A dot marks the seat the engine waits on (`prioritySeat`).
  Click a chip: set that seat Manual (if not) and act as it. Long-press/menu: Auto-pass / Practice / Manual.
- "Follow prompt" toggle: when ON, the acting seat jumps to the waiting seat if that seat is Manual.
- "Reveal hands" toggle (default ON), Restart, Back to builder (`/sandbox/[id]` or `/sandbox/new?from=<slug>`),
  Copy link (scenario share link; hidden for an unsaved board).
- The acting seat lives in the URL (`?as=2`) so a reload keeps it. `api.ts` view/respond calls add `as`/`reveal`.

## 5. Start turn player, phase and first turn: what the core allows

The board is built by a startup Lua chunk that runs before turn 1 (`compileBoard`). There is no core API to set the
turn number or jump to a phase. What works with global effects:

| option | 1v1 | ffa3 / ffa4 / Tag | how |
|---|---|---|---|
| Turn player p0 | yes | yes | default |
| Turn player p1 | yes (today) | needs spike | `EFFECT_SKIP_TURN` on the turns before (`board.ts:186-196`) |
| Turn player p2/p3 | n/a | needs spike | one skip-turn effect per earlier seat, all reset by one MP1 undo hook (the draw-skip pattern, `board.ts:198-201`). Compiler rejects today (`board.ts:93`). |
| Start at Draw Phase (draws 1, Draw/Standby triggers run) | yes | yes | no `EFFECT_SKIP_DP` |
| Start at Standby -> Main 1, no draw | yes | yes | `skipOpeningDraw` (Standby still runs) |
| Start in BP / MP2 / EP | no | no | not offered; one click from MP1 |
| Attack on the first turn | yes | yes | `attackFirstTurn` (`EFFECT_BP_FIRST_TURN`) |
| First-turn draw rule | yes | yes | host `firstTurnDrawFor`; sandbox exposes it as "Start at Draw Phase" |

Notes for the owner: when the turn player is not p0, the turn count is 2+ (skipped turns count), so "first turn"
rules (no attack) do not apply. Cards placed by `Debug.AddCard` act like EDOPro puzzle cards: set Traps can activate
at once; monsters have no "summoned this turn" state.

## 6. Work split (11 tasks)

Rules for every task: one owner per file; run only the listed tests; rebuild shared (`npm run build
--workspace=packages/shared`) before checking consumers; delete build output after. Backend = codex-full,
UI = sonnet-high, review = Opus high.

| # | task | owns (files) | needs | test |
|---|---|---|---|---|
| B1 | Board parser + limits | new `sh/duels/sandbox-board.ts`, export line in `sh/duels/index.ts` | - | `npx vitest run packages/shared/tests/sandbox-board.test.ts` |
| B2 | Scenarios table + service | `sh/db/schema.ts` (new block), new `sh/services/sandbox-scenarios.ts`, export in `sh/services/index.ts` | B1 | `packages/shared/tests/services/sandbox-scenarios.test.ts` |
| B3 | Duel rows: `sandbox` column, setup key, refusals, list/live-now filters | `sh/services/duels.ts`, `sh/services/live-now.ts`, `sh/db/schema.ts` (one `addColumnIfMissing` line, after B2) | B1 | `packages/shared/tests/services/duels-sandbox.test.ts` |
| B4 | Compiler: start options + multi-seat turn player (spike) | `ds/presets/board.ts`, new `ds/presets/runtime-board.ts` (`validateRuntimeBoard`) | B1 | `packages/duel-server/tests/presets.test.ts` + new `sandbox-turn-real.test.ts` (ffa3 starts on p2) |
| B5 | Pure seat helpers | new `ds/sandbox-seats.ts` (`resolveActingSeat`, `mergeRevealedHands`, `policiesForRun`) | B1 | `packages/duel-server/tests/sandbox-seats.test.ts` |
| B6 | Host ops: validate-board, start-sandbox, restart, info, limits | new `ds/sandbox.ts`, `ds/host.ts` (op wiring, `policiesOf`, `LiveGame.manualSeats`) | B3 B4 B5 | `packages/duel-server/tests/host-sandbox.test.ts` (start 1v1, restart gives same first view) |
| B7 | Host seat control: `as`, `reveal`, control op, `autoSeatsOf` | `ds/host.ts` (view/respond/surrender/project hooks), `ds/sandbox.ts` | B6 | `host-sandbox-control.test.ts` (act as seat 1, switch back, bot passes) |
| W1 | Web gate + API routes | new `web/src/lib/sandbox-access.ts`, `web/src/lib/duel-host.ts` (op union, `as`/`reveal` passthrough), new `web/app/api/sandbox/**`, `web/app/api/duels/[slug]/sandbox/route.ts`, view + actions routes | B1 B2 (host stubbed) | `npx vitest run packages/web/tests/sandbox-routes.test.ts -c packages/web/vitest.config.ts` (admin 200, member 403 in prod mode) |
| U1 | Builder state model | new `web/src/components/sandbox/board-model.ts` (reducer: place, move, position, materials, piles, format change trims seats) | B1 | `packages/web/tests/sandbox-board-model.test.ts` |
| U2 | Builder UI | new `web/src/components/sandbox/{builder,seat-board,zone-slot,pile-row,slot-popover}.tsx` + css, `components/sandbox/api.ts` | U1, W1 contract | `packages/web/tests/sandbox-builder.test.tsx` (place card, set position, Xyz material) |
| U3 | Pages, list, save/load/delete, share, nav; in-duel bar | new `web/app/(app)/sandbox/**`, `web/src/lib/nav-items.ts`, new `web/src/components/duel/sandbox-bar.tsx` + css, `room.tsx` (bar mount + `as` in URL), `components/duel/api.ts` | U2, W1, B7 contract | `packages/web/tests/sandbox-bar.test.tsx` (chip click sends control + as) |

Order: wave 1 = B1 (small, first, then the rest start), wave 2 = B2, B4, B5, U1 in parallel, then B3 (one schema line
after B2); wave 3 = B6, W1, U2; wave 4 = B7, U3. B6 and B7 are sequential because both own `ds/host.ts`. If U3 is too
big, split the in-duel bar (sandbox-bar, room.tsx, api.ts) into its own task after B7.

Manual check at the end (owner, local): build a 4-way board, start, act for seat 2, switch back, Restart, open the
share link in a second browser profile as admin, then as a non-admin on a prod-like build (403).

## 7. Risks

- Multi-seat turn player (B4) depends on how the multi core handles `EFFECT_SKIP_TURN`. If the spike fails, ship
  ffa/Tag with turn player p0 only and show the reason in the builder.
- `ds/host.ts` is 2700 lines and hot. Keep sandbox logic in `ds/sandbox.ts`; host edits stay small hooks.
- `reveal` reads one engine view per seat per request (up to 4). Fine for one user; do not enable for others.
- Boards made with `Debug.AddCard` differ from real play (no "this turn" state, no equip links, no counters).
  Owners may read a sandbox result as a rules bug. The builder shows a short note.
- DB growth from sandbox duels and journals on prod: the cleanup in 3 is required, not optional.

## 8. Open questions for the owner

1. Reveal hands: default ON for the admin, and no spectators on sandbox duels. Is that right?
2. Shared scenarios: owner-only edit plus "Save as copy" for other admins, or any admin can edit?
3. "Local always": use `NODE_ENV !== "production"` (like test bots), or a `DUEL_SANDBOX=1` env flag?
4. If the multi-seat turn-player spike fails, is "ffa/Tag start on p0 only" acceptable for v1?
5. v1 leaves out counters, equip links, start in BP/MP2, and "save live board as scenario". Is that acceptable?

## 9. Owner answers (2026-10-05) — these override the spec above

1. Reveal hands: default ON, no spectators on sandbox duels. (as proposed)
2. Saved scenarios: only the maker edits/deletes; other admins open + "Save as copy". (as proposed)
3. Gate: admin required everywhere (local and prod). No extra env flag. (Owner is admin locally too.)
4. Start: the duel starts at the Draw Phase. From there the owner must be able to move to ANY phase
   (Standby, Main 1, Battle, Main 2, End) with real engine phase changes, so all phase triggers and
   "can activate in this phase" windows happen as in a real duel. Add a "Go to phase" control in the
   sandbox bar: it advances the turn phase by phase (answering phase prompts for the acting seat, bots pass)
   until the chosen phase. Also "Next turn". Never fake a phase; always walk the engine through it.
   Multi-seat turn player: still a spike; fallback p0 only.
5. UX priority from the owner: "make it intuitive", "set it up very easily and quickly", e.g. "five cards
   drawn that I want to try". Builder must make the common case fast:
   - Quick add: type card names in a search box per seat and zone (hand default), Enter adds; paste a list
     of names/passcodes (one per line) to fill a hand/deck/GY at once.
   - Sensible defaults: empty board + 8000 LP + filler deck; only what the owner adds is special.
   - Click a slot to place, click a placed card for position/remove; no deep menus.
   - "Start" is always one click; "Restart" puts the same board back.
6. v1 leaves out counters, equip links, and "save live board as scenario".


## 10. v2 (owner 2026-10-06)

This section overrides conflicting v1 text and section 9. The remaining section 9 answers still apply.
Visible brand text is **Duelists Kingdom**.

### 10.1 Owner requests

1. Show the real fields in the builder. FFA3 uses the plaza layout. FFA4 uses the 2x2 grid:
   p0 bottom-left, p1 top-left, p2 top-right, p3 bottom-right. Facing pairs are 0/1 and 2/3.
   Keep each seat in its real position so placement and column effects can be tested.
2. Set seats to active or eliminated before start. Allow elimination during a sandbox duel.
   Eliminated seats keep their positions. The builder can restore a seat before start.
3. Save and share scenarios, including a snapshot of the **current live duel state**.
4. Choose the starting phase: Draw, Standby, Main 1, Battle, Main 2 or End.
5. Add quick **Save & close** and **Close** buttons. Both end the sandbox duel and return to `/sandbox`.
   Save & close must save successfully before it closes. A save failure leaves the duel open.

### 10.2 Shared board contract (S1)

`sh/duels/sandbox-board.ts`, exported from `@yugidraft/shared/duels`:

- Export `SANDBOX_START_PHASES` and its union type `SandboxStartPhase`:
  `"draw" | "standby" | "main1" | "battle" | "main2" | "end"`.
  `SandboxBoard.startAt?: SandboxStartPhase` defaults to `"draw"`.
- Add `eliminated?: SandboxDuelistId[]`. These are board seat keys (`"p0"` through `"p3"`),
  not numeric host seats. Only `ffa3` and `ffa4` accept this field, including an empty array.
  Reject duplicates, seats outside the format, and any selection that leaves fewer than two active seats.
  The turn player cannot be eliminated. Omission means no eliminated seats.
- Reject cards on eliminated seats with a `SandboxBoardError` at the seat's zone. This includes all piles,
  field slots and Deck Master. Empty arrays and null slots are valid. Do not silently drop input cards.
  LP on an eliminated seat may be 0-999999; active seats retain 1-999999. An eliminated Domain seat needs
  no Deck Master. All active Domain seats still need one. Ignore filler deck size for eliminated seats
  when compiling/starting; no cards may be created for those seats.
- Reject `startAt: "battle"` with turn `p0` and `attackFirstTurn` absent or false. Error path: `startAt`;
  message explains that Battle Phase on turn 1 needs `attackFirstTurn`. Earlier skipped turns count when
  starting at p1/p2/p3. The host still checks real engine phase availability, including FFA first-round rules.
- `skipOpeningDraw` remains false-only. Start through Draw Phase, apply eliminated seats before turn 1,
  then use the existing real engine phase walk to reach `startAt`. Triggers and response windows run normally.
  Do not assign a fake phase or silently move to another turn if the requested phase is unavailable.

### 10.3 Portable share codes (S1; U6 consumes)

New `sh/duels/sandbox-share.ts`, exported from `@yugidraft/shared/duels`:

- `SandboxShare = { name?: string; board: SandboxBoard; run: SandboxRun }`.
- `encodeSandboxShare(value: SandboxShare): string` and `decodeSandboxShare(code: string): SandboxShare`
  are synchronous. Both validate with `parseSandboxBoard` and `parseSandboxRun` and return fresh data.
  An optional name is trimmed and must contain 1-80 characters, as in the scenario service.
  Reject unknown envelope keys and missing board/run.
- Wire format: `DKSB1:` + unpadded base64url of compact UTF-8 JSON `{name?, board, run}`.
  v2 uses plain JSON. No shared synchronous deflate codec is installed for Node and browser; do not emit
  environment-dependent compressed codes. A future compressed format must use a new version prefix.
- Export `SANDBOX_SHARE_PREFIX` (`"DKSB1:"`) and `SANDBOX_SHARE_MAX_LENGTH` (49152 characters, including
  prefix). The 48 KiB cap fits the existing 32 KiB board, 1 KiB run and name limits after base64 encoding.
  Check length before decoding. Reject invalid prefix, base64url, UTF-8, JSON, or board/run data.
  All validation failures throw `SandboxBoardError`; transport errors use path `share`, name errors use `name`,
  and board/run parser errors keep their existing paths. This is a data format, not a signature.
- Decode in the client and load the result into the builder. **Import code** also works on `/sandbox/new`.
  No share-code server route is needed. Normal save/start validation and admin gates still apply.

### 10.4 Host operations (H1/H2)

Add these keys to shared `SANDBOX_OPS` (S1). Existing operations remain unchanged.
All operations use the existing signed host envelope with slug, guild and actor. Require a sandbox duel
and its organizer. Web access also requires guild admin in every environment.

| key / op | input beyond envelope | result | owner |
|---|---|---|---|
| `eliminate` / `sandbox-eliminate` | `{ seat: number }` | updated room | H1 |
| `snapshot` / `sandbox-snapshot` | none | `SandboxSnapshotResult` | H2 |
| `close` / `sandbox-close` | none | `{ ok: true }` | H1 |

- Eliminate uses the real FFA engine loss path and journal, as surrender/LP 0 does under
  `docs/adr/0002-multiplayer-duel-rules.md`. Refuse non-FFA, invalid or already eliminated seats, and an
  action that would leave fewer than two active seats. Do not just hide a seat. Seats never move.
- Export `SandboxSnapshotResult = { board: SandboxBoard; run: SandboxRun; lost: string[] }`
  from `sh/duels/sandbox-ops.ts`. Read every seat from the live engine, including hidden zones. Capture
  zones, positions, face-down cards, Xyz materials, LP, ordered Deck, Extra, GY, banished, Deck Master,
  turn player, current phase as `startAt`, eliminated seats, format, mode and Master Rule, plus current run settings.
  Parse the resulting board/run. Empty eliminated seats and omit their Deck Master; preserve zero LP.
- `lost` lists each state feature that the board cannot restore: counters, equip links, lasting effects,
  chain state, turn count and this-turn flags, plus any other actual representation loss. v1 has one common
  deckSize and numeric-only Deck/Extra/GY/banished piles; report unequal deck sizes or pile position loss
  explicitly. Never silently claim an exact engine restore. H2 must report or reject unrepresentable state;
  do not change shared board fields outside this contract without an agreed contract update.
- Snapshot does not modify the live duel. Normalize first-turn attack permission if needed to represent a
  captured Battle Phase, and report that change in `lost`. Engine phase walks still apply on restart.
- Close ends/cancels the duel and releases its live resources. It is idempotent: a repeated authorized close
  returns `{ ok: true }`. It does not surrender a seat or create a scenario.
- H1 applies starting eliminations before turn 1 and walks to `startAt`. H1 also owns the minimal
  `ds/presets/board.ts` compatibility changes required for the expanded phases and eliminated Domain seats.

### 10.5 Web API and UI (W2/U5/U6/U7)

Extend `POST /api/duels/[slug]/sandbox` with:

| action | fields | response |
|---|---|---|
| `eliminate` | `seat` (numeric) | host's updated room |
| `snapshot` | none | `SandboxSnapshotResult` |
| `save-state` | `name`, optional `scenarioId` | `{ scenario, lost }` |
| `close` | none | `{ ok: true }` |

`save-state` snapshots the live duel, then creates a scenario, or updates `scenarioId` only when the caller
owns it in the same guild. Keep existing scenario service limits and errors; do not silently overwrite
another owner's scenario. All four actions require guild admin and a sandbox duel; the host also checks
organizer ownership. Existing control/restart/phase/next-turn actions remain supported.

U7 implements Save & close as save-state followed by close, then navigation to `/sandbox`. Close sends
close then navigates there. Show save errors and snapshot losses. U6 handles share/import, phase selection
and pre-start active/eliminated seats. U5 shows every seat in the real table position, including eliminated
seats. U6 mounts `<SandboxTableView>` for ffa3/ffa4. Its props use state, dispatch and selected-slot handlers,
as in the existing seat-board API. Use the existing seat board for other formats.

### 10.6 File ownership and checks

Paths use the aliases at the top of this spec. Each task may add its own tests. Do not edit another task's files.

| task | owned files |
|---|---|
| S1 | This spec; `sh/duels/sandbox-board.ts`; new `sh/duels/sandbox-share.ts`; `sh/duels/sandbox-ops.ts`; export lines in `sh/duels/index.ts`; `packages/shared/tests/sandbox-board.test.ts`; the shared scenario service validation tests in `packages/shared/tests/services/sandbox-scenarios.test.ts`; new shared contract tests |
| H1 | `ds/sandbox.ts`; sandbox hooks/dispatch in `ds/host.ts` except H2 snapshot dispatch; minimal compiler changes in `ds/presets/board.ts` |
| H2 | New `ds/sandbox-snapshot.ts`; only snapshot dispatch lines in `ds/host.ts` |
| W2 | `web/app/api/duels/[slug]/sandbox/route.ts`; `web/src/lib/duel-host.ts`; `web/src/lib/sandbox-access.ts`; other duel routes needed for LOW 8 access checks |
| U5 | New `web/src/components/sandbox/table-view.tsx` and `table-view.module.css`; `web/src/components/sandbox/seat-board.tsx` |
| U6 | `web/src/components/sandbox/board-model.ts`; `builder.tsx`; `sandbox/api.ts` (full path `web/src/components/sandbox/api.ts`); new `share-dialog.tsx` in that directory |
| U7 | `web/src/components/duel/sandbox-bar.tsx` and its CSS; `web/src/components/duel/api.ts` |

S1 commits this contract first, then shared code/tests in a separate commit. Later tasks use section 10 on
`feat/dev-sandbox`. Run only changed/new tests and nearby sandbox tests. Build shared before consumer checks.
S1 covers all phase values, eliminated-seat validation, share round trips, invalid prefix/length/tampered
JSON and the operation names. Host/UI tasks test their engine, access, save/close and field-layout behavior.
