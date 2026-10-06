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

`POST /api/duels/cards` with `{ codes: number[] }` still returns `{ cards: DeckCardInfo[], missing: number[] }`, up to 1000 codes. Load details for the chosen passcode so deck rendering retains its code. For local alias-aware copy/pool calculations, load **all family members**, including main/intermediate aliases, into the existing identity catalog, or use the artwork response's canonical `passcode`. Do not count each artwork as a separate drafted card. Do not assume `DeckCardInfo` from the details endpoint contains `altArtCount`.

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

`packages/duel-server/src/card-artworks.ts` indexes the running engine's `CardDatabase` (`cards.cdb`). It uses shared `canonicalCardCode`: follow aliases only while name (trimmed/case-insensitive) and engine type match at each edge. A → B → C resolves to C; missing targets stop traversal; cycles fail closed to the requested ID, so cyclic IDs are not offered as interchangeable. Different-name/type aliases (Harpie Lady variants, Normal/Ritual Black Luster Soldier) remain different cards. Missing alternate Lua scripts can fall back to the canonical artwork script (including alias chains); Domain listed-name/series metadata also uses that main script, so a Deck Master art change preserves its Domain. Existing engine legality checks remain authoritative at duel start.

The signed internal host operation is `{ op: "card-artworks", guildId, playerId, codes: [passcode] }`, returning `CardArtworkFamily` (`{ passcode, artworks: [{ passcode, isMain }] }`). The web route goes through `src/lib/duel-host.ts`; it does not require a local engine DB. It enriches this exact set with `card_artworks` rows of `source = 'api'` by artwork ID, plus validated files in `CARD_IMAGE_CACHE_DIR` (default `./data/card-images`, same as the image route). YGOPRODeck-only IDs can never enter the result.

Engine-only catalog rows use the existing local family main when one is already mapped, in both shared catalog materialization and cube swaps. This keeps local `canonicalId()` consistent even if an earlier API-only sync chose a different main; a later engine-aware full sync can reconcile it. Local catalog grouping never overrides the host’s engine-family identity.

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
  --state /absolute/path/to/artworks-state.json
```

`DUEL_DATA_DIR` is optional but recommended to identify canonical engine mains during sync; the CLI resolves its relative value from the current working directory. Without it, existing catalog main evidence and the normal API-ID fallback apply. Picker membership always comes from the live engine regardless.

The script downloads the full `cardinfo.php` JSON exactly once if the dump file is absent (one request, no retry loop, comfortably below 20 requests/s). It only syncs API families matching existing catalog names/types; each family uses the existing transactional artwork upsert. New artwork rows within those families are inserted; unrelated API cards are not imported. Images are not downloaded or hotlinked. Output is `{ synced: number, unmatched: number[] }` (families processed this run and catalog IDs with no matching dump entry).

A checkpoint is atomically written after each committed family and binds the database path, dump SHA-256 and last API ID. Run the same command to resume offline using the same dump/state. A crash between commit and checkpoint safely repeats that idempotent family. Keep the DB, dump and state together; do not replace the database at the checkpoint's path. Use a new state file to rerun against an expanded/repaired catalog, and new dump/state paths to refresh upstream metadata. Do not run two backfills concurrently. Metadata conflicts continue to use the catalog service's warning/skip behavior. `unmatched` rows remain untouched.
