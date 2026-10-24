# Pre-release cards in the catalog

The shared catalog can use the read-only engine bundle when YGOPRODeck has no card. Set `DUEL_DATA_DIR` to the same prepared bundle in web, worker and duel-server. Without that variable, the catalog looks for `duel-engine` beside the application SQLite file. No remote engine request is required.

The fallback accepts OCG, TCG and pre-release engine rows with text. It excludes tokens and rows limited to other formats. It reads name, description, type, attribute, race, Level/Rank/Link Rating, ATK/DEF and setcodes. `strings.conf` supplies mapped archetype names. Link arrows do not become DEF. The catalog stores provenance in `catalog_source` and the engine pre-release bit in `is_prerelease`; temporary passcode length is not release evidence.

Search, exact names, name lists, passcodes and YDK imports persist catalog rows before cubes or drafts write foreign keys. The type and frame identify Extra Deck cards. Engine rows use the application image route. Engine artwork variants, including a missing crop, can fall back to full Ignis art. API artwork with a missing crop tries the main-art crop instead. The fallback keeps its own cache and shorter lifetime so later official images can replace it.

API upserts replace engine metadata and retain the engine pre-release flag for each artwork passcode. Set sync does not delete other catalog rows. Custom-pool sync retries engine-source cards and retains usable engine data during an API outage. Alternate artwork families keep one canonical card in draft pool results. When the API publishes an official passcode before the bundle remaps the temporary one, matching names keep the temporary card out of automatic pools, archetype seeds and search results.

On engine startup, the existing validated remap artifact moves cube and draft references to released passcodes. Cube collisions combine copies up to the existing limit. Missing target catalog rows get current engine metadata; existing API targets retain their metadata. Later API sync replaces provisional target metadata. The old catalog row is removed after references move. Finished duel history stays unchanged.

## Verification

Use Node 22 and build shared before consumers. Prepare a real bundle, then run only the relevant integration file:

```sh
DUEL_DATA_DIR="$PWD/data/duel-engine" npx vitest run packages/duel-server/tests/prerelease-catalog.test.ts
```

This suite uses a temporary SQLite file, the real CDB and its real graduation map. Only the upstream API responses are controlled. It covers Main/Extra draft dealing, cold offline names, preview artwork search, API refresh, graduation collisions and foreign key checks. CI runs it with the engine integration suites; a missing CDB fails in required-engine mode.

The isolated browser fixture makes YGOPRODeck report no match and serves Ignis fallback art. It has no effect unless explicitly enabled:

```sh
E2E_SLOT=8 E2E_DUEL_DATA_DIR="$PWD/data/duel-engine" npm run stack:build --workspace=packages/e2e
E2E_SLOT=8 E2E_DUEL_DATA_DIR="$PWD/data/duel-engine" E2E_PRERELEASE_CATALOG=1 E2E_WORKERS=1 npx playwright test 'prerelease-cubes.spec.ts' -c packages/e2e/playwright.config.ts
```

Set `E2E_SCREENSHOT_DIR` for WebP evidence. Set `E2E_CARD_IMAGE_SOURCE_DIR` to local `<passcode>.jpg` files to use real Ignis art in screenshots; the default fixture is a tiny valid JPEG. The spec checks 1920×1080, 1366×768 and 390×844.
