# Multi-engine backend delta fixes — 2026-10-30

All fourteen `newProblems` entries in the delta review reduce to the seven fix groups below. All seven were accepted and fixed. The startup blocker was fixed and committed first.

| User issue | Change | Commit |
| --- | --- | --- |
| 1 | Remove eager ranking initialization; missing snapshots return 503 on demand, including after an external graph replacement | `b91990def` |
| 2 | Dedicated deep scanner; bounded interactive queue and deadlines; coalesced, limited, revision-aware completed projections | This commit |
| 3 | Retain the newest queued engine/deck edit behind active work; replace superseded inputs | `6163f7648` |
| 4 | Persisted bridge-specific revision triggers, plus existing catalog and saved-deck revisions; duel writes preserve cached results | `9228b1cdc` |
| 5 | Compact complete candidate references; status passes a job ID, loads and parses inputs in the scanner, and supports old full-row results | `60d3c08bf` |
| 6 | Five-second completion persistence deadline; terminal in-memory failure releases actor/global slots even when SQLite rejects failure writes | `2161c56f8` |
| 7 | Skip inferred deck point accounting when points are unknown; preserve copy context and explicit allowance precedence | `76854026e` |

The scanner pool now permits one deep worker and two workers shared by interactive bridge queries and Suggestions. Each retains the existing 256 MiB JavaScript heap limit and idle retirement. Deep steps wait in their own lane without an interactive queue cap. Interactive calls allow eight waiting scans and have a 4.5-second deadline including queue time. Fast request deadlines also cover waiting behind a stale actor request; replacing queued inputs gives the newest caller its own budget. Timed-out active scanners retire instead of continuing abandoned work.

Completed projections coalesce equivalent requests, admit one distinct projection per user and four globally, and cache at most 64 results for five seconds. Revision changes invalidate projections immediately, including feedback from another connection. Cached subscriptions pass the same projection admission checks on a miss. Status never selects the full `result_json` on the host. The candidate reference fixture remains complete (over 100 rows) and uses less than one quarter of the full-row JSON size. Older full-row completed jobs are parsed in the scanner; a main-thread JSON.parse spy confirms that the old result blob is not parsed there.

On missing Genesys deck points, inferred remaining points stay unset and the existing 100-point fallback applies. Known missing bridge-card costs still determine eligibility; supplied `genesysRemaining`, including zero, takes precedence.

## Verification

Node **v22.23.3**. Only targeted existing integration files were run; no new unit-test files or web component edits were made. Judge calls used existing fixture clients/mocks; the compiled smoke check made no judge calls.

- Duel server: **41 passed** across `bridge-engines`, `bridge-search-jobs`, `bridge-workers`, `bridge-api`, `bridge-niche`, and `deck-suggestion-workers` integration files, using `--testTimeout=15000 --maxWorkers=1`. After the final per-caller deadline refinement, `bridge-engines` and `bridge-search-jobs` were rerun: **29 passed**.
- Startup: **1 passed**, targeting `starts with EFFECT_SEARCH=0` in `startup-database.integration.test.ts`. The actual server process recovered from a real SQLite lock and returned HTTP 200 with `ok\n` from `/healthz`. Its database still contained the old graph without `engine_ranking`. The authenticated gameplay route remained protected. The other five startup checks were intentionally not selected.
- Shared: **12 passed** across `bridge-engines.integration.test.ts` and `archetype-bridges.integration.test.ts`.
- Web: **16 passed** in `card-bridges-route.integration.test.ts`.
- Shared production build, duel-server production build and full duel-server no-emit check: passed.
- Compiled JavaScript scanner smoke: concurrent cold four-engine fast query and deep stored scan, followed by compact projection, passed in **2,871 ms** on a disposable WAL database.

Regression checks cover replacing stale queued inputs, independent caller deadlines, duplex deep/interactive/Suggestions execution, pressure beyond the interactive queue cap, worker retirement on a short deadline, twenty coalesced status polls, per-user/global projection admission, feedback invalidation, permanent completion write failures, and explicit-engine admission with unknown deck points. The real startup failure, heartbeat cache invalidation, stale-request rejection, unbounded status projection and compact-storage checks were observed failing before their fixes.

Generated duel-server build output was removed after verification; the shared build directory that existed before this work was restored from its backup. Temporary smoke scripts and databases were removed. Commits stage explicit paths only. No push or PR was made.
