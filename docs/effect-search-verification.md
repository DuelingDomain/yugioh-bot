# Effect search foundation verification

See [the integrated performance report](effect-search-performance-verification.md)
for the later date merge and speed/memory fixes. The measurements below record
the earlier foundation state.

Validated with Node 22.23.3 on this worktree. Engine and existing catalog inputs
were opened read-only; no engine preparation or writes were performed locally.
The stable API and TypeScript shapes are in [the contract](effect-search-contract.md).

## Behavior and attribution

The credited searchygo reader, matcher, schema and archetype profiles now support
compact names and typos through the existing name matcher. The Spellcaster slot
bug, affected-object descriptors, exclusive subtype alternatives, normal Spell
metadata, Level versus Rank and impossible Synchro links have regression coverage.
Card links use printed names, archetypes, constrained support filters, materials
and event producers/consumers. Deck ranking counts distinct linked anchors,
then specificity and snapshot popularity. SQL services retain only a bounded
page and anchors; the duel host retains compact summary-free facets.

Deck search keeps name results first and returns an independently paged effect
group, reading chips and short reasons. Exact text bypasses the reader. Existing
filters, artwork identity, admission flags, Genesys points/budget and pool scope
remain in place. Summaries use ordinary card prose without an AI label. Source
headers, root `NOTICE` and artifact `NOTICE.md` preserve the searchygo credit;
the UI shows none. Production defaults off unless
`EFFECT_SEARCH=1`; nonproduction defaults on.

## Real-artifact evaluation

The integration suite contains 60 query cases: 40 effect/role queries, ten
name/alias/typo queries, five Genesys budgets, four single-card synergy/format
cases and one deck-link ranking case. It also exercises the signed host query,
canonical artwork pools, exact/chip controls and feature disablement.

All 60 passed: 83 labeled positive expectations and 68 labeled negative
expectations, zero labeled false positives and zero labeled false negatives.
Labeled precision and recall are both 100%.
Effect cases use explicit positive/negative candidate pools. This is precision
over those gold labels, not a claim that every result in the complete catalog
was independently judged. `.status/effect-search/eval.json` records the counts;
the suite emits `EFFECT_EVAL` in CI. Normal CI engine tests include this suite;
the dedicated tagging workflow also evaluates each proposed artifact pin.

## Catalog coverage

| Read-only snapshot | Canonical cards | Tagged | Missing | Coverage |
| --- | ---: | ---: | ---: | ---: |
| Existing cached `card_catalog` | 2,043 | 1,883 | 160 | 92.17% |
| Complete engine catalog, excluding tokens/hidden artwork | 14,220 | 13,530 | 690 | 95.15% |

The cached missing set contains 146 Normal Monsters with flavor text and 14
preview cards missing effect tags. Every passcode/name is listed in
[the cached catalog CSV](effect-search-missing-tags.csv). The complete engine
missing set contains 685 Normal Monsters and five other cards, listed in
[the engine CSV](effect-search-engine-missing-tags.csv). These snapshots differ:
the cache includes preview cards absent from the selected engine. Normal Monster
metadata remains usable as a synergy anchor without an effect tag.

The upstream snapshot contains 13,694 tag rows and 530 profiles. Known alternate
artworks and prerelease remaps fold to canonical passcodes. A unique printed-name
bridge covers upstream artwork IDs absent from the engine, including Monster
Reborn and Barrel Dragon. Functional aliases such as Harpie Lady 1 stay distinct.
13,693 tags have a known tagged-input hash; one lacks its original input and
retains `NULL`. The four compressed files total 3,541,961 bytes (3.38 MiB), so
Git storage keeps this small foundation self-contained and avoids startup
downloads. Both compressed and raw content are SHA-256 pinned.

## Name latency and memory

`effect-search-benchmark.ts` runs 35 warmups then 700 searches per configuration
over 14,845 engine records. Feature-disabled and enabled measurements run in the
same Node process; ordinary successful names take the existing scan. These are
local CPU measurements, not network/API latency or throughput under load.

| Search mode | Before median / p95 | After median / p95 |
| --- | --- | --- |
| Name only | 0.550 / 0.794 ms | 0.488 / 0.639 ms |
| Default name + text, ordinary card names | 1.955 / 2.500 ms | 1.973 / 2.499 ms |

The default median changed by about 0.9%, within local timing noise; p95 and
name-only latency did not regress. Compact/typo fallback executes only after an
empty name result. Semantic phrases intentionally execute the additional matcher.

Forced-GC retained facet-index heap growth was 18,457,800 bytes (17.60 MiB), under
the 25 MB target; index-only RSS growth was 1.34 MiB. The whole isolated process
RSS rose from 186.83 to 267.24 MiB (+80.41 MiB), including the ephemeral SQLite
import, schema and allocator capacity. An earlier disk-backed import measured
47.04 MiB overall RSS growth and a 16.77 MiB retained index before the compact
printed-name set was added for default-scope aliases.
The facet target is met; total startup RSS is larger and allocator-dependent.
Raw results remain in `.status/effect-search/final-benchmark.json` and
`performance.json`. SQL suggestions on the 2,043-card cached catalog took about
345 ms for ten anchors and 875 ms for 40 anchors; they are off the name-search
path and API suggestion decks are capped at 100 entries.

Reproduce the read-only benchmark after building shared:

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
prlimit --core=0 -- node --expose-gc --import tsx \
  packages/duel-server/scripts/effect-search-benchmark.ts \
  --engine-directory /path/to/prepared/engine \
  --output .status/effect-search/final-benchmark.json
```

## Browser checks

Four Playwright cases passed at 1920×1080, 2560×1440, 1366×768 and 390×844.
Checks cover Dueling Domain branding, interpretation chips, credit, name/effect
groups, ordinary summaries, chip removal, exact text, name search, stationary
hover geometry, badge rectangles and horizontal overflow. Screenshots were
visually inspected at every size and are kept under
`.status/effect-search/browser/`. The isolated local stack used ports 3371/4331;
existing port-3000 servers were untouched.

## Checks and operating limits

Targeted integration/regression suites cover shared schema/remaps/imports,
reader/synergy/service, web-to-signed-host and insight authentication/validation,
duel scanning/evaluation and engine-installer preflight. Shared, web and
duel-server TypeScript checks pass. The Batch pipeline has separate TypeScript
and fake-HTTP/durable-ledger/publication integration checks. New tests are
integration/e2e only.

| Targeted suite | Passing tests |
| --- | ---: |
| Shared artifact, reader, SQL service, schema and remaps | 69 |
| Duel real-artifact evaluation, card scan and installer | 105 |
| Web insight and signed-host routes | 12 |
| Batch ledger and publication integration | 12 |
| Browser viewport e2e | 4 |

Explicit SQL pool/anchor lookups also cover engine cards absent from the lazy
application catalog, with canonical artwork identity and known tagged-input
hashes. They use individual read-only engine rows and never populate that cache.
Current Genesys points remain unknown for uncached cards, which are excluded
from Genesys recommendations. An omitted pool retains the cached universe.

Targeted commands (set `DUEL_DATA_DIR` to a read-only prepared engine snapshot
for the duel evaluation):

```bash
prlimit --core=0 -- npm run build --workspace=packages/shared
prlimit --core=0 -- npx vitest run \
  packages/shared/tests/effect-artifact.integration.test.ts \
  packages/shared/tests/effect-search.integration.test.ts \
  packages/shared/tests/card-insights.integration.test.ts \
  packages/shared/tests/card-passcode-remaps.test.ts \
  packages/shared/tests/db/schema.test.ts --maxWorkers=1
prlimit --core=0 -- npx vitest run \
  packages/duel-server/tests/effect-search.integration.test.ts \
  packages/duel-server/tests/card-search.test.ts \
  packages/duel-server/tests/install-engine-bundle.test.ts \
  --maxWorkers=1 --testTimeout=20000
prlimit --core=0 -- npx vitest run \
  packages/web/tests/card-insights-route.integration.test.ts \
  packages/web/tests/deck-effect-search-route.integration.test.ts \
  -c packages/web/vitest.config.ts --maxWorkers=1
prlimit --core=0 -- npx vitest run scripts/effects/tests/effect-tagging.integration.test.ts --maxWorkers=1
prlimit --core=0 -- npm run typecheck --workspace=packages/shared
prlimit --core=0 -- npm run typecheck --workspace=packages/web
prlimit --core=0 -- npm run typecheck --workspace=packages/duel-server
prlimit --core=0 -- npx tsc -p scripts/effects/tsconfig.json --noEmit
```

The committed viewport spec can also run on the standard isolated stack with
`E2E_WORKERS=1 npx playwright test effect-search -c packages/e2e/playwright.config.ts`
after the normal stack build. Local checks used a disposable config pointing at
the dedicated 3371/4331 stack and retained screenshots only.

The daily CI job uses the pinned Claude Haiku 4.5 Message Batches model and a
durable GitHub ledger, with reservations before submission and a hard $10 UTC
month cap. It tags only new or changed printed input; unmerged validated results
are reused. Uncertain submissions retain their full reservation without retry.
Generated artifact PRs pass integrity/schema checks and the real-artifact eval;
human branch edits are preserved. Operating setup and recovery are documented
in [the tagging instructions](effect-tagging.md). No paid API requests or
GitHub publication were run in this session. Production enablement and the
workflow credential/one-time ledger setup are deployment configuration steps.

Generated `.next`, `dist` and TypeScript build-info files are removed after
validation. `node_modules` and local evidence remain. All implementation commits
carry the owner's required trailers; nothing is pushed.
