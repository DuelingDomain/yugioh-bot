# Card fetch review fixes

Branch: `fix/card-alt-art-mapping`. Base: `f51fa81e`. Date: 2026-10-04.

Both blockers and the image host check are fixed. No push or merge was made.

## Commits

| Commit | Change |
| --- | --- |
| `cb759dc7` | Resolve engine data from the runtime path. |
| `2478d72a` | Use legacy rows without artwork calls. Cache Extra Deck artworks. |
| `dbe62b53` | Bound all card calls. Use cache on failure. Respect Retry-After. |
| `ddc4eb48` | Use cached images or card backs for bot grids and picks. |
| `00ebd682` | Validate image hosts and bytes. Use temporary image fallbacks. |
| `6ccb833c` | Keep bot fetch errors and failed replies contained. |
| `b48c4949` | Return a safe retry response for duel catalog failures. |
| `86be9b32` | Return clear 503 responses from web card actions. |
| `6795f90b` | Use the image cache for draft and cube artwork. Keep artwork passcodes. |
| `ec92636c` | Use the same image cache on login. Disable the separate Next image fetch path. |

This report is in a separate documentation commit.

## Review blockers

Engine identity now uses `DUEL_DATA_DIR`, with `process.cwd()/data/duel-engine` as the default. There is no `new URL(literal, import.meta.url)` in this path.

Web and bot compose services set `DUEL_DATA_DIR=/app/data/duel-engine`. The Dockerfile, engine installer and deployment bundle use this shared data volume. The installer puts `cards.cdb` in that directory.

If engine identity is absent, the service warns once. It uses the lowest artwork passcode when it has no proven main mapping. A prior proven mapping stays valid. Tests cover Barrel Dragon: `81480461` cannot replace `81480460` as main.

An existing catalog row does not need artwork rows to serve a user action. Normal set sync fills artwork rows from bulk `card_images`. A 100-card legacy cube makes zero calls, with zero calls in flight. Three syncs of a new Extra Deck card make two calls in total; later syncs use its saved artwork rows. A legacy engine alternate can use its cached parent without any call.

The transport permits four active calls and spaces starts by 125 ms: eight starts per second per process. It uses an eight-second timeout for the request and response body. It cancels unused error bodies. A 429 sets a per-host cooldown from Retry-After, as seconds or an HTTP date. Calls fail fast during that cooldown.

Stored image URLs must have the exact `https://images.ygoprodeck.com` origin. Credentials and redirects are not allowed. Image bytes must decode before the web cache saves them. Card backs are never saved under a card passcode. An alternate's cached parent image, used after a transient error, has a 30-second cache time and does not replace the alternate's durable cache.

## Fetch failures

All paths below use the shared timeout, call limit and 429 cooldown. Tests cover network failure, timeout and 429. Tests also cover 5xx and bad JSON or invalid image bytes where those apply.

| Path | Cached data | No cache |
| --- | --- | --- |
| `fetchCardsWith`; ID and name sync | Use the catalog row. Optional family enrichment can fail safely. | Raise a typed, short retry error. Callers contain it. |
| Card search: exact, fuzzy and numeric; `/api/cards/resolve` | Return matching cached rows. | Return 503 and a retry message. |
| `syncByArchetype`; `/api/archetypes` | Use cached archetype rows or cached list. | Return 503 and a retry message. |
| Set sync; `/api/sets`; `/api/sets/[name]` | Use cached sets or cached set cards. | Return 503 and a retry message. |
| `syncDraftPool`; draft create, update and start | Use legacy custom rows or cached set/name rows. Extra Deck rows stay saved. | Web returns 503. Bot sends a short error and stays running. |
| Cube import, cube create/save and theme cube fill | Use cached rows, including engine alternate rows. Keep valid foreign keys. | Return 503 and a retry message. No stack trace. |
| `/api/cards/[passcode]/image`, full/small/cropped | Use the cached image, or a temporary cached alias image. | Return a card-back image with HTTP 200 and a 30-second cache time. |
| Web draft, cube, deck and duel images; login images | Use the local image cache route. | Show the same short-lived card back. The separate Next optimizer is disabled. |
| Bot draft grids, labeled cards, pool images and picks | Use cached PNG images. | Render card backs. Do not fail the draft or pick. |
| Bot commands, buttons and autocomplete | Use cached catalog data. | Send a short retry reply or an empty autocomplete list. Failed error replies cannot escape the event listener. |
| Duel deck import and card lookup | Use catalog rows or engine data. | Return a clear 503 for an unavailable catalog lookup. The host stays usable; running duels do not fetch catalog data for actions. |

## Tests

All runs used Node `v22.23.3`, `TMPDIR=/dev/shm`, and Vitest `--maxWorkers=2`.

| Package | Test files | Tests | Result |
| --- | ---: | ---: | --- |
| Shared | 7 | 232 | PASS |
| Web | 30 | 623 | PASS |
| Bot | 5 | 121 | PASS |
| Duel server | 3 | 58 | PASS |
| Total | 45 | 1034 | PASS |

Shared: `card-fetch`, `card-fetch-paths`, `card-artworks`, `card-catalog`, `card-catalog-archetype`, `card-images`, and `cubes` service tests.

Web: card API failure matrix; image route and URL tests; resolve; cube pool, import and save; draft create, update and cube fill; draft pick and pool model; changed card, draft room and login components; public route and guild auth tests; theme response, theme lobby, read access and cube lobby tests.

Bot: card catalog, draft images, fetch error replies, buttons and command handlers.

Duel server: host, deck import and deck alias import. These tests used the installed engine bundle at `/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/duel-engine-next`. The bundle was read only.

`npm run typecheck --workspace=packages/shared`, `packages/web`, `packages/bot` and `packages/duel-server`: all PASS. The final web type check ran after the last source change. `git diff --check`: PASS.

## Production build

The worktree shared build passed first. Node resolved `@yugidraft/shared/services` to this worktree's `packages/shared/dist/services/index.js`.

Command:

```sh
TMPDIR=/dev/shm \
PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH \
DATABASE_PATH=/dev/shm/altart-next-build.sqlite \
npm run build --workspace=packages/web
```

Result: PASS, exit 0. Turbopack compiled, TypeScript passed, and standalone packaging completed. The existing dynamic file tracing warning in `next.config.ts` remains. The missing engine path asset error is gone.

After all checks, `.next`, shared `dist`, web `tsconfig.tsbuildinfo`, and the build test database were removed. The generated `next-env.d.ts` change was restored. No build output is committed.

## Files

Changed files from the review base, excluding this report:

```text
docker-compose.yml
packages/bot/src/index.ts
packages/bot/src/interactions/errors.ts
packages/bot/tests/commands/handlers.test.ts
packages/bot/tests/interactions/fetch-errors.test.ts
packages/bot/tests/services/card-catalog.test.ts
packages/bot/tests/services/draft-images.test.ts
packages/duel-server/src/host.ts
packages/duel-server/tests/deck-import.test.ts
packages/duel-server/tests/host.test.ts
packages/shared/src/services/card-artworks.ts
packages/shared/src/services/card-catalog.ts
packages/shared/src/services/card-fetch.ts
packages/shared/src/services/card-images.ts
packages/shared/src/services/cubes.ts
packages/shared/src/services/index.ts
packages/shared/tests/services/card-artworks.test.ts
packages/shared/tests/services/card-catalog.test.ts
packages/shared/tests/services/card-fetch-paths.test.ts
packages/shared/tests/services/card-fetch.test.ts
packages/shared/tests/services/card-images.test.ts
packages/shared/tests/services/cubes.test.ts
packages/web/app/(auth)/login/login-ring.tsx
packages/web/app/(auth)/login/login-wall-model.ts
packages/web/app/api/archetypes/route.ts
packages/web/app/api/cards/[passcode]/image/route.ts
packages/web/app/api/cards/resolve/route.ts
packages/web/app/api/cubes/[id]/cards/route.ts
packages/web/app/api/cubes/route.ts
packages/web/app/api/drafts/[slug]/cubes/route.ts
packages/web/app/api/drafts/[slug]/helpers.ts
packages/web/app/api/drafts/[slug]/route.ts
packages/web/app/api/drafts/route.ts
packages/web/app/api/sets/[name]/route.ts
packages/web/app/api/sets/route.ts
packages/web/next.config.ts
packages/web/src/components/cards/card-art.tsx
packages/web/src/components/cards/card-pool-grid.tsx
packages/web/src/components/cubes/cube-add-rail.tsx
packages/web/src/components/cubes/cube-card-grid.tsx
packages/web/src/components/cubes/cube-inspector.tsx
packages/web/src/components/draft/card-hover-popup.tsx
packages/web/src/components/draft/card-preview.tsx
packages/web/src/components/draft/create/pool-preview.tsx
packages/web/src/components/draft/draft-card-preview.tsx
packages/web/src/components/draft/draft-summary-view.tsx
packages/web/src/components/draft/pool/pool-bits.tsx
packages/web/src/components/draft/pool/pool-model.ts
packages/web/src/components/draft/room/binder.tsx
packages/web/src/components/draft/room/card-img.tsx
packages/web/src/components/draft/room/draft-room.tsx
packages/web/src/components/draft/room/finale.tsx
packages/web/src/components/draft/room/tray.tsx
packages/web/src/lib/auth.ts
packages/web/src/lib/card-fetch-errors.ts
packages/web/src/lib/card-image-url.ts
packages/web/src/lib/cube-pool.ts
packages/web/src/lib/hooks/use-pool-image-prefetch.ts
packages/web/tests/auth-public-routes.test.ts
packages/web/tests/card-api-failures.test.ts
packages/web/tests/card-image-url.test.ts
packages/web/tests/cards-image-route.test.ts
packages/web/tests/cards-resolve-route.test.ts
packages/web/tests/components/card-art.test.tsx
packages/web/tests/components/draft-card-preview.test.tsx
packages/web/tests/components/home/login-wall-model.test.ts
packages/web/tests/components/home/login-wall.test.tsx
packages/web/tests/components/home/login.test.tsx
packages/web/tests/cube-pool-artworks.test.ts
packages/web/tests/cubes-pool-route.test.ts
packages/web/tests/cubes-route.test.ts
packages/web/tests/drafts-cubes-route.test.ts
packages/web/tests/drafts-theme-response.test.ts
```
