# Set access, resource synergy, and host cache review

Measured against a disposable SQLite backup of the domain-multiplayer catalog.
The source database was opened read-only; migrations, catalog writes, and tests
used scratch or in-memory databases. No live provider calls were made.

## Selection

Advanced-format complete directed scans, before display deduplication:

| Engine | Outgoing bridges before | Outgoing bridges after | Incoming bridges before | Incoming bridges after | Separate synergies after |
| --- | ---: | ---: | ---: | ---: | --- |
| Ashtra | 185 | 5 | 52 | 2 | 1 incoming, Toy → Ashtra |
| Argostars | 115 | 1 | 3 | 1 | 0 |
| Labrynth | 174 | 17 | 7 | 4 | 0 |

Ashtra and Labrynth shortlists contain no access supplied by subtype-only broad
Sets or hand/GY Sets. Labrynth → Ashtra retains Cooclock's activation permission
with Yoa's own named Deck Set. Altergeist → Ashtra is no bridge; neither are the
ordinary one-card Set packages in Archfiend and Abyss Actor. Toy → Ashtra is
exclusively `kind: "synergy"` and contributes no bridge coverage or two-way status.

Set identity filters qualify by name/archetype, or a complete matching pool of at
most 30 cards. Subtype filters have no toolbox exemption. Hand Sets are not
access, and GY Sets are recursion. Synergy requires a printed multi-card Deck Set
and a printed consumer of that Set resource. One of eight shortlist positions
can contain synergy; accepted projection shows at most two. The review budget
remains twelve pairs using the same two Haiku framings.

The UI discriminator is `next[i].kind === "synergy"`; each associated
`links[].bridge.kind` also equals `"synergy"`. Ordinary bridges omit `kind`.

## Host work

Full engine construction, core derivation, ranking, detection, and directed
projection run in the scanner worker. Host gates validate only evidence and the
two relevant engine packages. Scanners lazily build the global legal-ID set for
stat-filter validation and send it to the host with its database revision. Host
gates, review reuse, legacy admission checks, and judge checks use that set within
a matching read transaction; stale worker replies are retried. Concurrent loads
for the same format coalesce. This preserves full-catalog selectivity without a
catalog scan or legality rebuild on the duel thread.
Existing ordinary judge prompts and identities are unchanged. The 31 previously
reviewed live rows retain the same gate distribution: 18 shown, 3 review, 9 invalid,
1 pending. The managed-job namespace changes so stale candidate sets are rescanned.

`bridge_engine_revision` changes only with `card_capability` and `bridge_graph`
inputs. Catalog, release, tag/profile and archetype directory writes, including
new artwork catalog rows, preserve the engine/core/ranking caches. No-op
capability writes and capability source-version refreshes also preserve them.
Migration atomically drops the old trigger names (including removed inputs) and
recreates current definitions, so existing databases receive changed column
lists without duplicate revision bumps. Broad catalog revisions continue to
invalidate cheap response projections, including changed artwork identities.
Completed legacy jobs produce results and next suggestions in one worker request,
under one 4.5-second deadline.

Accepted review reuse requires the stored row and new candidate to have the same
`kind`. A still-valid accepted synergy cannot replace a newly discovered access
bridge for the same directed pair; unchanged kinds retain review reuse.

Stellarknight → Constellar, same scratch benchmark pair, milliseconds:

| Gate call | Before fix | After fix |
| --- | ---: | ---: |
| Cold | 896.53 | 10.98 |
| Warm before lookup | 1.61 | 5.99 |
| After lookup write | 735.89 | 3.73 |

The gate remains pending. Engine object reuse after lookup changes from false to
true. Timings are individual observations on the shared host, not percentile
claims. Integration coverage also exercises two actual catalog sync writes,
including temporary artwork resets, plus cross-connection text/legality changes.

Reproduce the post-change lookup measurement after building shared:

```sh
node --conditions=source --import tsx scripts/effects/benchmark-bridge-cache.ts /path/to/source.sqlite
```

The benchmark opens its source read-only, writes only a temporary backup, and
removes the backup afterwards. It never calls a provider. Build output is removed
after verification.

## Verification

Integration coverage includes Set exclusions, full-catalog selectivity, resource
synergy saturation and review reuse, cached alternative paths, real catalog lookup
cache reuse, cold host isolation, and the shared completed-status deadline.
The golden evaluator separates synergy recall from bridge recall/precision; both
formats pass `--check --strict-precision` with no known false bridges and complete
deep/access/synergy recall. Type checks cover shared, duel-server, and web.

Commands used (all added tests are integration tests):

```sh
npx vitest run --root packages/shared 'tests/bridge-' tests/archetype-bridges.integration.test.ts --maxWorkers=1
npx vitest run --root packages/shared tests/archetype-bridges.integration.test.ts --testNamePattern='builds curated memberships' --maxWorkers=1
npx vitest run --root packages/shared tests/bridge-set-access.integration.test.ts tests/bridge-judge.integration.test.ts tests/bridge-alternatives.integration.test.ts --maxWorkers=1
npx vitest run --root packages/duel-server 'tests/bridge-' --maxWorkers=1 --testTimeout=30000
npx vitest run --root packages/web tests/card-bridges-route.integration.test.ts --maxWorkers=1
node --conditions=source --import tsx node_modules/vitest/vitest.mjs run scripts/effects/tests/bridge-evaluation.integration.test.ts --maxWorkers=1
node --conditions=source --import tsx scripts/effects/evaluate-bridges.ts --check --strict-precision
```

The broad shared run passed 87/88 checks; its CPU-heavy curated-membership fixture
exceeded its existing 15-second budget under concurrent work. That fixture passed
alone (14.46 seconds), and the final focused shared run passed 55/55, including the
new full-catalog selectivity regression. An intermediate host run lost its shared
build directory during concurrent workspace cleanup; shared was rebuilt before
the final host, web, and golden runs.

Final host integration run: 77/77 across nine files; web validators: 33/33;
golden evaluator integration: 5/5. Shared, duel-server and web type checks and
the shared build pass. Both formats pass the strict golden CLI gate with precision,
judgement coverage and deep/access/synergy recall of 1, and zero known false bridges.

Follow-up verification (2026-10-31), Node v22.23.3:

```sh
npx vitest run --root packages/duel-server 'tests/bridge-' --maxWorkers=1 --testTimeout=30000
npx vitest run --root packages/duel-server tests/bridge-cache.integration.test.ts tests/bridge-workers.integration.test.ts --maxWorkers=1 --testTimeout=30000
npx vitest run --root packages/shared tests/bridge-judge.integration.test.ts tests/bridge-grounding.integration.test.ts tests/bridge-set-access.integration.test.ts tests/bridge-engines.integration.test.ts tests/archetype-bridges.integration.test.ts --maxWorkers=1 --testTimeout=30000
npm run build --workspace=@yugidraft/shared
npm run build --workspace=@yugidraft/duel-server
npm run typecheck --workspace=@yugidraft/shared
npm run typecheck --workspace=@yugidraft/duel-server
```

The full host run passed 78/79; its remaining assertion expected provider requests
before asynchronous cold legality preparation. After updating that fixture, the
final cache/worker rerun passed 12/12, covering all previously failing assertions.
The other seven host integration files passed unchanged, including same-kind
review reuse and accepted synergy superseded by real access. Shared passed 71/71
across five integration files. Both production builds and type checks passed.
A compiled JavaScript scanner smoke check also passed cold/revised legality,
host scan protection, and judge gating on a disposable WAL database. All database
writes used scratch/in-memory fixtures; judge clients were fixtures, with no live
provider calls. Generated duel-server output was removed and the pre-existing
shared build directory restored after verification.
