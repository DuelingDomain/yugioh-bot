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
two relevant engine packages. Stat-filter validation lazily caches a global set
of legal IDs, preserving full-catalog selectivity without loading all effects.
Existing ordinary judge prompts and identities are unchanged. The 31 previously
reviewed live rows retain the same gate distribution: 18 shown, 3 review, 9 invalid,
1 pending. The managed-job namespace changes so stale candidate sets are rescanned.

`bridge_engine_revision` changes only with semantic card/effect/graph inputs.
Timestamp/image refreshes, no-op capability writes, and artwork `is_main` resets
preserve the engine/core/ranking caches. Broad catalog revisions continue to
invalidate cheap response projections, including changed artwork identities.
Completed legacy jobs produce results and next suggestions in one worker request,
under one 4.5-second deadline.

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
