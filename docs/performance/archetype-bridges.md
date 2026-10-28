# Archetype bridge engine measurements

Measured locally on 2026-10-28 with Node 22.23.3 and algorithm `capability-bridges-v2`. Graph version: `7efa8b380a090f77e20090b5e0210b13b3505f4e1be5ac1aebdfa85f47387082`. See [the API contract](../api/archetype-bridges.md) for signatures, schemas, CLI commands and admission rules.

## Precomputation and storage

The complete rebuild processed 13,954 engine identities and 458 engine groups in 69,191 ms. Peak process RSS was 670,520 KiB. It produced 2,829 retained directed candidates, with at most 25 per source and format.

| File | Records | Bytes on disk |
| --- | ---: | ---: |
| `card-capabilities.jsonl.gz` | 13,954 | 8,592,195 |
| `bridges-advanced.jsonl.gz` | 1,484 | 395,902 |
| `bridges-genesys.jsonl.gz` | 1,345 | 346,834 |
| `bridges-manifest.json` | 1 | 147,537 |
| Total | | 9,482,468 |

Capability records include engine identity and printed evidence, so candidate scans require no network request or further engine read. Import and integrity verification occur at duel-host startup, outside the search request.

## Live search

`scripts/effects/benchmark-bridges.ts` imports the pinned artifacts into SQLite and creates a fresh service per format. Cold times include decoding capability rows and building the graph, excluding startup import. Five subsequent calls reuse that service's indexes.

| Format | Odion candidates | Cold search | Repeated searches |
| --- | ---: | ---: | --- |
| Advanced | 4 | 1209 ms | 20, 20, 19, 19, 20 ms |
| Genesys | 3 | 1050 ms | 22, 20, 20, 20, 19 ms |

The benchmark process RSS after both formats was 413,499,392 bytes, including the in-memory database and both graphs. These are local measurements, not latency guarantees for every deployment.

Suggestions read indexed SQLite rows and return at most four accepted bridges. Deep-search candidate scans use at most one of the two scanner workers. HTTP judging runs on the host with separate concurrency of two, keeping the second scanner available for normal Suggestions.

Persistent jobs allow one queued/running search per user, a completion cooldown, bounded hourly starts and a bounded queue. Identical queries reuse cached results; a different query while one is active returns a conflict naming the running source. No monthly spending cap is configured by default.

## Quality and known gaps

Odion's leading candidates are Ashtra and Argostars, followed by Altergeist. Advanced also retains the Niche Spirit with Eyes of Blue line; Genesys excludes it. The current prepared bundle includes the printed Ashtra identities, including Yoa the Plague Deity Ashtra and Ashtra Divine Domain. The Diabell golden source now matches the actual group name.

Generic labels, source self-references, isolated stat lookups and opponent-field discard payoffs are rejected before judging. Generic Trap activation support cannot establish a bridge alone. Unproven multi-material Extra Deck paths are omitted until their summon setup can be included in the evidence; supported single-material Spirit paths remain.

The golden evaluator passed both `--check` and `--strict-precision`. Every returned top-five candidate across ten core sources has an inspected label:

| Format | Precision@5 | Top-five label coverage | Recall@10 |
| --- | ---: | ---: | ---: |
| Advanced | 100% (25/25) | 100% | 94.44% (34/36) |
| Genesys | 100% (23/23) | 100% | 93.75% (30/32) |

`precision_at_5` uses all retrieved core-source rows as the denominator, so missing labels reduce precision. `--check` also requires at least 80% judgement coverage; `--strict-precision` requires 100%. Ordinary missing group names fail evaluation. Explicit excluded-label regressions assert absence, while evidence-specific negatives reject the named bad line without rejecting other valid lines for that pair. No known negative pair or rejected evidence remains. Tenyi → Swordsoul and Invoked → Shaddoll remain recall misses; expected grades and evidence-card matches are reported separately.

Stored rows remain deterministic candidates. Publication requires two accepted independent judgements matching current evidence, plus feedback and format checks. Niche positive labels include stated setup requirements and do not imply that a player-facing bridge has passed those judges. Engine execution remains unverified. Before enabling the feature, populate the judgement artifact using the release steps in [the judging runbook](../runbooks/bridge-judging.md).

## Verification

Rebuild, golden evaluation, benchmarks and targeted shared bridge/evaluator integrations ran with `prlimit --core=0`. The shared pipeline covers label rejection, source self-bridges, generic stat lookups, discard evidence, matching-Type Fusion prerequisites and missing-proof rejection, directed lookups, Genesys exclusion and the Ritual requirement shared across quoted alternatives. Evaluator integration covers missing group names, excluded groups that still exist and a CLI failure for missing top-five labels. No new unit tests or full package suites were run.
