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

Six image HEAD checks downloaded no images: Barrel Dragon `81480460` and `81480461` returned 200; Blue-Eyes `89631147` returned 200 although absent from the exact-name API list. Blue-Eyes `89631133`, Dark Magician `46986409` and `46986423` returned 404. The engine lists these last three as alternate IDs. The current route falls back to the engine alias, so it can display the main image for such IDs. API artwork IDs and engine artwork IDs are not identical sets.

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

Use a `card_artworks` table with canonical card ID, artwork ID, full/small/crop URLs and main flag. Keep catalog rows for individual artwork IDs so existing foreign keys, draft snapshots and exports remain valid. The main row uses the engine's validated original artwork where available. Load engine identity read only. If the API's newest ID is absent from the engine, resolve its image IDs instead. Keep the API ID as fallback when no original can be proven.

Do not create new random draft options for every alternate. Automatic set/name pools use only main rows; explicit alternate IDs remain valid. All sync paths store supplied artwork metadata. An ID sync also queries the exact name because the ID endpoint can omit alternates. Existing custom cards without artwork metadata refresh on their next sync. Preserve known artwork records when a narrower response arrives.

1. Add real three-card fixtures and failing catalog/migration tests. Add the table and shared artwork identity/list helpers. Verify migration preserves old rows and references.
2. Update catalog sync, main selection, alias data resolution, ID enrichment, set previews and automatic draft pools. Test main-first ordering, alternate identity, copy limits and repeat syncs. Commit the data fix.
3. Add `variant=cropped` to the image route. Select URLs by artwork ID. Preserve lazy cache reads, distinct variant filenames, missing-image fallback and bot size cleanup. Test main, alternate, small, crop and cache isolation. Commit the route fix.
4. Build shared inside this worktree. Make consumers resolve that build locally. Run targeted shared, web and bot tests and all three package type checks. Review changes, record results and remove build/test files. Do not push.

## Later Sonnet UI task

Add an art picker using `catalog.listArtworks(id)` (main first). Keep game identity and image selection separate. Candidate spots: deck editor card previews and rows; draft cards, room reader and hover popup; cube grids and card pool sheets; duel CardFace, CardStrip, move FX and 3D texture loader. Add cropped art to the later coin toss. Review signature FX/audio lookups in `attack-styles.ts`, `attack-audio.ts` and `fx3d/effects/battle.ts` for alternate passcodes. No picker is in this task.
