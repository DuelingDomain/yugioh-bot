# Multi-engine Bridges backend checks — 2026-10-30

Node 22.23.3, `feat/archetype-bridges`, pinned bridge and effect artifacts. All checks use disposable in-memory databases. The benchmark makes no paid calls; it measures deterministic forward/reverse scans and ranking, not live Haiku latency or end-to-end job p95.

Command: `npx tsx scripts/effects/benchmark-bridges.ts --multi`.

The engine prefixes are Odion; Odion + Ashtra; Odion + Ashtra + Blue-Eyes; and Odion + Ashtra + Blue-Eyes + Fiendsmith. Each case runs `2 × engines` scans, then five warm repeats. Warm p95 is the maximum of these five samples. The benchmark's `cold_ms` field is the first pass for that set; graph and pair state can already be warm from earlier sets in the same process.

| Format | Engines | First pass ms | Warm samples ms | Warm p95 ms |
| --- | ---: | ---: | --- | ---: |
| Advanced | 1 | 5700 | 1779, 1798, 1691, 1665, 1659 | 1798 |
| Advanced | 2 | 3598 | 3318, 3291, 3305, 3308, 3372 | 3372 |
| Advanced | 3 | 6730 | 6228, 6210, 6215, 6132, 6504 | 6504 |
| Advanced | 4 | 8438 | 8009, 7935, 7956, 7870, 7851 | 8009 |
| Genesys | 1 | 2658 | 1530, 1515, 1497, 1546, 1521 | 1546 |
| Genesys | 2 | 3133 | 2985, 3009, 3020, 2963, 2995 | 3020 |
| Genesys | 3 | 5308 | 5274, 5325, 5282, 5297, 5257 | 5325 |
| Genesys | 4 | 6703 | 6726, 6738, 6756, 6818, 6727 | 6818 |

Final process RSS: 487,772,160 bytes. The deterministic phase leaves room within the design's 180-second target; the live review portion still needs production timing. The twelve-new-pair budget and two-task judge concurrency remain unchanged.

Integration checks cover artifact-backed Odion + Ashtra, Blue-Eyes, Snake-Eye and Fiendsmith detection; hand traps/staples; weights and folding; the four-engine cap; cross-source access-path deduplication; accepted-only publication; Genesys missing copies; exclusive selectors; old one-engine cache compatibility in both admission orders; deck-independent shared work with private subscriber projection; fresh single-source forward reuse; incoming worker scans; one multi search counting once toward fifteen/hour; twelve-new-pair and six-reviewed-engine stops; and 24-hour reuse with intentionally pending shortlist rows. Judge fixtures use the existing evidence and review cache APIs; they make no paid calls.

Verification commands and results:

```sh
# packages/shared — 25 passed
npx vitest run tests/bridge-engines.integration.test.ts tests/archetype-bridges.integration.test.ts tests/bridge-access.integration.test.ts tests/bridge-round3.integration.test.ts
# packages/duel-server — 26 passed
npx vitest run tests/bridge-engines.integration.test.ts tests/bridge-search-jobs.integration.test.ts tests/bridge-workers.integration.test.ts tests/bridge-api.integration.test.ts tests/bridge-niche.integration.test.ts
# packages/web — 16 passed
npx vitest run tests/card-bridges-route.integration.test.ts
# repository root — all exit 0
npm run build --workspace=packages/shared
npm run build --workspace=packages/duel-server
npm run typecheck --workspace=packages/shared
npm run typecheck --workspace=packages/duel-server
npm run typecheck --workspace=packages/web -- --incremental false
```

Sample fast request for an eight-card open Odion + Ashtra deck:

```json
{"format":"advanced","deck":{"main":[29762407,29762407,97522863,97522863,1710647,1710647,37839434,37839434],"extra":[]}}
```

Actual host `engines` response using the unmodified artifacts:

```json
{
  "engines": ["Ashtra", "Odion"],
  "between": [],
  "next": [],
  "inReview": 9,
  "detected": [
    {"name":"Ashtra","weight":4,"copies":4,"distinct":2,"status":"engine","hybrids":[]},
    {"name":"Odion","weight":4,"copies":4,"distinct":2,"status":"engine","hybrids":[]}
  ]
}
```

The committed judge cache contains zero records, so these candidates remain hidden. Accepted-review integration fixtures return next-engine suggestions, recheck feedback, and never use pending evidence to fill empty slots.
