# Cube list import — Duelists Kingdom

The backend is ready for an “Import a list (.txt / .ydk or paste)” control. Read the file as text and send JSON; there is no multipart upload endpoint.

## Resolve a list for the unsaved draft pool

The draft creation screen's **Start from scratch** pool is client state, not a saved cube. Resolve its uploaded/pasted text through `POST /api/cards/resolve`, `Content-Type: application/json`:

```json
{"listText":"3 Dark Hole\n2 53129443\nShooting Star Dragon\nArtifact Moraltech\nGlue"}
```

200 response, with illustrative catalog image/effect values:

```json
{
  "cards": [
    {"id":53129443,"name":"Dark Hole","type":"Spell Card","frameType":"spell","effectText":"Destroy all monsters on the field.","imageUrl":"https://images.ygoprodeck.com/images/cards/53129443.jpg","imageUrlSmall":"https://images.ygoprodeck.com/images/cards_small/53129443.jpg"},
    {"id":44508094,"name":"Shooting Star Dragon","type":"Synchro Monster","frameType":"synchro","effectText":"Catalog effect text.","imageUrl":"https://images.ygoprodeck.com/images/cards/44508094.jpg","imageUrlSmall":"https://images.ygoprodeck.com/images/cards_small/44508094.jpg"},
    {"id":85103922,"name":"Artifact Moralltach","type":"Effect Monster","frameType":"effect","effectText":"Catalog effect text.","imageUrl":"https://images.ygoprodeck.com/images/cards/85103922.jpg","imageUrlSmall":"https://images.ygoprodeck.com/images/cards_small/85103922.jpg"}
  ],
  "entries": [
    {"id":53129443,"copies":5,"pool":"main"},
    {"id":44508094,"copies":1,"pool":"extra"},
    {"id":85103922,"copies":1,"pool":"main"}
  ],
  "unknown":["Glue"],
  "corrected":[{"from":"Artifact Moraltech","to":"Artifact Moralltach"}]
}
```

The exact list-mode response shape is `{cards: CardSummary[], entries: Array<{id:number,copies:number,pool:"main"|"extra"}>, unknown:string[], corrected:Array<{from:string,to:string}>}`. All four arrays are always present. `cards` contains one summary per resolved ID in the same order as `entries`; required fields are `id`, `name`, `type`, `frameType`, `effectText`, `imageUrl`, and `imageUrlSmall`. `attribute`, `level`, `atk`, and `def` are optional. List-mode summaries omit `qty`; `entries[].copies` is the copy count.

- `entries` preserves each resolved ID's first appearance in the input, sums all occurrences of that ID (including names and passcodes resolving to it), and caps the total at 99. YDK retains file order across sections; ydke uses main/extra/side order.
- Extra Deck frames always have `pool:"extra"`; explicit extra placement also wins when an ID appears in multiple sections. Side/Deck Master entries otherwise join main. Resolved Extra Deck cards remain in `cards`.
- `unknown` and `corrected` have the same unique, ordered diagnostic semantics described below. Ordinary unknown lines/passcodes are not request failures. Comment-only or wholly unresolved lists return 200 with empty `cards`/`entries`; `unknown` contains any unresolved lines and `corrected` is empty.
- No cube is created, updated, or attached, and no cube permission/guild-configuration check is added. Catalog cache/artwork writes are permitted. The existing resolve modes retain their `{cards,unknownIds}` payloads; list mode uses `unknown` for both names and passcodes.

Use the client list-resolve helper to consume this payload. Cache `cards` as usual and retain **both** pools. Expand copies separately when submitting a normal draft:

```ts
const main = poolFromEntries(result.entries.filter((entry) => entry.pool === "main"));
const extra = poolFromEntries(result.entries.filter((entry) => entry.pool === "extra"));
const poolConfig = configPool(main, null, extra);
// {setNames:[], customCardIds:[...], customExtraCardIds:[...], poolSource:null}
// Display result.unknown/result.corrected separately.
```

Resolve the scratch list without creating a cube as an intermediate step. The existing pool controller/model still needs UI wiring to retain separate main/extra maps; its legacy merge helpers discard extras.

## Normal cube draft Extra Deck contract (2026-10-06)

This applies to the shared-pool **Start from scratch / Use a cube** draft (`mode` absent or `"booster"`). Theme drafts keep their existing private-choice extra rounds and default ON behavior.

Send these fields inside `config` to `POST /api/drafts` or the pending host's `PUT /api/drafts/:slug`:

| Field | Normal default / contract |
| --- | --- |
| `extraDeckEnabled` | `false`; must be a boolean if supplied. Retaining an extra pool does not enable the phase. |
| `extraDeckSize` | `15`; integer 0–15. Each player drafts this many Extra Deck cards. OFF or size 0 means no extra pack. |
| `customExtraCardIds` | Optional array of positive, safe integer catalog IDs, **one per copy**, like `customCardIds`. An explicit array, including `[]`, overrides the source cube's extra pool. |
| `poolSource` | `{cubeId,cubeName}`. If `customExtraCardIds` is absent, use that cube's `cube_cards` rows with `pool='extra'` and their `max_copies`. The server sanitizes the reference to this guild and uses the database name. A missing/foreign reference is removed. |
| `picksPerStep` | `1`; accepts 1 or 2. Sequential selections per pack **before passing**. Each individual selection retains its own existing `pickStep` and deadline; no multi-select request is needed. |

Scratch example (illustrative card IDs and deliberately short main quota):

```json
{"name":"Cube night","config":{"mode":"booster","setNames":[],"customCardIds":[53129443,53129443,46986414,46986414],"customExtraCardIds":[44508094,44508094],"packsPerPlayer":1,"packSize":2,"cardsPerPlayer":2,"extraDeckEnabled":true,"extraDeckSize":1,"picksPerStep":2}}
```

For the owner's **5 rounds / 4 players / 24 cards per pile / 2-Pick** format, use `packsPerPlayer:5`, `packSize:24`, `cardsPerPlayer:120`, `picksPerStep:2`, and add the four players through the existing join flow. Main dealing needs 480 authored copies. Extra size 15 adds pack **6**, with 15 cards per player and 60 Extra copies required. Extra pack size is independent of the main `packSize`; the last group takes one card if its pack has an odd size. Passing direction follows the existing alternating round rule, and copy limits, forced picks, swaps, expiry, bots, and broadcasts use the existing mechanics.

`cardsPerPlayer` continues to be the **main pick quota**, not the size of the finished deck. The final main pack can leave cards unpicked when the quota is smaller than pack capacity. Extra cards never fill that quota. All main picks finish before the extra phase starts, and players are marked finished only after their combined quota. Explicit main `packsPerPlayer` values are retained on edit; changing main size/pack size without supplying a round count derives `ceil(cardsPerPlayer/packSize)`. An extra-only edit preserves all main format values. Main numeric edits allow 40–120 cards per player and packs of 5 through that quota, with a positive integer round count.

Both pools are shuffled separately and the entire main+extra deal is persisted atomically at **start**, so editing/deleting the source cube after start cannot change later packs. Extra counts are authored quantities; no catalog/set repetition expands them. Only Fusion/Synchro/Xyz/Link monsters (including hybrid frames recognized by the shared classifier) are eligible in extra dealing. Unknown IDs or other card types in the extra list are excluded from eligible counts, as non-main cards are excluded from normal main resolution. Extra arrays are retained even while OFF.

Create/edit return `201`/`200` with the existing identity/status fields, normalized `config`, `errors:string[]`, and `warnings:string[]`. A too-small pool is an **advisory** create/edit error, matching main checks. `GET /api/drafts/:slug/preflight` checks `max(2,joined player count)`; the shared start transaction checks actual seats and blocks with `400 {error}` before writing seats, deal, or status. Example error: `Extra pool: The cube has 8 cards. 4 players × 1 packs × 3 cards needs 12. Add cards, or use fewer packs or smaller packs.` Copy-cap reachability warnings also carry the `Extra pool:` prefix.

Invalid new fields return `400 {"error":"..."}` before draft/config writes:

- `Extra deck enabled must be a boolean`
- `Extra deck size must be a whole number from 0 to 15`
- `Picks per step must be 1 or 2`
- `customExtraCardIds must be a list of positive card IDs (one per copy)`

Null is invalid for supplied new fields. Existing omitted fields normalize to OFF / 15 / 1. Theme size validation/defaults remain unchanged.

`GET /api/drafts/:slug` and pick responses expose the normalized `config`, plus normal draft metadata:

```json
{"phase":"extra","packRound":6,"pickStep":1,"totalPackRounds":6,"currentPackSize":15,"boosterProgress":{"main":120,"mainTotal":120,"extra":0,"extraTotal":15}}
```

`phase` is `main`/`extra` when a nonzero extra phase is enabled; otherwise it is omitted for compatibility. `totalPackRounds` includes the extra pack, `currentPackSize` describes the active pack's original size, and `boosterProgress` counts the viewer's picks by phase (`0` for a viewer without a seat). `themeProgress` remains theme-only. Use the config toggle/size to show **Extra Deck round** in the lobby; use `phase` to label the active room and `currentPackSize` for pack counts. `pickStep` counts individual selections, so with 2-Pick, even steps trigger passing. WebSocket `resync`/`complete` behavior is unchanged.

`GET /api/drafts/:slug/pool` returns `{cards:CardSummary[], extraCards:CardSummary[]}` with authored `qty` values. `cards` stays main-only. `extraCards` is returned even while OFF, allowing the editor to retain/re-enable/save the pool. `fetchDraftPools(slug)` returns `{main:Map,extra:Map}` and caches both sets of summaries; legacy `fetchDraftPool` still returns main only. `fetchCubeDetail` now returns `{main:Map,extra:Map,extraCount:number}` (extraCount is distinct IDs), and `configPool(main,source,extra)` expands both maps to their config fields. Calling it without the third argument retains source-cube fallback.

Save-as-cube uses `createPoolCube({name,cards,extraCards,copyExtraFromCubeId?})` → `POST /api/cubes`:

```json
{"kind":"pool","name":"Saved cube","cards":[{"id":53129443,"copies":3}],"extraCards":[{"id":44508094,"copies":2}]}
```

`extraCards` uses the existing ID/copies validation (1–99 copies, duplicate IDs summed/capped, at most 1000 distinct per array); explicit entries are stored with `pool='extra'`. When `extraCards` is present, including `[]`, it supplies the entire Extra pool and **overrides** `copyExtraFromCubeId`. If omitted, the existing guild-scoped source-copy path remains available. Extra Deck monsters in `cards` also route to extra. The existing config-backed cube save path accepts `config.customExtraCardIds` and materializes its repeated copies into real extra rows. Saved cubes flatten those extra rows through `applyCubeToConfig` for Discord/shared consumers as well.

Completion saves Extra Deck monsters in each human player's Extra Deck, using existing deck limits (main 60, extra 15, side 15); excess main picks from the 120-card format remain available in the draft pool for deck building. Test bots do not get saved decks. Engine identity files are not required for draft logic verification.

UI handoff: add the toggle/size and 2-Pick option, maintain extra maps in `pool-model` / controller / import paths, pass them to `configPool` and `createPoolCube`, and consume the phase/progress metadata. No screens or pool-controller state were changed in this backend task. Rebuild shared before consumer work; generated build outputs are removed after verification.

List-mode errors use the existing route's JSON style, `{"error":"message"}`:

| Status | Condition / message |
| --- | --- |
| 401 | Missing authenticated user ID: `Unauthorized`. Authentication runs before database access/resolution. |
| 400 | Non-string, empty, or whitespace-only `listText`: `Add a card list file or paste a list.` |
| 400 | More than 65,536 UTF-16 code units: `That list text is too large. The limit is 64 Ki characters.` |
| 400 | More than 1,000 distinct normalized input names/passcodes: `That list has N different cards. Import at most 1000 at a time.` |
| 400 | Zero/unsafe/invalid parsed copy count: `Invalid copy count in "LINE".` |
| 400 | Invalid YDK/ydke: the existing deck parser's message, e.g. `YDK contains multiple #deckmaster sections.` or `Invalid character` for invalid base64. |
| 400 | Any of `setNames`, `customCardIds`, `cardName`, `fuzzyName`, `archetype`, or `includeExtra` supplied alongside `listText` (even empty/null): `listText cannot be combined with other resolve options.` |
| 400 | Other non-transient upstream card-fetch failures retain the resolve wrapper's `Unknown set` response. Normal upstream “no matching card” responses instead contribute to `unknown`. |
| 503 | Unavailable/rate-limited card database: `Card database is unavailable. Try again shortly.` Includes `Retry-After` from upstream, defaulting to `1`. No partial success payload is returned. |

Omitting `listText` selects the existing resolve behavior. This mode reuses the parser/resolver and formats below, including their limits and conservative typo matching.

## Add to an existing cube

`POST /api/cubes/:id/cards`, `Content-Type: application/json`:

```json
{"op":"importList","text":"3 Dark Hole\nGlue"}
```

200 response for an initially empty cube, with illustrative catalog image/effect values:

```json
{
  "pools": {
    "main": [{"catalogCardId":53129443,"pool":"main","maxCopies":3}],
    "extra": []
  },
  "cards": [{
    "id":53129443,
    "name":"Dark Hole",
    "type":"Spell Card",
    "frameType":"spell",
    "effectText":"Destroy all monsters on the field.",
    "imageUrl":"https://images.ygoprodeck.com/images/cards/53129443.jpg",
    "imageUrlSmall":"https://images.ygoprodeck.com/images/cards_small/53129443.jpg"
  }],
  "added":1,
  "copies":3,
  "unknown":["Glue"],
  "corrected":[]
}
```

`pools` and `cards` have the existing editor payload shape and describe the entire updated cube. Pool entries may also carry `source`. Card summaries optionally include `attribute`, `level`, `atk`, and `def` when present in the catalog.

## Subtract from an existing cube

`POST /api/cubes/:id/cards`, `Content-Type: application/json`:

```json
{"op":"subtract","entries":[{"id":53129443,"copies":2,"pool":"main"},{"id":44508094,"copies":1,"pool":"extra"}]}
```

All entries are applied in one transaction. Each subtracts up to `copies` from the matching ID **in that pool**; a row is deleted at zero. Missing IDs and IDs currently in another pool are ignored. Duplicate entries subtract sequentially. An empty array is valid. IDs must be positive safe integers, copies integers 1–99, and pool exactly `"main"` or `"extra"`. At most **1000 entries** (including duplicates) are allowed; malformed or oversized requests return `400 {error}` before any cube write.

Success is `200 {pools,cards}`, describing the entire updated cube with the same editor payload as add/remove/setMaxCopies. Subtract performs no remote card lookup. The existing guild membership, guild scoping, and cube owner/admin authorization apply (401/403/404/500/503 as described below).

## Create and fill a cube

`POST /api/cubes`, `Content-Type: application/json`:

```json
{"name":"Imported cube","importText":"3 Dark Hole\nGlue","draftType":"booster"}
```

201 response (IDs/user/guild values are examples):

```json
{
  "cube": {
    "id":42,
    "guildId":"guild-1",
    "name":"Imported cube",
    "archetype":null,
    "banlist":null,
    "config":{"draftType":"booster"},
    "createdByUserId":"owner",
    "draftType":"booster"
  },
  "added":1,
  "copies":3,
  "unknown":["Glue"],
  "corrected":[]
}
```

`kind` may be omitted, `"list"`, or `"blank"`. `importText` is required for `kind:"list"`; other existing create requests remain supported. `draftType` is optional (`"theme"`, `"booster"`, `"any"`); omitted means `"any"`, with `config:{}`. A list cannot be combined with `config`, `cards`, `copyExtraFromCubeId`, `archetype`, `banlist`, or another kind.

The cube, its cards, and draft type are committed together. If no card resolves, nothing is created and the response is 400:

```json
{"error":"No cards found in that list.","added":0,"copies":0,"unknown":["Glue"],"corrected":[]}
```

## Result semantics and errors

Both successful imports return `added: number`, `copies: number`, `unknown: string[]`, and `corrected: Array<{from:string,to:string}>` at the top level.

- `added` counts distinct resolved IDs touched, including IDs already in the cube.
- `copies` counts copies gained after the 99 cap, so reimporting adds copies, and an already capped card contributes zero.
- `unknown` preserves unique trimmed original lines, including counts/notes. It also includes skipped document labels. Render these as lines that were not imported; they need not prevent saving the resolved cards.
- `corrected` reports unique parsed-name corrections, e.g. `{"from":"Artifact Moraltech","to":"Artifact Moralltach"}`. Case, quotes, punctuation, and whitespace normalization do not produce correction notices.
- A comment-only or entirely unresolved editor import returns 200 with `added:0,copies:0` and leaves the cube unchanged. Creation with zero resolved cards returns 400 as above.

All other failures return `{"error":"message"}`. Existing guards are unchanged: editor writes require guild membership and owner/admin permission; creation uses the existing auth guard. Error statuses are 401 unauthenticated, 403 denied, 404 missing/foreign cube, 500 missing server configuration, and 503 unavailable guild verification/card database. Card-database 503 responses include `Retry-After`. Invalid input (non-string/empty text, more than 65,536 UTF-16 code units, more than 1,000 distinct input names/passcodes, invalid count/YDK/ydke) returns 400. Creation also returns 400 for a missing name, invalid draft type, conflicting sources, or a failed cube write, and 409 for a duplicate cube name (case insensitive, checked again inside the transaction).

Network resolution finishes before cube writes. Any hard resolution/write error leaves cube rows and config unchanged; normal catalog cache warming is independent, as in the existing YDK import. Imports read current copy counts inside the transaction. Affected legacy `config.customCardIds` copies are moved into pool rows so booster drafts use the new total; unrelated config and set selections are preserved. An affected legacy config already above 99 copies returns 400 and is preserved rather than losing copies.

## Text formats

- Bare passcode or count plus passcode: `44095762`, `3 44095762`.
- Names: `Dark Hole` (one copy), `3 Dark Hole`, `3x Dark Hole`, `x3 Dark Hole`, `Dark Hole x3`, `Dark Hole (x3)`.
- Digit-leading printed names such as `7 Colored Fish` and `7 Completed` use one copy if the count interpretation fails and the full name matches exactly; `7 Colored Fish x3` and `3 7 Colored Fish` are supported.
- Full YDK (`#main`, `#extra`, `!side`, `#created by` comments, optional `#deckmaster`) and `ydke://` links reuse the existing deck parser. Side/Deck Master cards join main unless their frame requires extra.
- Name/passcode lists recognize `#extra`/`Extra Deck:`, `#main`/`Main Deck:`, and `!side`/`#side`/`Side Deck:`. Any explicit extra placement wins for a card appearing in both sections; Extra Deck frames always go to extra.
- Blank lines, `#`/`//` comments, BOM and CRLF are supported. Trailing non-count notes such as `(Soul-Linked to Quasar)` are stripped. Typographic quotes/apostrophes match straight ones.
- In a document with both `Last updated:` and `Current Size:` preambles, labels preceded by two blank lines that repeat a counted card in the following contiguous section are reported as skipped headings. Explicit deck section headers end that section. This handles the real sample’s `Fossil Fusion`, `Dark Magician`, and `Jinzo` labels without adding extra copies. Other bare name lines remain one-copy entries; ordinary lists are insensitive to blank lines.

Resolution first checks normalized catalog names. Missing exact names use batches of 20 via the [YGOPRODeck API’s pipe-separated name parameter](https://ygoprodeck.com/api-guide/); fallback discovery uses at most two distinct words per missing name and the existing rate/timeout helpers. Typos require exactly one plausible printed name, at least 88% similarity, at most three edits, and at least eight normalized characters. Weak/ambiguous matches remain unknown. Resolved cards use the normal artwork-aware catalog cache writer.

## UI integration and validation

The editor can call `importList` and consume `pools`/`cards` exactly as it does for current imports. Show `copies` gained plus `unknown`/`corrected` diagnostics.

`/drafts/new/cube` renders `CreateDraftForm`, which creates drafts through `/api/drafts`. Its unsaved **Start from scratch** pool uses the no-write resolve contract above. The lobby `CubeDraftBuilder` currently creates/attaches saved cubes through `/api/drafts/:slug/cubes`. For a list that should become a saved cube, create via `/api/cubes` above; use the returned `cube.id` with the existing attachment request:

```json
{"kind":"existing","cubeId":42}
```

The cube create API returns the stored cube/config and diagnostics; fetch cube detail if the UI needs card previews. The normal draft API additions are documented above; screens remain for the UI agent.

The supplied full Google Doc export was checked against its passcode reference using a seeded in-memory catalog and mocked remote responses: **258 IDs, 486 copies, every ID/count matching, four typo corrections**. Only a small trimmed fixture is committed; this is not a live upstream availability test.

### Verification commands and actual results

Run from the worktree after `source /home/sulman633/.nvm/nvm.sh` and `nvm use 22` (v22.23.3). All processes were run under `prlimit --core=0:0`; no full/package test suite was run.

```bash
npx vitest run packages/shared/tests/services/card-list-resolution.test.ts packages/shared/tests/services/cubes-import-list.test.ts packages/shared/tests/services/card-catalog.test.ts packages/shared/tests/services/cubes.test.ts packages/shared/tests/services/cubes-replace-main.test.ts --maxWorkers=1
# Test Files 5 passed (5); Tests 116 passed (116), 0 failed.

npx vitest run packages/web/tests/card-list-parser.test.ts packages/web/tests/cubes-import-list-route.test.ts packages/web/tests/cubes-route.test.ts packages/web/tests/cubes-pool-route.test.ts packages/web/tests/ydk-file.test.ts packages/web/tests/cards-resolve-route.test.ts -c packages/web/vitest.config.ts --maxWorkers=1
# Test Files 6 passed (6); Tests 113 passed (113), 0 failed.

npm run build --workspace=packages/shared
# Exit 0.
npm run typecheck --workspace=packages/shared
# Exit 0, no diagnostics.
npm run typecheck --workspace=packages/web -- --typeRoots ./node_modules/@types,../../node_modules/@types
# Exit 0, no diagnostics.
```

The unqualified web typecheck initially failed with TS2688 (`@types` from implicit ancestor type discovery); restricting type roots to this worktree allows the complete package check. That check also exposed one TS2348 test-mock typing error, which was fixed before the final successful run.

Tests were written/run before their implementations. Initial resolver tests: 8 failed; parser: 1 failed suite because the new module did not exist; transactional writes: 4 failed; routes: 18 failed / 11 passed. Review regressions also failed before their fixes (legacy quantities, numeric printed names, side routing, document-label detection, and cache-only lookup). The final counts above include those regressions and existing affected-area tests.

The temporary full-sample validator was run with `npx tsx --tsconfig packages/web/tsconfig.json .cube-list-sample-check.mts`, then removed. It checks all IDs, copies, and expected main/extra placement against the supplied reference. Shared `dist` and web incremental typecheck output are removed after verification; rebuild shared before UI consumer tests.

### Unsaved-pool resolve verification

Node v22.23.3, all processes under `prlimit --core=0:0`. The shared package was rebuilt before running consumers. `DUEL_DATA_DIR` was pointed at an unused fixture path inside this worktree to keep the protected engine directories out of test reads.

```bash
prlimit --core=0:0 env DUEL_DATA_DIR="$PWD/packages/web/tests/fixtures/resolve-list-no-engine" \
  ./node_modules/.bin/vitest run \
  packages/web/tests/cards-resolve-list-route.test.ts \
  packages/web/tests/card-list-parser.test.ts \
  packages/web/tests/cards-resolve-route.test.ts \
  -c packages/web/vitest.config.ts --maxWorkers=1
# Test Files 3 passed (3); Tests 57 passed (57), 0 failed.
# List route: 34; parser: 13; existing resolve route: 10.

prlimit --core=0:0 npm run typecheck --workspace=packages/web -- \
  --typeRoots ./node_modules/@types,../../node_modules/@types
# Exit 0, no diagnostics.
```

The initial test-first run had 35 expected failures (32 list-route cases and three section-order assertions) and 22 passes. Every new route test rejects cube insert/update/delete attempts with SQLite triggers and compares the complete cube/config/card rows afterward. Coverage includes actual catalog warming, names/passcodes/typos, YDK/ydke order, extra placement, quantity caps, exact limit boundaries, authentication, invalid text, mixed resolve modes, and upstream 503/429 responses. Only these three test files were run for this backend addition.

### Normal Extra Deck round verification (2026-10-06)

Node v22.23.3 via nvm. Commands ran in this worktree, under `prlimit --core=0:0`, with explicit files and a single worker. No full/package suite was run. `DUEL_DATA_DIR` pointed at an unused fixture path inside this worktree, preventing protected engine-directory reads. The expected missing-engine identity notice is harmless; these checks use the seeded catalog. Shared was rebuilt before consumer checks.

```bash
source /home/sulman633/.nvm/nvm.sh
nvm use 22

prlimit --core=0:0 env DUEL_DATA_DIR="$PWD/packages/web/tests/fixtures/extra-round-no-engine" \
  ./node_modules/.bin/vitest run \
  packages/shared/tests/services/drafts-booster-extra.test.ts \
  packages/shared/tests/services/drafts.test.ts \
  packages/shared/tests/services/drafts-theme.test.ts \
  packages/shared/tests/services/drafts-copy-cap.test.ts \
  packages/shared/tests/services/cubes.test.ts \
  packages/shared/tests/draft-pick-concurrency.test.ts \
  packages/shared/tests/draft-pack-options-concurrency.test.ts \
  packages/shared/tests/draft-pool-snapshot.test.ts \
  packages/shared/tests/draft-swap-random.test.ts --maxWorkers=1
# Test Files 9 passed (9); Tests 206 passed (206), 0 failed. New extra file: 17 tests.

prlimit --core=0:0 npm run build --workspace=packages/shared
# Exit 0.

prlimit --core=0:0 env DUEL_DATA_DIR="$PWD/packages/web/tests/fixtures/extra-round-no-engine" \
  ./node_modules/.bin/vitest run \
  packages/web/tests/drafts-extra-round-route.test.ts \
  packages/web/tests/draft-pool-api.test.ts \
  packages/web/tests/drafts-put-route.test.ts \
  packages/web/tests/drafts-booster-preflight.test.ts \
  packages/web/tests/drafts-pool-route.test.ts \
  packages/web/tests/cubes-pool-route.test.ts \
  -c packages/web/vitest.config.ts --maxWorkers=1
# Test Files 6 passed (6); Tests 79 passed (79), 0 failed. New route file: 20 tests.

prlimit --core=0:0 env DUEL_DATA_DIR="$PWD/packages/web/tests/fixtures/extra-round-no-engine" \
  ./node_modules/.bin/vitest run \
  packages/web/tests/draft-pick-websocket-route.test.ts \
  packages/web/tests/drafts-theme-response.test.ts \
  packages/web/tests/drafts-theme-numbers.test.ts \
  packages/web/tests/cubes-import-list-route.test.ts \
  packages/web/tests/cubes-route.test.ts \
  -c packages/web/vitest.config.ts --maxWorkers=1
# Test Files 5 passed (5); Tests 70 passed (70), 0 failed.

prlimit --core=0:0 env DUEL_DATA_DIR="$PWD/packages/web/tests/fixtures/extra-round-no-engine" \
  ./node_modules/.bin/vitest run \
  packages/bot/tests/interactions/select-menus.test.ts \
  packages/bot/tests/services/draft-timer.test.ts --maxWorkers=1
# Test Files 2 passed (2); Tests 20 passed (20), 0 failed.

prlimit --core=0:0 npm run typecheck --workspace=packages/shared
prlimit --core=0:0 npm run typecheck --workspace=packages/web -- \
  --typeRoots ./node_modules/@types,../../node_modules/@types
prlimit --core=0:0 npm run typecheck --workspace=packages/bot
# Each exit 0, no diagnostics. Bot typecheck also rebuilds shared.
```

Total selected checks: **375 tests passed, 0 failed** (206 shared, 149 web, 20 bot). The initial shared extra tests had 13 failures / 1 pass; initial route tests had 18 failures / 1 pass. Four pool-helper cases and the config-backed cube save failed before their implementations. The Discord regression failed before its quota fix. Independent review identified a legacy mixed-pool swap regression while OFF; its new test failed before restoring the legacy remainder behavior. Existing format expectations were updated to assert retained explicit pack counts and the corresponding insufficiency errors.

Shared `dist` and web incremental typecheck output were removed after final verification. No push was performed. Rebuild shared before the UI agent runs consumers.
