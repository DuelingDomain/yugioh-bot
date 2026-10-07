# Cube list import — Duelists Kingdom

The backend is ready for an “Import a list (.txt / .ydk or paste)” control. Read the file as text and send JSON; there is no multipart upload endpoint.

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

`/drafts/new/cube` renders `CreateDraftForm`, which creates drafts through `/api/drafts`. The lobby `CubeDraftBuilder` currently creates/attaches through `/api/drafts/:slug/cubes`. For the new list flow, create via `/api/cubes` above; use the returned `cube.id` with the existing attachment request:

```json
{"kind":"existing","cubeId":42}
```

The create API deliberately returns the stored cube/config and diagnostics; fetch cube detail if the UI needs card previews. No screens or draft APIs were changed.

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
