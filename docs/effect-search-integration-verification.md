# Effect search integration verification

Verified on 2026-10-18 with Node 22.23.3 in `feat/effect-search`, starting at
`b096596c70693aa9aed66c4c78fe9905c066cac9`. Nothing was pushed.

## Branches and behavior

Each branch was merged with `git merge --no-ff`, in this order:

| Branch suffix | Supplied head | Merge commit |
| --- | --- | --- |
| deck-ui | `c7e158486` | `22f5052e3` |
| cube-backend | `fc07c1ce2` | `7b618dfbd` |
| cube-ui | `12aff2be1` | `8625e72e4` |
| draft-picks | `3175fcbcf` | `e2f570e79` |
| ci-tagging | `99895673b` | `6b4b2b908` |

The combined branch includes effect search, reading chips and exact text;
card partners and deck suggestions; cube and pool description search and batch
addition; phrase previews and confirmation; theme-lobby pool health; private
pack fit reasons; one automatic-pick policy for bots and expired human picks;
and budgeted Haiku Batch generation of changed tags and archetype profiles.

Conflict resolutions preserve bounded two-pass seed selection, validated
optional profiles, an eight-lookup budget only for explicit search pools, and
cached health only on explicit requests. Shared `includeHealth: true` remains
supported. Cube and draft-lobby previews share one per-user in-flight guard.
Pack fit reasons use the pick scorer's policy, including missing-role benefits,
with a cache scoped to the viewer's exact pack and picked pool.

Integration fixes add searchygo credit to the live draft reader and reuse
`BugFabLift` so the floating report control clears batch-add actions. The latter
was reproduced by a failing browser geometry assertion before the fix, then
passed at all four sizes. No new unit tests were added.

## Validation

| Check | Result |
| --- | --- |
| Shared build | Passed |
| Shared, web and duel-server `tsc --noEmit` | Passed; final rerun passed |
| Tagging-script `tsc --noEmit` | Passed; final rerun passed |
| WS, duel-server, worker and Next.js standalone builds | Passed |
| Shared: artifacts, effects, insights, cube effects, smart picks, remaps, schema and cube regressions | 173 passed; 1 optional real-catalog seed benchmark skipped |
| Web: cube effects, smart picks, pick race, theme lobby/contracts, resolve, deck search, insights, privacy and preflight | 228 passed |
| CI tagging: fake HTTP, durable ledger, budget, recovery and publication | 24 passed |
| Duel host and real-artifact evaluation | 61 passed, including all 60 eval queries |
| Initial browser run: five feature specs and auth setup | 33 passed: 28 feature cases and 5 logins |
| Final cube/draft browser rerun after the batch-action fix | 21 passed: 16 feature cases and 5 logins |

The targeted non-browser total is 486 passing tests and one optional skip.
The eval had 83 labeled positive hits and 68 correct exclusions, with no labeled
false positives or misses. This evaluates the labeled fixture, not every result
in the catalog. Eight-seat draft scoring and both timeout performance fixtures
also passed.

Browser sizes were 1920×1080, 2560×1440, 1366×768 and 390×844. Checks cover the
Dueling Domain brand, credit, ordinary summaries without an AI label, reading
controls, partners, suggestions, batch additions/removal, phrase previews,
health, private fit reasons, fixed hover geometry, badge separation and no
horizontal overflow. Screenshots were visually inspected at all four sizes.
Browser card art is stubbed; the deck suggestion display fixture supplies ranked
rows, while separate integration tests validate real ranking and route behavior.

The isolated stack used ports 3381/3383/4384/4385. The available read-only engine
snapshot had an older wrapper hash, so its unmodified startup check failed.
Browser checks then used a disposable fixture linking the original resources
and a separate manifest that pins the installed wrapper. Original engine files
were unchanged. These are search/draft UI checks, not validation of current
duel-core behavior. The worker also logged a nonfatal startup catalog-sync lock;
the browser fixtures explicitly warm their required card rows.

Evidence is under `.status/effect-search/integration-browser/`, including the
initial and final JSON reports and the before-fix obstruction screenshot.

## Name search and memory

The read-only benchmark used 14,845 engine records, 35 warmups and 700 samples
per configuration. Before/after means effect search disabled/enabled in the same
process. It is a local CPU measurement, not API latency under load.

| Query scope | Before median / p95 | After median / p95 |
| --- | --- | --- |
| Name only | 0.569 / 0.823 ms | 0.514 / 0.844 ms |
| Default name and text | 2.053 / 2.681 ms | 2.023 / 2.599 ms |

The name-only p95 difference is 0.021 ms; the default path improved slightly.
Retained facet heap was 17.60 MiB, below the 25 MB target. Whole-process RSS grew
64.33 MiB through import and index creation, including SQLite and allocator
capacity. Raw data is `.status/effect-search/integration-benchmark.json`.

## Contract and remaining work

Detailed contracts: [foundation](effect-search-contract.md),
[cube and draft UI](effect-search-cube-contract.md),
[smart draft picks](effect-search-draft-picks.md), and
[CI tagging](effect-tagging.md).

`EFFECT_SEARCH=1` enables human-facing effect search and reasons; `0` disables
them. Absent defaults off in production and on elsewhere. New theme drafts also
require `THEME_DRAFTS=1`. Smart automatic picks apply independently of the display
flag. Runtime needs no Anthropic key. The artifact, NOTICE, copied headers and UI
retain searchygo credit; summaries have no AI label.

The owner must add the Actions secret `ANTHROPIC_API_KEY` and initialize the
durable `state/effect-tagging` ledger before paid tagging. The shared tag/profile
ledger enforces $10 per UTC month and $2 per run. No paid request was made here.
Production enablement remains an owner rollout step.

Tag coverage and mechanical heuristics remain incomplete. Full-catalog phrase
previews can still block the web process for seconds; the per-process guard
limits overlapping requests but does not move scoring off the request thread.
Whole-startup RSS needs continued observation beyond the compact-facet target.
A current matching engine bundle is needed for unmodified full-stack engine
verification. Co-play ranking and the later counter/curator features remain
outside this integration.

All five merged feature worktrees were clean and removed with
`git worktree remove`; their branches remain. Other worktrees and port-3000
servers were untouched. Generated Next.js builds, package `dist` directories
and TypeScript build-info are removed after checks; local `node_modules` remains.
