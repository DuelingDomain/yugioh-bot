# Archetype bridge engine measurements

Measured locally on 2026-10-28 with Node 22.23.3. The graph version is `dd86fadf825df3f2c0d659d3fb9dad14a2f37f3f1d8b125d5becf2fc9ee16950`. See [the API contract](../api/archetype-bridges.md) for signatures, schemas, CLI commands and admission rules.

## Precomputation and storage

The complete rebuild processed 13,874 engine identities and 513 groups in 70,831 ms. Peak process RSS was 760,644 KiB. It produced 8,198 retained directed bridges, with at most 25 per source and format.

| File | Records | Bytes on disk |
| --- | ---: | ---: |
| `card-capabilities.jsonl.gz` | 13,874 | 8,490,245 |
| `bridges-advanced.jsonl.gz` | 4,233 | 1,902,886 |
| `bridges-genesys.jsonl.gz` | 3,965 | 1,681,069 |
| `bridges-manifest.json` | 1 | 266,275 |
| Total | | 12,340,475 |

The three gzip files total 12,074,200 bytes (11.51 MiB). Capability records include engine identity and printed evidence, so live searches do not need a network request or another engine read. Import and integrity verification occur at duel-host startup, outside the search request.

## Live search

`scripts/effects/benchmark-bridges.ts` imports the pinned artifacts into SQLite, creates a fresh service for each format, and searches all targets for Odion. Cold times include decoding capability rows and building the in-memory graph; they exclude startup import. Five subsequent calls use that service's indexes.

| Format | Candidates | Cold search | Repeated searches |
| --- | ---: | ---: | --- |
| Advanced | 22 | 377 ms | 28, 26, 25, 25, 25 ms |
| Genesys | 21 | 348 ms | 31, 25, 26, 26, 26 ms |

The benchmark process RSS after both formats was 434,872,320 bytes. This includes the in-memory database and both service graphs; it is not a per-worker heap measurement. The worker integration exercises the existing 256 MiB worker heap limit. These timings are local measurements, not a latency guarantee for every source or deployment.

Normal suggestions read indexed retained rows and default to four results. Full searches run in the existing two-worker duel-host suggestion pool. Admission allows one in-flight search per authenticated actor, shares an atomic persistent 60-second cooldown across uncached live/explain requests, and rejects work when the pool is occupied. There is no queue or daily spend cap. A bounded 15-minute result cache avoids repeating identical work and rechecks feedback before returning cached rows.

## Quality and known gaps

Odion's top four in both formats are Paleozoic, Trap Monster, Argostars and Golden Land. Argostars is third. Odion → Blue-Eyes is retained as a Niche Advanced bridge through The Man with the Mark and Spirit with Eyes of Blue; it is absent in Genesys. Spirit's self-tribute clears its continuous Dragon lock before its summon resolves. The summon target must actually belong to Blue-Eyes; thematic support labels do not qualify Sage with Eyes of Blue or The White Stone of Ancients.

All ten tagged Ashtra identities are absent from the supplied read-only engine bundle. They are excluded, leaving the requested Odion → Ashtra sanity check blocked by that input. Rebuild against a current prepared engine bundle when those identities are available. The group builder also requires an exact profiled archetype, which excludes a golden Diabellstar source that lacks such a group in this snapshot.

The golden evaluator passed `--check`, with no labelled negative pair returned by retained lookup or live explanation:

| Format | Judged precision@5 | Top-five label coverage | Recall@10 |
| --- | ---: | ---: | ---: |
| Advanced | 100% (11/11) | 14.10% (11/78) | 68.75% (11/16) |
| Genesys | 100% (7/7) | 14.89% (7/47) | 77.78% (7/9) |

Full precision@5 is unknown, reported as null rather than treating unlabelled results as correct. `--strict-precision` requires complete top-five labels and is not satisfied by the current golden set. Missing identities, unsupported Fusion/material procedures, and low rankings contribute to recall misses. Minimum grades and annotated evidence matches are reported for further review; some expected grades remain unmet.

Rows are deterministically validated candidates. Paid judging, engine execution, player presentation, the deep-search route and progress bar remain subsequent stages. Their stored statuses are explicitly `judge: "pending"` and `engine_status: "unverified"`. Combined path resource and lock compatibility is also unverified.

## Verification

All commands ran with `prlimit --core=0` and Node 22. No new unit tests or full package suites were run.

- Shared build and TypeScript checks for `scripts/effects/tsconfig.json` and `packages/duel-server/tsconfig.build.json` passed.
- The final targeted batch passed 11 integration checks across the shared bridge pipeline, worker admission/progress, publication integrity and existing host suggestion concurrency (20.34 s).
- The existing effect-search boot-flag regression passed separately (one selected check; other cases skipped).
- The effect-tagging publication/protocol integration file passed 34 checks alongside the three new bridge integrations earlier in the run.
- Six CLI command smoke checks returned valid JSON and verified the Odion top four, Advanced niche link, Genesys exclusion, capability queries and path lookup.
- Golden evaluation and the benchmark ran against the final committed artifact version. Compressed and decompressed hashes, row legality, material/target proof and source pin boundaries were checked.

The targeted runs cover 46 distinct integration checks. No paid requests, remote publication or engine-data mutations were performed.
