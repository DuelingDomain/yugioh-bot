# Duel end-to-end tests (Layer 4)

Playwright tests that drive real browsers against an isolated local stack. One test can open 2 to 4 browser contexts, one per player. See `docs/adr/0003-duel-test-layers.md` for where this layer fits.

## Run

```bash
npx playwright install chromium          # once
npm run e2e --workspace=packages/e2e      # builds what is stale, starts the stack, runs, stops the stack
npm run e2e:report --workspace=packages/e2e
```

- `e2e:nobuild` skips the build step. `E2E_FORCE_BUILD=1` rebuilds all. `E2E_SKIP_BUILD=1` skips builds.
- Run one file: `npx playwright test duel-1v1-match` (from `packages/e2e`).
- Shard: `npx playwright test --shard=1/3`. Each shard starts its own stack, so run shards on separate machines.
- Retries: 1 in CI, 0 locally. Traces are kept on the first retry in CI and on failure locally. Screenshots and video are kept on failure. A failed test also attaches more evidence: see Failure evidence.

## The isolated stack

Playwright `webServer` runs `stack/start.mjs`. It starts three processes on non-live ports and stops them at the end:

| Service | Port | Notes |
| --- | --- | --- |
| web (production standalone build) | 3300 | `http://localhost:3300`. Use `localhost`, not `127.0.0.1`. |
| ws Socket.IO | 3302 public, 4302 internal | `NEXT_PUBLIC_WS_URL` is baked into the web build. |
| duel host | 4303 | Uses `data/duel-engine-next` read-only. |

- Database: a fresh SQLite file at `packages/e2e/.stack/e2e.sqlite`, seeded with one guild and 5 players (p1 to p4 take seats; p5 is the unseated watcher). The live `data/bot.sqlite` is never used.
- The duel and web services set `MULTIPLAYER_TABLES=1` to permit FFA3, FFA4 and 2v2 Tag tables and presets.
- Secrets: new random values for each run (`stack/env.mjs`). The stack sets every variable the three servers read, so a value in a `.env` file cannot change the run. The duel host still loads the repo `.env` by a fixed path (dotenv never overrides a variable that is set). The ws server loads no `.env`.
- Memory: the duel host keeps each unfinished duel's engine worker for 5 minutes after its last request (`DUEL_IDLE_WORKER_MS`). A long `--repeat-each` run can use several GB. The memory goes down when the idle workers close.
- The web build is `next build` with the E2E ws URL, so `packages/web/.next` is overwritten. `stack/prepare.mjs` rebuilds only what is older than its sources.
- Discord is not called. `stack/fetch-stub.mjs` is preloaded into the web server only. It answers the guild-member check for the 4 fake players and serves a tiny JPEG for card images. The production checks in `duel-host.ts` are unchanged. Bot announcements are skipped because `BOT_ANNOUNCE_URL` is empty.
- The stack refuses to start on a live port (3000, 3001, 3002, 3100, 3110, 4001, 4002, 4003, 4010) or on a busy port.
- Concurrent runs: set `E2E_SLOT=N` (one digit, 0 to 9). Ports become web `3301+10N`, ws `3303+10N`, ws internal `4304+10N`, duel `4305+10N`, and the state folder `.stack-N` replaces `.stack`. Each slot needs its own build. See `stack/MANUAL.md`.

## Test login

`packages/web/src/lib/auth.ts` adds a NextAuth Credentials provider (`e2e`) only when `E2E_AUTH=1` and `E2E_AUTH_SECRET` has at least 32 characters. Without both, the provider does not exist and the login page is unchanged. The secret is compared in constant time. The session has the same `user.id` (Discord id) as a Discord login.

`tests/auth.setup.ts` logs in players p1 to p4 through the API and saves `.auth/p1.json` to `.auth/p4.json`. Tests load them with the `player` fixture.

## Add a flow

1. Add `tests/<name>.spec.ts`. Import `test` and `expect` from `../helpers/fixtures`.
2. `const alice = await player("p1")` opens a new logged-in context and page. Call it once per player.
3. Use `uniqueTableName()` for table names. Tests share one stack, so never depend on global state.
4. Use web-first assertions (`expect(locator)...`). Do not use fixed sleeps.
5. Shared steps are in `helpers/duel.ts` (create table, import deck, enter duel room, surrender). Board steps are in `helpers/board.ts`: `startDuel` (two duelists, decks in imported order), `useCard`, `pickLegalZone`, `respondPanel`, `chainList`, `pile`, `pileCards`, `openLog`, `endTurn` and `attackWithFirstMonster`.
6. Build a deck with `withFiller([...])` from `helpers/decks.ts`. The first 5 cards are the opening hand. `FILLER` is a Normal Monster with no effect.
7. Call `useCard`, not a raw click, to act: it waits until the page stops showing "Waiting for a response."

## Failure evidence

A failed test gives enough data to find the bug without a second run. A passing test attaches nothing. Everything is in `test-results/<test>/` and in the HTML report (`npm run e2e:report`). The recorder lives in `helpers/evidence.ts` and starts inside the `player` fixture, so each test that uses `player(...)` has it.

| File | Content |
| --- | --- |
| `failure-summary.json` | Start here. Test error, table name, slug and duel id, seats with player keys, the open prompt of each player, the last answer per seat, the last 20 log lines, the paths of the other files, and the replay command. |
| `evidence-<key>.json` | Per player, all pages of the context, with a timestamp (`at`, and `ms` since the test started) on each entry: browser console messages with their type, page errors with stack, failed requests and HTTP 4xx/5xx responses (with the `{ "error": ... }` body), and every Socket.IO / WebSocket frame (`sent` or `received`, at most 1500 characters each, ping and pong skipped). The newest 1000 console, 200 page-error, 500 request and 2000 frame entries are kept. `dropped` counts the rest. |
| `duel-state-<key>.json` | Per player, the room JSON that the duel page polls (`/api/duels/<slug>`, read with the player's own cookies): seats, board, open prompt, log, and what each open page shows as text. |
| `duel-journal-<slug>.json` | The duel host journal of each duel the players used: seed, decks, settings, engine bundle version, and every accepted answer in order. |
| `stack-log.txt` | The lines of the ws, duel host and web servers from the test start to its end. `stack/start.mjs` writes them all with timestamps to `.stack/logs/stack.log`. The file starts empty on each run. |
| `timeline.md`, `timeline.json` | One time-ordered list of everything: each player's console, page errors, failed requests and WebSocket frames (one line each), the stack log lines, the duel journal answers (seat, prompt id, revision, answer) and the watcher notes. The first lines of `timeline.md` name the first error and the last progress point. Errors are marked `ERR`. A page that cancels its own navigation (`net::ERR_ABORTED`) is only a warning. The markdown drops the oldest WebSocket lines when the list is long; the JSON keeps all. |
| `stall-<slug>-<iso time>.json` (has `"kind": "stall"`) and `stall-<n>-<key>-pageN.png` | Written when the stall detector fires. See Stall detector. |
| `leak-scan.json` | The hidden-card check. See Leak scan. Written after every test that used a duel, also when it passed. |
| `trace.zip`, `test-failed-N.png`, `video-<key>-*.webm` | Playwright trace, screenshots and a video of each player context. The fixture records the video itself, because Playwright records only its own `page` fixture. |

The files are in `test-results/<test>/evidence/` (and Playwright copies them to `attachments/`).

The duel host keeps the journal in the shared SQLite file (`duels`, `duel_seats`, `duel_commands`). The E2E stack has its own file (`.stack/e2e.sqlite`), and the recorder reads it read-only, so the duel host has no extra endpoint. The stack is stopped when the run ends, but the file stays until the next run, so you can read it by hand.

Set `E2E_EVIDENCE=always` to write the evidence files (timeline, state, journal, stack log) for a passing test too. Videos are kept only when the Playwright `video` option says so.

### Run index

After each run, `test-results/index.md` (and `index.json`) lists every failed test: its first error line, links to `timeline.md`, `failure-summary.json`, the stall and leak files and the trace, and the replay command. Playwright empties `test-results/` at the start of a run, so the index always describes the last run. The reporter `tools/index-reporter.mjs` builds it (it must stay after the `json` reporter in `playwright.config.ts`, because it reads `.status/e2e-results.json`). Rebuild it by hand with `npm run e2e:index --workspace=packages/e2e`. A stall or a leak message is shown as the first error, because it explains the aborted click or timeout that follows it.

### Stall detector

A timer in the `player` fixture (`helpers/watch.ts`) reads the room JSON of every player every 0.5 to 2 seconds (the same `/api/duels/<slug>` read as the recorder). While a duel is `active` and its revision does not change for `E2E_STALL_MS` (default 60000), it writes `stall-<slug>-<iso time>.json` (with `kind: "stall"`) at once: who holds the open prompt, each player's prompt and last log lines, the last answers of each seat, the last 30 stack log lines, and a screenshot of every page of every player. Then it writes the normal evidence, closes the browser contexts (so the test's waits end at once) and fails the test with a message such as `Duel abc stalled: revision 12 did not change for 60 s. Open prompt held by p2 (seat 1) "Choose an action".` The 60-second default allows slower parallel runs to finish table setup and inspection without changing the duel revision, while still firing before the 120-second Playwright test timeout. Tests contain no fixed sleeps for this. A test that waits on purpose (a clock test) turns it off with `test.use({ stallMs: 0 })`. `E2E_STALL_MS=0` turns it off for a run. To see it work, run a spec with `E2E_STALL_MS=1500`.

### Leak scan

After each test the fixture checks that no browser received a card it may not know (`helpers/leak-scan.ts`, `helpers/leaks.ts`). Skip it with `E2E_LEAK_SCAN=0`.

1. The recorder keeps every number of 5 to 10 digits that reached each player: the whole text of every received WebSocket frame, and every room JSON (`/api/duels/<slug>` responses and the recorder's reads). The keys `myDeck` and `deckMaster` are removed first, because the page shows your own deck list.
2. The truth comes from the engine. `replay-journal.ts --json` replays the duel journal and prints the card codes of every seat's decks, and for each viewer (every seat and the spectator) the first step at which each code appeared in that viewer's own engine view.
3. A code is a leak when it is in the deck of ANOTHER seat and the browser received it before the engine view of that seat held it (never, or before the journal answer that revealed it, with a 2 second margin because journal times have a resolution of one second).
4. Any leak fails the test. The message names the player, the code, the seat that owns it, where it was first seen and the text around it. `leak-scan.json` has every leak, per player.

It works for N seats (the replay prints one view per seat). Deck Master codes are public by design and are not secret. A card that shows by name only, with no code, is not found here (the engine fuzz test checks names). The scan is skipped, with a reason in `leak-scan.json`, when a player used more than one duel in a test, when a player has no seat, or when the replay does not match the journal (the truth is then partial).

### Replay a failed duel in the engine

```bash
# from the repo root; uses data/duel-engine-next, or set DUEL_DATA_DIR
npx tsx packages/duel-server/scripts/replay-journal.ts packages/e2e/test-results/<test>/evidence/duel-journal-<slug>.json --views
npx tsx packages/duel-server/scripts/replay-journal.ts <journal.json> --stop-at 12 --views   # stop after 12 answers
npx tsx packages/duel-server/scripts/replay-journal.ts <journal.json> --trace                # print each answer
npx tsx packages/duel-server/scripts/replay-journal.ts <journal.json> --json                 # one JSON object: decks, what each seat saw (the leak scan uses this)
```

The script builds the duel with the same seed, decks and settings, answers in order (it checks the revision and prompt id of each step, like the duel host recovery), and prints the open prompt and the log of every seat (2 to 4). It exits with 1 on a mismatch or an engine error. Use the same engine data as the run: it warns when the bundle version differs.

The journal is not the fuzz failure format. `scripts/fuzz-repro.ts --file` rebuilds decks from a seed and cannot take a browser duel's own decks, so use `replay-journal.ts`. To turn a replay into a permanent test, copy `decks`, `seed` and the answers into a Layer 1 scenario.

Limits: only duels with recorded answers replay (a duel that never started has no seed). Bot seats are replayed from their journaled answers, so the bot is not needed. A duel that was interrupted by an engine error replays up to that error.

## Card flows

| File | What it proves |
| --- | --- |
| `card-chain-hand-trap.spec.ts` | Ash Blossom chained to a searcher: both screens show the chain, the search is negated, the history says "negated" then "resolved". |
| `card-trap-battle.spec.ts` | Mirror Force destroys two attackers. Both graveyards match on both screens. No damage. |
| `card-face-down-privacy.spec.ts` | A Set monster and a Set trap: no name or code reaches the opponent or a spectator (page, room API, log, detail panel). |
| `card-pendulum-summon.spec.ts` | Two scales, a Pendulum Summon with a cancel and restart. Every screen logs "Pendulum Summon". |
| `duel-prompts.spec.ts` | A number prompt, a card order prompt (reset and confirm), a card-name search, and a mandatory pick with no Cancel. |
| `duel-domain.spec.ts` | A Deck Master is summoned from its zone, destroyed, recalled (Returns 1) and summoned again for 500 LP. |
| `duel-reconnect.spec.ts` | Both duelists reload during a chain. The chain and the open question come back. |
| `duel-win-spectator.spec.ts` | Win, lose and spectator result screens. |
| `duel-tag-table.spec.ts`, `duel-tag-battle.spec.ts`, `duel-tag-chain.spec.ts`, `duel-tag-surrender-spectator.spec.ts` | Tag 2v2 on the Rooftop table: four fields and shared team LP, the first Battle Phase on turn 4, partner visibility and the opposing team answering first, one surrender ends the duel, spectator view. |
| `duel-3p-ffa.spec.ts`, `duel-3p-ffa-table.spec.ts`, `duel-3p-ffa-rules.spec.ts`, `duel-3p-ffa-elimination.spec.ts`, `duel-3p-ffa-surrender.spec.ts` | FFA3 on the real engine: separate fields, no Battle Phase before the last duelist's turn, opponent picks, chain order, elimination and placings, Domain start, immediate surrender and automatic spectating. |
| `duel-4p-ffa.spec.ts` | FFA4 with four browser players or bots (see Scale to 4 players). |
| `duel-presets-multi.spec.ts` | Every multi-seat preset mounts the right table shell and plays on (see Multi-seat presets). |
| `duel-practice-bot-spectator.spec.ts` | The host plays one action against the practice bot. A spectator sees no hand faces. |
| `live-tables-rules.spec.ts` | A private lobby is hidden from other players, and Close removes it. |
| `table-hand-label.spec.ts` | FFA3 and FFA4 table preview (`/dev/table-preview`): a six-card hand leaves the own field name clear at 1440x900 and 1280x720. |
| `multiplayer-flag-off.spec.ts` | Runs only with `E2E_MULTIPLAYER_TABLES=0`: no Tag, 3-player or 4-player option, and the API refuses them. |

## Unit tests of the evidence helpers

`npm run test:unit --workspace=packages/e2e` runs `node --test` on `tests-unit/` (timeline merge and rendering, leak compare). No browser and no stack. Node 24 runs the TypeScript files directly.

## Scale to 4 players

- `helpers/duel.ts` has `createTable(page, name, { format: "ffa4", ... })` (the "Table type" select) and `addBotToSeat(page, slug, seat)` (`POST /api/duels/<slug>/bot` with `{ seat }`).
- `helpers/board.ts` has `startTable(humans, label, decks, { format, bots })`: the first human creates the table, bots fill the given 0-based seats, the others join, everyone imports a deck and readies, the host starts. `expectOpponentBoards(page, 3)` checks the live table (`[data-table-stage] [data-lp-seat]`) and the opponents in the seat strip.
- `tests/duel-4p-ffa.spec.ts` runs 4 browser players on one table (6 tests): 4-FFA start with 3 opponent boards for each seat, 1 human with 3 bots, no attack before every duelist had a turn, a spell that hits all 3 opponents (Raigeki), a card that picks one opponent (Mind Crush: the prompt lists each living opponent by name and only the picked one is hit), and a direct attack that locks a named opponent in OpponentBar before confirmation, followed by three surrenders and the final standings. A surrender shows "Leaving" until the turn or step ends.
- `tests/duel-3p-ffa.spec.ts` runs the live FFA3 table against the real engine (2 tests): Mind Crush picks an opponent through the seat strip; a direct attack locks and confirms exactly one `{ choice: "opt:1" }` action with the current prompt id/revision. It also checks elimination, final placings after reload, and a spectator sending no actions.
- Card-menu helpers wait for `[data-table-shell][data-can-act="true"]`; a turn header can advance before the room finishes catching up. FFA4 startup also checks that hand buttons stay inside the stage at 1440×900 and 1280×720.
- The stall detector, the timeline and the leak scan already work for any number of players.

- The seed already has p3 and p4 (`stack/env.mjs`). Add more players there if needed.
- Open up to 4 contexts in one test with `player("p1")` to `player("p4")`.
- The creator and lobby support Tag, FFA3 and FFA4 (`createTable` with `format`, see above). Add a `.ydk` fixture per player if decks must differ.
- `fixtures/earth-normals-40.ydk` is 40 legal Normal Monsters (2 copies of 20 cards). Every player can use it.

## More evidence (journal and frames)

- The duel journal file has `tableFormat` (`1v1`, `tag`, `ffa3`, `ffa4`), `setup` (the saved duel setup) and `wasmSha256` (the hash of each engine wasm in the data folder). Old journals without these fields still replay: the format is read from the deck count.
- `replay-journal.ts <file> --wasm <path>` runs the replay on that wasm (the standard core for 2 seats, the multi-duelist core for 3 or 4). `--views` prints every seat (2 to 4).
- On a failure, every open page of every player gets a `failure-<key>-pageN.png` screenshot.
- A binary WebSocket frame is saved in `evidence-<key>.json` as `base64` (first 4096 bytes, `truncated` says if more). The leak scan only reads text frames.
- The room type in `helpers/evidence.ts` (`RoomBody`) has `format`, `team`, `eliminated`, `winnerTeam` and per-seat `lp`.

## Multi-seat presets (evidence for 3 and 4 seat duels)

`tests/duel-presets-multi.spec.ts` runs every preset that has more than 2 seats (FFA and Tag, read from `packages/duel-server/src/presets/`) in a real browser. The e2e duel host and web run with `DUEL_SCENARIOS=1` (`stack/start.mjs`, e2e only). Seat 0 is the test user (p1) and the other seats are scripted bots of the host. A spectator (p2) watches too.

```bash
# from the repo root: all presets and the visual set (one worker, through the machine lock)
bash packages/duel-server/domain-core/.build/phase1/run-locked.sh e2e 1 \
  env E2E_WORKERS=1 npx playwright test duel-presets-multi -c packages/e2e/playwright.config.ts
# one preset, one seed (run from packages/e2e; E2E_SEED = four decimal numbers a,b,c,d or one number)
E2E_WORKERS=1 E2E_PRESET=raigeki-dark-hole-ffa4 E2E_SEED=12345 npx playwright test duel-presets-multi
# the 4 player spec
E2E_WORKERS=1 npx playwright test duel-4p-ffa
# use a copy of the web build (for example one with other ports baked in) instead of packages/web/.next/standalone
E2E_STANDALONE_DIR=/path/to/standalone/packages/web E2E_WORKERS=1 npx playwright test duel-4p-ffa
```

Build first when the sources changed (`npm run stack:build --workspace=packages/e2e`, it needs the `build` lock).

What a test does for each preset:

1. Reads `list-presets` through `GET /api/duels/preset` and starts the preset with `POST /api/duels/preset`.
2. Opens the room page of seat 0 and a spectator page.
3. Plays seat 0 over `POST /api/duels/<slug>/actions`: it picks the cards of the checklist (the `PLANS` table in `helpers/multi.ts`, else the checklist text) and passes at every other prompt. It stops when the checklist moves are done and the turn is `seats + 1` (or `E2E_MULTI_TURNS`), or when the duel ends.
4. At every revision change it saves a snapshot: screenshots of seat 0 and of the spectator, both room JSON files, the prompt (kind, seat, options), LP of every seat and the eliminated flags.
5. Stall rule: the revision does not change for `E2E_STALL_MS` (default 60000) while seat 0 has no prompt to answer. Then `stall.json` is written and the test fails with its path.
6. At the end (pass, fail or stall) it calls the host `report` op and copies the folder, then writes the normal evidence (console, page errors, failed requests, every WebSocket frame including binary, journal, stack log slice, merged timeline).

Output: `.status/e2e-multi/<runId>/<presetId>/` (`.status/` is outside git):

| File | Content |
| --- | --- |
| `README.md`, `result.json` | Status (`pass`, `fail`, `stall`), turn reached, last prompt, first error, checklist moves not done. |
| `steps/NNN-seat0.png`, `NNN-spectator.png`, `NNN-*-room.json`, `steps.json` | One snapshot for each revision (the first `E2E_MULTI_MAX_SHOTS`, default 120). |
| `driver-log.json` | Every answer of seat 0: prompt, answer, HTTP status. |
| `stall.json` | Waiting seat, last prompt, last 50 timeline lines, core tag, report path, replay command. Only on a stall. |
| `timeline.md`, `timeline.json` | All sources merged. The first lines name the first error and the last progress. |
| `evidence-p1.json`, `evidence-p2.json` | Console, page errors, failed requests, WebSocket frames. |
| `duel-journal-<slug>.json`, `duel-state-*.json`, `stack-log.txt`, `failure-*.png` | As in Failure evidence. |
| `host-report/` | The folder of the host `report` op: `journal.jsonl` (bot answers have `bot: true` and a `note`), `views/seat-N.json`, `note.md`. The e2e host writes it to `.stack/reports/` and the test copies it. |

Per run: `.status/e2e-multi/<runId>/index.md` and `results.json`. Always: `.status/e2e-multi/latest.json`, a list of `{preset, status, coreTag, turnReached, lastPrompt, evidenceDir, firstError}` (plus `runId`, `format`, `seats`, `stalledSeat`). A run of one preset keeps the older entries of the others. The core tag comes from `data/duel-engine-next/ocgcore.multi.SOURCE`.

Extra evidence (per preset folder):

| File | Content |
| --- | --- |
| `checklist.json` | One verdict for each checklist item: `pass`, `fail`, `not-reached` or `unchecked` (a human must look), with revision, screenshot and detail. Rules: `helpers/multi-verdict.ts`. The same table is in `README.md` and `latest.json` (`checklist`). |
| `steps/NNN-debug-trace.json` | Host op `debug-trace` at each revision: every seat view, the spectator view, open prompts, bot rule trace, bot timer, worker state. It is feature-detected: on a host without it (HTTP 404, or `DUEL_SCENARIOS` off) nothing is saved and `debugTrace` is `absent`. The test calls the e2e host directly with the e2e secret (the web has no route for it). `stall-debug-trace.json` / `hang-debug-trace.json` are taken at a stall. |
| `leaks.json` | Leak scan of the two browser views (seat 0, spectator): hand cards and face-down cards of other seats must show no card code. Tag: a seat may see its partner (seat + 2). A leak fails the test. |
| `invariants.json` | FZ invariants (`packages/duel-server/tests/fuzz-n/invariants.ts`, `checkViewSequence`) over the debug-trace view sets. Skipped (with the reason) when no complete view set exists. |

`E2E_SEED`: the web route `POST /api/duels/preset` does not send a seed, so with `E2E_SEED` the test calls the host `start-preset` op directly as player `E2E_SEAT0_PLAYER_ID` (default 1, the first login of a fresh e2e database). Turn timers: the presets use the 240 s time bank (`clock.remainingMs` of each seat is in `steps.json`); a run is at most `E2E_MULTI_MAX_MS` (150 s).

Visual set: the tests `visual ffa3`, `visual ffa4` and `visual tag` make a real lobby table with 3 or 4 human seats, wait for the first prompt and save one full-page screenshot for each seat in `.status/e2e-multi/<runId>/visual/<format>/seat<N>-<player>.png` (with the room JSON of each seat and an `evidence/` folder).

Not captured: the WebGL effect layer (reduced motion is on), browser video, and a leak scan for the preset runs (the fixture leak scan runs in the other specs).
