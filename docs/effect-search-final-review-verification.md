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
