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

Out of scope v1: counters, equip links, "this turn" flags (summoned/activated this turn), start in BP/MP2/EP,
snapshot of a live board back to the builder, free Lua.

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
