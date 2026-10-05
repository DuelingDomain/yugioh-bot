# Card artwork audit

Audit date: 2026-10-04. Base: `062c033c`. The source database and image cache were read only.

## Findings before the fix

The source database has **2,048 catalog rows**. It has no artwork table and stores no crop URLs. Every stored full-image filename matches its row ID: **0 wrong URL-to-ID mappings**.

By normalized name and card type, **5 cards have more than one stored artwork** (10 rows): Barrel Dragon, Blue-Eyes White Dragon, Dark Magician, Monster Reborn and Red-Eyes Black Dragon.

The engine's same-name, same-type alias rule identifies **99 artwork families** in the catalog. Of 8 engine alternate rows, **4 have no main row**: Harpie's Feather Duster `18144507 → 18144506`, Blue-Eyes Ultimate Dragon `23995347 → 23995346`, Dark Magician Girl `38033124 → 38033121`, and Clear Wing Synchro Dragon `82044280 → 82044279`. There are **95 main rows with missing alternate rows**, with **151 missing engine alternate IDs**. These are engine counts, not a claim that all engine images exist on YGOPRODeck. The engine does not contain Barrel Dragon `81480461`, for example. A complete count of released API artwork families cannot be recovered from this old database without a full metadata sync.

All 190 distinct cube IDs and 139 distinct draft IDs have a catalog row. Six cube IDs and four draft IDs are engine alternate passcodes. Engine passcodes and imported YDK IDs can reach the UI without a catalog row. Of the API artworks in the three examples below, **13 of 19 have no catalog row**.

## Live examples

The live API's exact-name response can use the newest alternate passcode as the card ID. It does **not** always use the original passcode. An ID response can contain only one artwork: `id=81480460` returns only `81480460`. Exact-name lookup returns both. Storing every image in an ID response alone is therefore insufficient.

| Card | Main ID | Exact-name API card ID | All exact-name API artwork IDs | Stored IDs |
| --- | --- | --- | --- | --- |
| Barrel Dragon | 81480460 | 81480461 | 81480461, 81480460 | 81480460, 81480461 |
| Blue-Eyes White Dragon | 89631139 | 89631146 | 89631146, 89631145, 89631144, 89631143, 89631139, 89631140, 89631141, 89631142 | 89631139, 89631146 |
| Dark Magician | 46986414 | 46986421 | 46986421, 46986414, 46986420, 36996508, 46986419, 46986418, 46986417, 46986416, 46986415 | 36996508, 46986414 |

Barrel Dragon's main image exists in this local database and cache. The owner's report is explained by exact-name/set sync selecting `81480461`, then using only the first image. Blue-Eyes `89631146` is used in one local cube and one draft row; its original is not selected there. Dark Magician's local draft uses its main ID. A name sync instead selects `46986421`, which has no local row yet.

Six image HEAD checks downloaded no images: Barrel Dragon `81480460` and `81480461` returned 200; Blue-Eyes `89631147` returned 200 although absent from the exact-name API list. An additional metadata check for `id=89631147` returned 400. Blue-Eyes `89631133`, Dark Magician `46986409` and `46986423` returned 404. The engine lists these last three as alternate IDs. The current route falls back to the engine alias, so it can display the main image for such IDs. API artwork IDs and engine artwork IDs are not identical sets. A filtered Metal Raiders query for Barrel Dragon returned both image IDs, with duplicate image records. Sync must deduplicate by artwork ID.

Sources: [API guide](https://ygoprodeck.com/api-guide/), [Barrel Dragon by name](https://db.ygoprodeck.com/api/v7/cardinfo.php?name=Barrel%20Dragon), [Blue-Eyes and Dark Magician by name](https://db.ygoprodeck.com/api/v7/cardinfo.php?name=Blue-Eyes%20White%20Dragon%7CDark%20Magician), [Barrel Dragon by main ID](https://db.ygoprodeck.com/api/v7/cardinfo.php?id=81480460). The API guide defines the four image fields. The card IDs and ordering above were checked directly with curl.

## Current data flow

| Path | Storage, resolution and display |
| --- | --- |
| Catalog | `services/card-catalog.ts` inserts `card.id` and `card_images[0]`. It drops all other IDs and crops. `findByIds` only accepts an exact catalog row. Set previews repeat first-image selection. |
| Image route | `web/app/api/cards/[passcode]/image/route.ts` builds the image URL from the requested ID. It caches full JPG and small JPG separately. After a 404 it asks the duel host for an alias and caches that image under the requested ID. It does not use catalog URLs. |
| Draft packs | `services/drafts.ts` enumerates catalog rows by sets/names or explicit IDs. Every stored alternate row can become a separate random option. Draft views use stored full/small URLs; bot images cache resized PNGs by passcode. |
| Deck editor | Engine search supplies data from `cards.cdb`. CardArt and previews request the image route by code. Draft pool data comes from catalog rows and may miss engine alternate IDs. |
| Duel views | CardFace, strips, readers, moves and 3D textures use engine codes with `cardArtUrl`. Engine data exists separately from the shared catalog. The image route can show an image even with no shared catalog row. |
| YDK import | Parsers preserve passcodes. Cube import uses catalog lookup then ID sync, and stores the original ID. Deck import uses engine data. |
| YDK export | Cube export retains IDs. Draft exports use picked IDs. Draft deck builders and web YDK generation count equal names and types together. The engine's `canonicalCardCode` follows aliases only for equal name and numeric type, preserving unrelated aliases. |
| Search | Shared fuzzy/name search can choose the alternate API card ID. Engine search hides same-name/type artwork rows from general results and archetype counts. This keeps one result per game card. |
| Crops and FX | No crop route or shared crop field exists. This branch has no coin-toss component that uses the two requested crops. The later coin-toss task can use `/api/cards/89631139/image?variant=cropped` and `/api/cards/46986414/image?variant=cropped`. |

## Fix design and work plan

Use a `card_artworks` table with canonical card ID, artwork ID, full/small/crop URLs, main flag and metadata source (`api` or `engine`). Keep catalog rows for individual artwork IDs so existing foreign keys, draft snapshots and exports remain valid. The main row uses the engine's validated original artwork where available. Load engine identity read only, with relative paths based on the repository root. If the API's newest ID is absent from the engine, resolve its image IDs instead. Keep a stored main mapping when new engine evidence is absent. Use the API ID as fallback when no original can be proven.

Do not create new random draft options for every alternate. Automatic set/name pools use only main rows; explicit alternate IDs remain valid. All sync paths store supplied artwork metadata. An ID sync also queries the exact name because the ID endpoint can omit alternates. Existing custom cards without artwork metadata refresh on their next sync. Preserve known artwork records when a narrower response arrives.

Migration creates missing main catalog rows from validated engine alternate rows, without changing old rows or fetching images. These rows still need artwork metadata on their next sync. This keeps the four alternate-only families available in default pools. Explicit engine-only IDs get durable mappings and catalog rows before a cube or draft writes foreign keys. `listArtworks` returns API artwork records, main first; it excludes engine-only records whose image availability is unproven. Direct requests still try each engine artwork's own URL and then the main image if it is missing. The broader image fallback for unrelated aliases remains separate from game identity.

ID and name responses are merged by artwork field. An ID-specific crop takes precedence; a missing crop retains the name response's crop. Printing sets and earlier crops survive a narrower sync. The shared artwork identity uses the unchanged `canonicalCardCode` name/type rule. The duel host also maps imported API IDs absent from the engine by catalog card name in `deck-import.ts`.

1. Add real three-card fixtures and failing catalog/migration tests. Add the table and shared artwork identity/list helpers. Verify migration preserves old rows and references.
2. Update catalog sync, main selection, alias data resolution, ID enrichment, set previews and automatic draft pools. Test main-first ordering, alternate identity, copy limits and repeat syncs. Commit the data fix.
3. Add `variant=cropped` to the image route. Select URLs by artwork ID. Preserve lazy cache reads, distinct variant filenames, missing-image fallback and bot size cleanup. Test main, alternate, small, crop and cache isolation. Commit the route fix.
4. Build shared inside this worktree. Make consumers resolve that build locally. Run targeted shared, web and bot tests and all three package type checks. Review changes, record results and remove build/test files. Do not push.

## Later Sonnet UI task

Add an art picker using `catalog.listArtworks(id)` (main first). Keep game identity and image selection separate. Candidate spots: deck editor card previews and rows; draft cards, room reader and hover popup; cube grids and card pool sheets; duel CardFace, CardStrip, move FX and 3D texture loader. Add cropped art to the later coin toss. Review signature FX/audio lookups in `attack-styles.ts`, `attack-audio.ts` and `fx3d/effects/battle.ts` for alternate passcodes. No picker is in this task.

## Validation results

All checks used Node 22.23.3 and `TMPDIR=/dev/shm`. Shared was built in this worktree. Temporary package links made web, bot and the duel-server test helpers use this build instead of the main checkout's old dist. The links were restored and the worktree build was removed after checks.

| Check | Result |
| --- | --- |
| Targeted shared tests | 250 tests passed in 11 files. Includes all three live fixtures, migration, identity, copy limits, draft pools, cube imports and image rendering. |
| Targeted web tests | 73 tests passed in 7 files. Includes main/alternate/cropped images, variant cache isolation, missing crops, transient errors, physical catalog rows, card resolution, draft deck pools and YDK export. |
| Targeted bot tests | 19 tests passed in 3 files. Includes catalog, images and cache cleanup for full/alternate/small/cropped files. |
| TypeScript | Shared, web and bot passed. Web used `--incremental false` to avoid a disk cache. |
| Shared build | Passed. |
| Local database copy | Repeated migration changed 2,048 rows to 2,052 by adding the four missing main rows. Syncing the three recorded live responses and engine-only Blue-Eyes `89631147` gave 2,066 catalog rows, 19 API artwork mappings and 1 engine mapping. No foreign-key errors. Cube and draft reference counts stayed the same. |
| Image downloads | Zero. API JSON and six image HEAD checks only. |

Commands:

```sh
export TMPDIR=/dev/shm
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
npm run build --workspace=packages/shared
node node_modules/vitest/vitest.mjs run packages/shared/tests/services/card-artworks.test.ts packages/shared/tests/services/card-catalog.test.ts packages/shared/tests/services/card-catalog-archetype.test.ts packages/shared/tests/db/schema.test.ts packages/shared/tests/services/cubes.test.ts packages/shared/tests/services/cubes-replace-main.test.ts packages/shared/tests/services/drafts.test.ts packages/shared/tests/services/drafts-copy-cap.test.ts packages/shared/tests/services/draft-decks.test.ts packages/shared/tests/duels/pool.test.ts packages/shared/tests/services/card-images.test.ts
node node_modules/vitest/vitest.mjs run packages/web/tests/cards-resolve-route.test.ts packages/web/tests/cards-image-route.test.ts packages/web/tests/cube-pool-artworks.test.ts packages/web/tests/drafts-deck-pool-route.test.ts packages/web/tests/ydk.test.ts packages/web/tests/cubes-pool-route.test.ts packages/web/tests/draft-pool-api.test.ts -c packages/web/vitest.config.ts
node node_modules/vitest/vitest.mjs run packages/bot/tests/services/card-catalog.test.ts packages/bot/tests/services/draft-images.test.ts packages/bot/tests/services/draft-cleanup.test.ts
npm run typecheck --workspace=packages/shared
npm run typecheck --workspace=packages/web -- --incremental false
npm run typecheck --workspace=packages/bot
```

The source database and source image cache were not changed. A full live metadata sync was not run. Each card's complete API artwork list is backfilled on its next set, archetype, name or ID sync. Engine-only IDs are resolved for data and direct images, but are excluded from the later art picker until the API supplies an artwork record.

Changed files:

- Shared data: `src/db/schema.ts`, `src/services/card-artworks.ts`, `src/services/card-catalog.ts`, `src/services/cubes.ts`, `src/services/drafts.ts`, `src/services/index.ts`, `src/types/index.ts`.
- Shared tests: `tests/fixtures/card-artworks.json`, `tests/services/card-artworks.test.ts`, `tests/services/card-catalog.test.ts`, `tests/services/cubes.test.ts`.
- Web: `app/api/cards/[passcode]/image/route.ts`, `app/api/cards/resolve/route.ts`, `src/lib/cube-pool.ts`, and tests `cards-image-route`, `cards-resolve-route`, `cube-pool-artworks`, `cubes-pool-route`.
- Bot: `tests/services/draft-cleanup.test.ts`.
- Report: `docs/design/card-art/audit.md`.
