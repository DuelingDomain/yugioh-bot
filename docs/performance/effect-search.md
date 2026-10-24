# Effect search review verification

Date: 2026-10-18. Branch: `feat/effect-search`. Review base: `ab7f1d1f6`.
Node: 22.23.3. All measurements below are local.

The seed index now loads on the first preview. Web startup does not build it.
A separate effect revision tracks tags, profiles, releases and archetypes.
The key also tracks the engine database, names, remaps and manifest. Catalog,
artwork and set writes keep the current snapshot available. One disposable
process refreshes it in the background, at most once a minute. Current artwork
identity and cube exclusions apply before each preview. Effect-data changes
wait for fresh data. They do not serve old tags or release dates.

**Web memory is a material cost.** In the local production build, web RSS rose
by **130.7 MiB** after the cold preview. After a catalog refresh it was
**211.9 MiB** above the pre-preview value. The sampled web-plus-helper peak
was **631.4 MiB**. These values include allocator capacity and temporary
construction data. They are separate from the earlier duel-server savings.
The production VM check is still open: a read-only SSH attempt to the documented
VM was denied. The local check does not satisfy that pre-merge check.

## Preview timing

The integration benchmark opens the source database read-only. It backs it up
to a temporary disk database and expands that copy from the read-only engine.
The copy has 13,702 real card rows. The cold measurement includes preparation
and the first preview. The catalog-write case changes `card_catalog` between
two previews and uses a new request key.

| Current integration measurement | Time |
| --- | ---: |
| Preparation in the helper | 5,102 ms |
| Cold preparation plus first preview | 5,651 ms |
| Uncached p95, 40 phrase/era combinations, 180 rows | 284.3 ms |
| Cached p95, 40 requests | 0.501 ms |
| First preview after a catalog write | 202.1 ms |
| Background catalog refresh | 5,512 ms |
| Effect-revision change plus preparation and first preview | 5,385 ms |

Raw results: `.status/effect-search/review-seed.json`. CPU load affects these
local timings. Preparation is outside the web event loop. Loading the completed
snapshot and selecting results still use the web process.

The old 6,424 ms value was one cold synchronous preview. The earlier 90.9 ms
value was a warm, uncached p95 after a separate 4,422 ms preparation. They are
different measures and must not be presented as a cold-to-p95 speed comparison.
The earlier first preview plus preparation was about 4,533 ms. None of those
samples measured a catalog write between previews.

The preview cache lasts five minutes and holds at most 64 results per snapshot.
Its key includes the current metadata revision, phrase, size, era, copies,
current cube identities and UTC month. Returned responses have separate copies.
Catalog writes can cause a result-cache miss. They do not cause a synchronous
full index rebuild. The process-wide database, snapshot and request guard remain
shared across Next module graphs.

## Web RSS and standalone build

The production HTTP check copied the complete standalone build to `/tmp`.
It used 13,703 catalog rows, a 256 MiB V8 heap limit, the real local routes and
an isolated SQLite file. Source data and engine files stayed read-only.
No GC was forced in that server. These are process RSS values, not live-heap
sizes or a production VM capacity test.

| Local production web measure | MiB |
| --- | ---: |
| Startup RSS before requests | 115.3 |
| RSS after auth/cube reads, before seed preparation | 172.9 |
| RSS after the cold preview | 303.6 |
| RSS after the catalog refresh and another preview | 384.8 |
| Sampled peak, web plus preparation helper | 631.4 |

The same HTTP check measured 4,939 ms cold, 199.6 ms for the first preview after
a catalog write, and 8.43 ms cached p95 over 20 HTTP requests. Raw results:
`.status/effect-search/review-production/memory.json`. Local test auth and HTTP
stubs were used. No deployment or live traffic was involved.

A separate direct process test forced GC before and after preparation. It found
70.3 MiB of added live heap plus external buffers and 74.8 MiB of added RSS after
the cold preview. Live heap and buffer use stayed level after refresh. RSS rose
further because the allocator kept capacity. The earlier synchronous snapshot
report recorded 53.8 MiB of retained heap and buffers; that is a different cost
from web RSS. Raw results: `.status/effect-search/review-memory.json`.

The loader copies both sets of deserialized numeric views. This lets it release
the large serialized input buffer. The identity cache uses the snapshot as a
weak key, so it does not keep a replaced snapshot alive through the database.

The standalone packaging step traces the unbundled helper and its dependencies,
then installs the relative shared-package link. A real integration test copies
the result outside the workspace. It checks that the helper, Zod and native
SQLite all resolve inside that copy, and that one child prepares a cold index.
This prevents the local workspace from hiding missing deployment dependencies.

## Behavior checks

With `EFFECT_SEARCH=0`, newest sorting and release filters read only release
dates. A signed-host test checks order, filtering, returned date metadata and
that no effect index is installed.

Cube era reads use `GET /api/cubes/[id]/era`. It checks community and owner
access, reads all saved cards, handles remaps and engine artworks, and returns
`newerCount`. It does not run pool health or parse warning text. The integration
case includes 601 cards. Describe keeps one rounded era for each open session.
Reopening the mode adopts the latest era. Its note has reserved space.

The ATK reader accepts 3–5 digit values. The eval checks “1500 atk or less”,
“atk 1500 or lower”, “2500 attack or more” and “attack 2500 or higher”. It also
checks that “attack 2 times” does not become an ATK stat filter.

The real-artifact eval passed all **69 queries**, with 93 labeled positives and
79 labeled negatives. It had no labeled false matches or missed matches. These
labels cover the stated candidate pools; they do not certify every catalog row.

| Affected check | Result |
| --- | --- |
| Shared cube, query, insight and schema integration | 59 pass; opt-in timing case passed separately |
| Web cube, insight, deck and startup integration | 38 pass |
| Isolated standalone integration | 1 pass |
| Duel real-artifact eval and card search | 82 pass |
| Browser cases at all four required sizes | 24 cases covered and passed |
| TypeScript: shared, web, duel-server and e2e | Pass |
| Production Next build and standalone packaging | Pass |

The browser checks cover 1920×1080, 2560×1440, 1366×768 and 390×844. They check
row order and geometry after cube edits, hover geometry, badge overlap, date
order, note space, credit and summaries without an AI label. The final full run
passed 23 cases; one deck case hit a dev-server restart. A separate run of all
four deck cases passed after the restart. Screenshots at each size were checked.
Evidence is under `.status/effect-search/review-browser/`.

The earlier matched duel-server measurements remain in
[the memory report](effect-search-memory.md): 16.2–24.6 MiB steady
RSS growth after the change, against 57.1–61.7 MiB in the date-aware baseline.
That result does not include web memory.

## Reproduce

Build shared first. Use Node 22 and disable core files. Use one Vitest worker.

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
prlimit --core=0 -- npm run build --workspace=packages/shared
CUBE_SEED_BENCHMARK_DB=/path/to/source/bot.sqlite \
CUBE_SEED_BENCHMARK_OUTPUT=.status/effect-search/review-seed.json \
prlimit --core=0 -- npx vitest run \
  packages/shared/tests/cube-effect-search.integration.test.ts \
  -t 'times a preview' --maxWorkers=1
EFFECT_STANDALONE_DIR=/absolute/path/to/web/.next/standalone \
prlimit --core=0 -- npx vitest run \
  packages/web/tests/effect-standalone.integration.test.ts \
  -c packages/web/vitest.config.ts --maxWorkers=1
```

No environment file was read. Engine inputs stayed read-only. New tests are
integration/e2e only. No paid API, push, merge or deployment was used. Generated
Next, dist and TypeScript build-info output is removed after checks;
`node_modules` and local evidence remain.
