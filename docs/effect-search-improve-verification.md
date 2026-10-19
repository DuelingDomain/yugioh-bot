# Effect search backend completion verification

Completed 2026-10-19 on `feat/effect-search-improve`, from `b5ca17200`.
The unfinished `b588669d6` is folded into the completion commit.

## API handoff

All paths remain behind `EFFECT_SEARCH`:

- `POST /api/decks/cards`: adds `relax: {chip, count}[]`, at most two.
- `POST /api/cards/insights` (`effectSearch`) and `POST /api/cards/resolve`
  (`op: "effectSearch"`): expose the same `relax` field.
- `reading.query.intent` may be `{kind:"similar", passcode, name}` or
  `{kind:"counters", archetype}`. Existing chip omission controls remove it.
- Existing deck `effectHits[].reason` and insights/resolve `cards[].reason`
  are deterministic strings of at most 70 characters. Similarity and counter
  hits retain the existing numeric `score` field.
- The deck query and description-search browser data helpers forward `relax`.
  No visual component was changed. No model label or extra model metadata is sent.

Relax counts retain every outer filter and remove only the named chip. Only
positive counts are returned, descending by count then label. Pass `chip` back
in `effectOmit` (deck) or `omittedChips` (insights/resolve). Disabled deck results
omit it. Unknown rule words boost name/text scores without rejecting hits.

Examples: `cards like Ash Blossom`, `similar to Effect Veiler`, `budget Ash
Blossom`, `how to beat Snake-Eye`, `counters to Kashtira`, `stop Tearlaments`.
Similarity uses roles, actions, zones and kind and excludes the canonical anchor.
Counter reasons derive from pinned archetype hooks; the credited upstream
counter port is preserved. Budget alternatives imply mechanical similarity,
not a market-price claim.

The optional hard reader uses one bounded HTTP POST per normalized phrase,
shared SQLite cache/claims, a two-second end-to-end deadline, a sliding
20 attempts/user/hour and 100 attempts globally/hour. Its reservation and actual
spend share the CI job's $10/month Git CAS ledger. Uncertain costs remain held
across UTC rollover. Context-specific Zod validation rejects invented names,
unsupported facets and empty interpretations. Missing key/ledger/budget,
errors, quota, contention or timeout preserve the rule result silently.

Runtime requires `ANTHROPIC_API_KEY`, repository identity and a token with access
to the existing budget branch. Exact setup and conservative hold/recovery
behavior are in [effect-tagging.md](effect-tagging.md#optional-runtime-phrase-reader).
No real paid request or remote Git write was made in this verification.

## Targeted validation

| Check | Result |
| --- | --- |
| Real-engine effect eval plus card search | 127 tests pass |
| Shared reader/HTTP/cache/ledger and SQL insights | 42 tests pass |
| CI tagging ledger/artifact integration | 25 tests pass (24 existing plus the targeted new mixed-ledger case) |
| Web deck, insights/resolve and cube integration | 39 tests pass |
| Shared build | Pass |
| TypeScript shared, duel-server, web and tagging scripts | Pass |
| Independent code review | Approved after fixes |

No new test files or full CI shards. The real-artifact eval contains **111
queries**, **158** labeled positives and **145** labeled negatives, with **0**
false positives and **0** missed hits (labeled precision/recall both 100%). This
includes a hard phrase sent to a local mock Messages endpoint before searching
the real artifact, unknown-word soft boosts, relax counts, similarity, counters,
short deterministic reasons, Genesys budgets, formats and existing name queries.
Labels cover the specified pools, not every catalog row.

Reader integration uses local HTTP endpoints and disk SQLite, covering cache
reopen/concurrency, one POST, vocabulary/name rejection, hourly limits,
missing/corrupt/conflicting/exhausted ledgers, uncertain usage and timeout,
UTC rollover and writer contention. A mock Git endpoint checks a >1 MB ledger
read through Git blobs and a concurrent non-fast-forward CAS rejection.

## Latency and memory

Node **22.23.3**, `prlimit --core=0`, the same read-only 14,845-card engine
and 13,694 tagged identities; forced-GC fresh processes, temporary disk SQLite.
Baseline was recorded before integration on the supplied WIP (the name-search
path was unchanged from its base). Each latency row contains 700 warmed samples;
values are **median / p95**.

| Phase / query scope | Before | After |
| --- | --- | --- |
| First import, Name scope | 0.519 / 0.793 ms | 0.474 / 0.609 ms |
| First import, Default scope, name phrases | 2.084 / 2.591 ms | 1.868 / 2.289 ms |
| Reused artifact, Name scope | 0.493 / 0.628 ms | 0.475 / 0.678 ms |
| Reused artifact, Default scope, name phrases | 2.037 / 2.473 ms | 2.115 / 3.317 ms |

| Steady indexed RSS | Before | After | Difference |
| --- | --- | --- | --- |
| First import | 223.10 MiB | 224.93 MiB | +1.83 MiB |
| Reused artifact | 201.76 MiB | 204.63 MiB | +2.88 MiB |

Maximum measured RSS increase: **2.88 MiB (3.01 MB)**, within the requested
**10 MB**. Relative to each process's engine-only RSS, the feature's retained
RSS change was -0.53 MiB on first import and +0.96 MiB on artifact reuse.
The default-scope reused p95 varied upward; name-scope medians stayed below
0.5 ms after the change. These are local samples, not production guarantees.

Evidence remains in ignored `.status/effect-search/{eval.json,
improve-before.json,improve-after.json}`. Shared/duel dist, prior Next output
and TypeScript build-info output are removed after verification. The generated
`next-env.d.ts` is restored to its checked-in form. No environment files were
read; engine resources stayed read-only. No stash, hard reset or push was used.
