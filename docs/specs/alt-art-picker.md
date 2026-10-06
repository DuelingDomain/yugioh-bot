# Duelists Kingdom: alternate artwork picker backend contract

This is the backend handoff for the separate picker UI. Visible brand text is **Duelists Kingdom**.

## Artwork list

`GET /api/cards/{passcode}/artworks` requires the same signed-in Discord guild member as the deck card search (`requireDuelActor`). Any **engine-known** member of the artwork family is accepted.

```ts
// Exported from @yugidraft/shared/duels (src/duels/artworks.ts)
interface CardArtworksResponse {
  passcode: number; // canonical engine main
  artworks: SelectableCardArtwork[];
}
interface SelectableCardArtwork {
  passcode: number;
  isMain: boolean;
  imageUrl: string | null;
  smallUrl: string | null;
  croppedUrl: string | null;
}
```

Example (illustrative engine family):

```json
{
  "passcode": 10,
  "artworks": [
    { "passcode": 10, "isMain": true, "imageUrl": "/api/cards/10/image", "smallUrl": "/api/cards/10/image?variant=small", "croppedUrl": "/api/cards/10/image?variant=cropped" },
    { "passcode": 11, "isMain": false, "imageUrl": null, "smallUrl": null, "croppedUrl": null }
  ]
}
```

The main is first; remaining members are sorted by numeric passcode. There is always one main. A card without alternatives returns just its main. Engine-only arts remain selectable even without images: a null URL means neither API artwork metadata nor a valid local cached image is known for that variant. Use a placeholder and label the missing image; do not substitute an upstream URL. The search count includes these selectable engine-only arts.

Image availability is evidence, not a guarantee of a future successful upstream download. The endpoint performs no image probes or metadata sync. An API image may later 404, and an old cache entry may contain the image route's alias fallback rather than distinct artwork. A cropped URL may be null while the full image exists. The existing image route still caches downloaded bytes, tries alias fallback, and handles upstream failures. An engine main synthesized during catalog sync is marked `source = 'engine'`, not counted as API image evidence.

Errors are `{ error: string }`: 400 invalid unsigned positive 32-bit passcode; 401 signed out; 403 not a guild member; 404 unknown engine passcode (even if YGOPRODeck has it); 502 malformed host response; 503 host/membership unavailable. Existing configuration failures retain their usual status. Successful lists use `Cache-Control: private, no-store`.

## Search and details

`POST /api/decks/cards` retains its existing `CardQuery` request and `{ cards, total, offset }` response. Each result is now `DeckCardInfo & { altArtCount: number }` (`CardQueryResult` in `@yugidraft/shared/duels`). `altArtCount` is engine family size minus one; zero means no alternatives. Ordinary search still lists one result per game card. Existing exact alternate-passcode lookups still work and carry the same count.

`POST /api/duels/cards` with `{ codes: number[] }` still returns `{ cards: DeckCardInfo[], missing: number[] }`, up to 1000 codes. Load details for the chosen passcode so deck rendering retains its code. For local alias-aware copy/pool calculations, load **all family members**, including main/intermediate aliases, into the existing identity catalog, or use the artwork response's canonical `passcode`. Do not count each artwork as a separate drafted card. `DeckCardInfo` now has optional `altArtCount?: number`. The details host populates it for each known code using the same engine family index as search (family size minus one, including image-less arts). Deck and cube rows can use it without fetching every artwork list; clients should tolerate its absence from older hosts or locally constructed cards.

## Duel card identity

`DuelCardInfo` now has optional `canonicalPasscode?: number`. Legacy, pinned, and multi engines populate it from the running engine's artwork-family identity: the final matching-name/type alias main, or the card's own `code` when it is not an alternate. Alias chains, missing targets, cycles, and different-name/type aliases follow the identity rules below. The selected artwork passcode stays in `code`.

Visible `DuelCard` snapshots (including materials) also carry `canonicalPasscode`; hidden cards omit it along with their other identity fields. Card info in prompts, events, and Deck Master data comes from the same catalog. Clients can use `card.canonicalPasscode ?? card.code` for signature attack effects and set-piece lookups, while continuing to use `code` for artwork. The optional field permits older hosts and locally constructed card objects.

Destroy events and their corresponding move events also carry optional `sourceCanonicalCode?: number`, the engine artwork-family main of the existing `sourceCode`. Legacy, pinned, and multi populate it for battle/effect sources, including resolving-chain fallback and deferred destruction notes. `sourceCode` keeps the selected source artwork; `card` describes the destroyed card, not the source. Use `event.sourceCanonicalCode ?? event.sourceCode` for destruction signature effects. No source means neither source field is present; an unknown source passcode falls back to itself. Older stored events remain valid without the new field. Source identity follows the existing public `sourceCode` visibility; a hidden victim's card identity remains redacted.

This lets duel consumers resolve identity immediately from the duel payload, including on public lab pages, without fetching the authenticated artworks API or racing that request at duel start. The picker API's authentication remains unchanged.

Targeted regression: `packages/duel-server/tests/card-canonical-passcode.test.ts` loads a synthetic engine catalog and checks alias identity plus legacy, pinned, and multi snapshot projection/redaction, plus immediate/deferred battle and effect destruction sources, resolving-chain fallback, hidden victims, and old event compatibility. It needs no engine bundle or live core:

```bash
prlimit --core=1:1 npm exec --workspace=packages/duel-server -- \
  vitest run tests/card-canonical-passcode.test.ts --config vitest.unit.config.ts
```

## Swap an occurrence in a working deck

`POST /api/decks/artwork` has the same guild/member guard as the artwork list. It validates the source and destination against the running engine's artwork family and returns a new working deck. It does **not** persist or register a deck.

```ts
// Exported from @yugidraft/shared/duels
interface DeckArtworkSwapRequest {
  deck: DuelDeck; // { main: number[], extra: number[], side: number[], deckMaster?: number }
  section: "main" | "extra" | "side" | "deckMaster";
  index: number; // zero-based; Deck Master uses 0
  from: number; // passcode currently at section/index
  to: number;   // requested engine artwork passcode
}
// 200: { deck: DuelDeck }
```

Only that occurrence changes; other copies, order, sections and Deck Master remain as submitted. Source equals destination is a valid no-op. Missing image metadata does not prevent a swap. 400 means invalid body/index or a destination outside the source family; 409 means the source occurrence no longer equals `from`. Unknown source and host failures follow the list endpoint statuses. The UI must avoid applying a late response over more recent local edits. This operation validates artwork identity, not general deck legality; normal save/duel validation still applies.

Persist the returned `deck` through the existing flow:

- Regular new deck: `POST /api/decks` with `{ name, mode, deck }`; 201 `{ deck: SavedDeckView }`.
- Existing deck: `PUT /api/decks/{id}` with `{ name, mode, deck }`; 200 `{ deck: SavedDeckView }`.
- Draft deck: use `saveDraftDeck` in `src/components/decks/api.ts`, passing `{ name, mode: "normal", deck, draftId }`. The helper creates or updates the owned draft deck, handles create-conflict deck IDs, and returns `{ deck: SavedDeckView, warning?: string }`. Existing draft-linked saves keep their pool check even if `draftId` is omitted.

Saved decks retain engine-known chosen art IDs on writes and reads. Legacy catalog IDs missing from the engine may still map to a known canonical engine ID. Draft pool membership resolves **both** submitted deck IDs and drafted IDs through the same artwork identity, including forced-copy allowances. Copies/banlists retain original-card identity; choosing an art gives no additional copies. `.ydk` export keeps the selected IDs through existing `deckYdkText`. Duel import/start already preserves known engine IDs. Tournament registration copies the chosen deck; existing locked registrations are not changed by editing a library deck. An unlocked draft registration follows the existing autosave/registration flow; normal tournament registration still uses `PUT /api/tournaments/{slug}/deck` with `{ savedDeckId }`.

## Cube artwork

`POST /api/cubes/{id}/cards` now accepts:

```json
{ "op": "setArtwork", "catalogCardId": 10, "artworkPasscode": 11 }
```

Both IDs must belong to the engine family. Existing member and cube owner/admin checks apply before engine access. The operation changes the authored cube row's `catalogCardId`, preserves `pool`, `maxCopies`, `source`, and updates its timestamp. It returns the existing `{ pools: CubePools, cards: CardSummary[] }` cube-detail shape. There is no separate display-art column. Engine-only destination IDs get catalog/FK rows marked as engine metadata without fetching YGOPRODeck. An already-present destination row returns 400 rather than merging or overwriting copy counts. Missing source row, engine-unknown source, invalid passcodes and cross-family choices also return 400. A cube referenced by any pending or active draft (assigned through `draft_player_cube` or listed in `config.allowedCubeIds`) returns 409, including no-op swaps. This check and the update share a transaction so changing an artwork cannot reset theme-round consumption. Completed/cancelled drafts do not block swaps. This supports explicit `cube_cards` entries; a legacy config-only card must first be materialized using the existing cube import/replace flow. Previously dealt draft picks are not rewritten.

## Identity and data ownership

`packages/duel-server/src/card-artworks.ts` indexes the running engine's `CardDatabase` (`cards.cdb`). It uses shared `canonicalCardCode`: follow aliases only while name (trimmed/case-insensitive) and engine type match at each edge. A → B → C resolves to C; missing targets stop traversal; cycles fail closed to the requested ID, so cyclic IDs are not offered as interchangeable. Different-name/type aliases (Harpie Lady variants, Normal/Ritual Black Luster Soldier) remain different cards. Missing alternate Lua scripts can fall back to the canonical artwork script (including alias chains); Domain listed-name/series metadata also uses that main script, so a Deck Master art change preserves its Domain. Because the core retains the alternate `self_code`, a fallback main script sees the alternate in `GetID()`. Runtime logs a warning once per requested fallback script per loaded catalog. Weekly candidate engine-data validation scans all artwork families, lists each fallback as a **blocking finding**, and fails validation before publication (even if the separate advisory Lua probe crashes or times out; a failed safety scan also blocks); supply and validate explicit alternate scripts before deploying such a bundle. Existing engine legality checks remain authoritative at duel start.

The signed internal host operation is `{ op: "card-artworks", guildId, playerId, codes: [passcode] }`, returning `CardArtworkFamily` (`{ passcode, artworks: [{ passcode, isMain }] }`). The web route goes through `src/lib/duel-host.ts`; it does not require a local engine DB. It enriches this exact set with `card_artworks` rows of `source = 'api'` by artwork ID, plus validated files in `CARD_IMAGE_CACHE_DIR` (default `./data/card-images`, same as the image route). Image validation results (including missing/invalid files) are cached in memory for 30 seconds, bounded to 2,048 paths, with concurrent reads shared. The first request still fully validates bytes; repeat requests avoid file reads and image decodes. Newly cached or removed files can take up to 30 seconds to change list availability. YGOPRODeck-only IDs can never enter the result.

Engine-only catalog rows use the existing local family main when one is already mapped, in both shared catalog materialization and cube swaps. This keeps local `canonicalId()` consistent even if an earlier API-only sync chose a different main; a later engine-aware full sync reconciles retained engine-only rows along with API rows, preserving their provenance. Local catalog grouping never overrides the host’s engine-family identity.

Internal `normalize-codes` defaults to canonical identity for pool checks. `preserveArtwork: true` instead retains known engine artwork IDs while still resolving legacy external IDs; only storage/display callers request it. Host `check-deck` receives the draft ID so the trusted pool check runs there too.

## One-time backfill

Do not run this as part of a request, deployment, or migration. Use an explicitly chosen, already-migrated database and existing writable directories. No production backfill was run for this change.

```bash
# Use Node 22. From the repo root:
prlimit --core=1:1 npm run build --workspace=packages/shared
DUEL_DATA_DIR=/absolute/path/to/duel-engine prlimit --core=1:1 \
  npm run backfill:artworks --workspace=packages/shared -- \
  --database /absolute/path/to/local-copy.sqlite \
  --dump /absolute/path/to/cardinfo.json \
  --state /absolute/path/to/artworks-state.json --dry-run
# Review the report, then repeat without --dry-run to apply.
```

`--database`, `--dump`, `--state`, and `DUEL_DATA_DIR` resolve relative paths against npm’s `INIT_CWD` (invoke npm from the repo root), or the repository root derived from the script location when invoked directly. Absolute paths are recommended. The default engine directory is `<root>/data/duel-engine`, including under `npm run --workspace=packages/shared`; it is never implicitly `packages/shared/data/duel-engine`. If engine data is absent, existing catalog main evidence and the normal API-ID fallback apply with a warning. Picker membership always comes from the live engine regardless.

The script downloads the full `cardinfo.php` JSON exactly once if the dump file is absent (one request, no retry loop, comfortably below 20 requests/s). It only syncs API families matching existing catalog names/types; each family uses the existing transactional artwork upsert. New artwork rows within those families are inserted; unrelated API cards are not imported. Images are not downloaded or hotlinked. Apply output is `{ synced: number, unmatched: number[] }` (families processed this run and catalog IDs with no matching dump entry). `--dry-run` opens the database read-only, never writes a checkpoint, and returns `{ synced: 0, wouldSync: number, unmatched: number[] }`. It counts eligible families after any existing checkpoint; it does not simulate upsert conflicts. It may download/create the dump once if absent, so retain that exact dump for the apply run.

A checkpoint is atomically written after each committed family and binds the database path, dump SHA-256 and last API ID. Run the same command to resume offline using the same dump/state. A crash between commit and checkpoint safely repeats that idempotent family. Keep the DB, dump and state together; do not replace the database at the checkpoint's path. Use a new state file to rerun against an expanded/repaired catalog, and new dump/state paths to refresh upstream metadata. Do not run two backfills concurrently. Metadata conflicts continue to use the catalog service's warning/skip behavior. `unmatched` rows remain untouched.


## Production procedure — run only with owner go

**Do not execute any production step without explicit owner go.** This procedure is documentation only; no production backfill has been run. Never attach the backfill to deployment or a migration.

1. Deploy the reviewed code first and confirm the artwork migration is already present. Use the bot container’s Node 22 and compiled shared CLI against `/app/data/bot.sqlite`. Confirm `/app/data/duel-engine/cards.cdb` is the exact deployed duel-host bundle (compare its manifest/bundle version with the duel container); mount that deployed directory read-only if it is not visible to the bot. Do not prepare, update or replace engine data for this operation. Pause other catalog sync/backfill jobs and choose a quiet window; run only one backfill.
2. Create a fresh writable operation directory, for example `/app/data/artwork-backfill-YYYYMMDD`. Take an online SQLite backup with `better-sqlite3`’s `backup()` API (or the existing WAL-aware backup tooling), and retain it outside the live database path. Do **not** copy just `bot.sqlite` while writers are active: committed rows may still be in its WAL. Example inside the bot container, after choosing the operation directory:

   ```js
   // node --input-type=module (Node 22)
   import Database from "better-sqlite3";
   const db = new Database("/app/data/bot.sqlite", { readonly: true, fileMustExist: true });
   try { await db.backup("/app/data/artwork-backfill-YYYYMMDD/before.sqlite"); }
   finally { db.close(); }
   ```

3. Run the dry run first, inside the bot container from `/app`. Set a core-file limit (`prlimit --core=1:1`, or `ulimit -c 1` in the container shell if `prlimit` is unavailable). Use explicit paths:

   ```bash
   DUEL_DATA_DIR=/app/data/duel-engine prlimit --core=1:1 \
     node packages/shared/dist/maintenance/backfill-card-artworks.js \
     --database /app/data/bot.sqlite \
     --dump /app/data/artwork-backfill-YYYYMMDD/cardinfo.json \
     --state /app/data/artwork-backfill-YYYYMMDD/state.json --dry-run
   ```

   Record the report, review `wouldSync` and `unmatched`, and stop if there is a missing-engine warning or an unexpected candidate count. Preserve the dump. With owner go still in effect, repeat the identical command without `--dry-run` to apply.
4. Each family is upserted in a short SQLite transaction; no write transaction spans the download or the whole backfill. The existing database journal mode is retained, foreign keys are enabled, and lock waits are bounded to five seconds. Normal WAL readers can continue. Stop on lock errors or unexpected warnings and investigate; rerun with the same database/dump/state to resume after the last committed checkpoint. Do not loop retries or remove the live WAL/SHM files.
5. Verify with a read-only connection: `PRAGMA quick_check` must report `ok`; `PRAGMA foreign_key_check` must return no violations. Record `select source, count(*) from card_artworks group by source`; spot-check family membership and one main per family with `select card_id from card_artworks group by card_id having sum(is_main) != 1`. Run the same CLI with `--dry-run` again: `wouldSync` should be zero for the completed checkpoint; review remaining `unmatched` IDs. Check known main/alternate cards through authenticated artwork and card-details endpoints and confirm deck/cube passcodes remain selected. Retain the backup, dump, state, bundle version and reports together. If rollback is necessary, coordinate an owner-approved maintenance window and restore through the normal SQLite restore procedure; do not overwrite a database with active writers.

Review note L4 (for later PR text): draft tournaments now receive the host pool check at series start because `duel-host.ts` sends `draftId`; no additional L4 code change was needed.


The targeted engine regression is `packages/duel-server/tests/engine-artwork-start.test.ts`: it starts legacy Standard 1v1, pinned Standard 1v1, and FFA3 with decks containing `46986415`, `36996508`, and `27847700`, asserting startup without missing-script errors. It belongs to the engine suite, not the unit suite; `DUEL_REQUIRE_CORES=1` makes missing data/cores fail in CI. When an existing local bundle is available, run only this file from `packages/duel-server`:

```bash
DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 prlimit --core=1:1 \
  npx vitest run tests/engine-artwork-start.test.ts --testTimeout=15000
```
