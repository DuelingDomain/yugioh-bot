# Final review fixes

Use Node 22.23.3 and `prlimit --core=0`. The no-env-file preload remains active.
No engine data was changed.

## Artifact boot lock

On 2026-10-20, take an online SQLite backup of the running local service DB.
The copy has 14,793 catalog cards. Remove only artifact-owned tags/profiles and
import markers from the copy before the first run. Keep manual rows. Load the
same engine cards and passcode remaps as the duel service. Run the importer
first, then again on the same copy. Remove the copy after measurement.

| Start | Import elapsed | Write lock |
| --- | ---: | ---: |
| First | 1,416.61 ms | 733.95 ms |
| Second | 497.96 ms | 75.67 ms |

The lock measurement spans SQLite's `BEGIN IMMEDIATE` to the `COMMIT` callback,
just before commit execution. It excludes database open/migrations and the
engine load. There is no competing writer on the private copy. This is a local
DB measurement, not a production VM boot measurement. The script and JSON are
in `.status/effect-search/final-review/`. No credential values are recorded.

All five compressed and decompressed file hashes are checked before the write
transaction. Verified bytes stay in private temporary files; the importer does
not retain a full decompressed tag catalog. The spools close on success and
failure. The first and repeat import integration test checks this boundary;
the bounded-heap test still imports and reopens the complete real artifact.
With `EFFECT_SEARCH=0`, duel effect startup makes no database changes and does
not load artifact or effect-index state.

## Ledger and token

The slow-store integration check delays every GitHub HTTP request by 1.5 s.
The paid call completes once and the durable runtime row ends in `settled`.
Separate checks cover lost reservation/intent responses, intent conflicts,
rollover before POST, paid timeouts and live-CI expiry of old reserved rows.
The token check proves missing/blank dedicated tokens make no HTTP request,
even when `GITHUB_TOKEN` is present. Owner setup is in `effect-tagging.md` and
the PR 412 description.


## Flag-off picks

The integration test checks explicit `EFFECT_SEARCH=0` and the production
unset default. Each eight-seat pick step makes exactly eight uniform random
draws. Bot and expired-pick cards match the former policy, even with corrupt
effect tags. The flag-on draft scenarios keep using the scored policy.

## PR and local publish result

PR 412 CI passed on `157fad4f93c4a0b15655b6d11905e03d4dcbaff2`.
[CI run 39448057790](https://github.com/DuelingDomain/yugioh-bot/actions/runs/39448057790)
completed with success. Checks were polled as text every two minutes. No
branch-caused CI failure occurred. No PR was merged.

Pushed branch heads:

- Effect search: `157fad4f9` (four fix commits: `c9ca93289`, `4e40f0e2e`,
  `805b90a59`, `157fad4f9`).
- Deck suggestions: `02740b659`. Kept the quality evaluation and new ledger tests.
- Release dates: `9f2b28131`. Kept release-fill docs and owner token steps.

Local ports are `44a1a49b8`, `d71710c9e`, `78c51efe9`, `d71c0ad91`.
A local-only test import repair is `e3fc7dbe8`. The production code retains the
local transport and engine warm start, plus the installed release artifact pin.
Shared and duel TypeScript builds, the web webpack production build and
standalone packaging passed. The duel build was staged before replacing dist.
The local expiry check passed. Search/draft checks passed; 25 artifact checks
passed, then the missing spy import was repaired and the remaining check passed.
All 119 duel search checks passed against the live `engine-facing` snapshot.
An earlier run used an older snapshot without a required fixture card; no engine
file was changed to address it.

Published on 2026-10-20 at about 15:42 UTC. A systemd bus reference kept the
transient web unit loaded across stop/copy/start. The gap was 0.49 s. Rsync
excluded `.env*`. The duel unit restarted after its completed build was copied.
The restart lost a temporary sandbox allowlist. The unit was recreated with its
existing Node command, working directory, environment-file references and
settings; the allowlist came from the running web process in memory. No
allowlist values or credentials were saved in this report. Both units have
LimitCORE=0 and retain the existing no-env-file-read preload. Both use the same
DB and engine paths and the same sandbox allowlist.

Live owner checks passed for `hand trap` (183 effect hits) and
`hand traps that negate` (48). Signed host and web API results match. Chromium
passed both queries at 1920x1080 and 390x844, including required card names,
reading chips, counts and no searchygo text. No page error occurred. The reused
verification harness had a stale assertion for visible attribution; it now
checks that attribution is absent. Evidence is in
`.status/effect-search/live-3000/`.

The temporary web build, staged duel build and build DB were removed after
publication. Installed web/duel/shared runtime files remain in place.
