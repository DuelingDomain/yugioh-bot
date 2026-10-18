# Effect search integration and performance verification

Date: 2026-10-18. Branch: `feat/effect-search`. Node: 22.23.3.

The date branch was merged with `--no-ff` in `3e6e2f4b0`. The merge keeps
release filters, era scores, batch profile updates and draft pick insights.
The source branch head is `012342529`.

## Seed preview

The benchmark opens the supplied source database read-only and backs it up
to a temporary disk database. It fills only that copy from the read-only
engine. The resulting catalog has 13,702 real card rows. Setup and index
preparation are outside request timings.

| Measurement | Before | After |
| --- | ---: | ---: |
| First `dark magician` preview, 180 rows | 6,424 ms | 110.6 ms |
| Uncached request p95, 40 phrase/era combinations, 180 rows | Not sampled | 90.9 ms |
| Repeated request p95, 40 samples | Not sampled | 0.335 ms |
| Initial index preparation | None | 4,422 ms |

These measurements are local. They do not measure network time or ARM64
production hardware. The old value is one request, not a p95 estimate.
Raw results are in `.status/effect-search/seed-after.json`.

The web process prepares archetype members, hook matches, role sets and
shared mechanical filter lists. It does not store a graph of every card pair.
The preview cache lasts five minutes and holds at most 64 results per snapshot.
Keys include phrase, size, era, copies, current canonical cube cards and UTC
month. Responses have separate copies. The user request guard remains in place.
Metadata changes refresh the snapshot. Unrelated cube or duel writes reuse it.
A snapshot refresh still has the preparation cost shown above.
The database handle, prepared snapshot and request guard use process-wide
registries, so separate Next instrumentation and route modules share them.
An integration check loads separate module instances to verify this behavior.
The compact web snapshot adds about 53.8 MiB of retained heap and buffers;
it is not built in the duel process.

An explicit era takes priority over the era derived from existing cube cards.
Era is a soft score bonus. Date chips filter every seed category. Pool health
and worksWith retain the merged era options. Health caches include the explicit
era and metadata revision.
The browser seed-preview and works-with helpers also pass an explicit era.
Integration checks send their actual request bodies through the real routes.

Run the request benchmark with:

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
CUBE_SEED_BENCHMARK_DB=/path/to/source/bot.sqlite \
CUBE_SEED_BENCHMARK_OUTPUT=.status/effect-search/seed-after.json \
prlimit --core=0 -- npx vitest run \
  packages/shared/tests/cube-effect-search.integration.test.ts \
  -t 'times a preview' --maxWorkers=1
```

## Checks

The real-artifact evaluation passed all 64 queries: the original 60 plus four
date cases. It had 87 true positives, 75 true negatives, no labeled false
positives and no labeled false negatives. These are gold-label pool results;
they do not certify every full-catalog result.

New checks are integration or browser checks. They cover cache copy isolation,
expiry, current cube exclusions, release filters, inferred and explicit era,
external metadata updates, unrelated external writes, and engine-only artworks.

| Targeted final check | Passed |
| --- | ---: |
| Shared artifact, effect query, insight service and schema | 60 |
| Shared cube effect integration, including full-catalog timing | 24 |
| Web insight, deck, cube and startup integration | 35 |
| Duel effect evaluation, startup parity and card search | 76 |
| Tagging/publication integration | 24 |
| Existing cube service regression checks | 64 |
| Existing web card, theme, private-cube and booster regression checks | 193 |
| Browser checks at all four required sizes | 24 |

Shared was rebuilt. TypeScript checks passed for shared, web and duel-server.
The duel-server production modules were also built for memory measurement.
Independent score comparisons found no mismatch in 10,466 candidate/deck cases.

The final memory and browser reports are in
[memory verification](effect-search-memory-verification.md) and
[UI verification](effect-search-ui-verification.md).

The matched date-aware memory baseline adds 57.1–61.7 MiB of steady RSS.
Three fresh runs of each startup path add 16.2–24.6 MiB after the change.
The sampled sum of the server and helper startup RSS growth falls from
109.0–114.6 MiB to 90.8–98.9 MiB. All six steady samples meet the 30 MiB target.
The server imports the pinned version once into the shared disk database.
A short-lived process builds compact facets in batches of 1,024 rows.
The server installs them after that process exits. Temporary files and
construction data are released. See the memory report for GC and peak details.

No environment file was read. Engine inputs remained read-only. No paid API,
push or deployment was used. Generated build output is removed after checks;
`node_modules` remains.
