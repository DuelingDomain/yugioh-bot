# Remote replay rebuild

Measured on Node v22.23.3 using five fresh in-memory SQLite databases per mode.
Each duel has 2,203 journal events, two seats and 40 cards (10 on the field and
30 in the graveyards). After card placement, the journal mixes phase changes,
LP changes and notes, then ends with a concession. Fixture construction is
outside the measured interval. Applying all returned patches verifies the final
projected board; a second service instance verifies reuse of the cached result.

The baseline is `origin/main` at `0ca8f5af3`, with its original Remote service
compiled separately. The changed web path uses `replayFramesAsync`.

| Measurement | Baseline, median (range) | Incremental, median (range) |
| --- | --- | --- |
| Cold rebuild | 447.22 ms (432.78–475.13) | 454.93 ms (452.68–545.53) |
| Longest event-loop timer gap | 450.58 ms (434.83–477.58) | 17.12 ms (10.67–17.31) |
| JSON serialization | 1.21 ms (1.11–1.68) | 1.31 ms (1.22–1.86) |
| Cached open | 0.70 ms (0.58–0.79) | 0.79 ms (0.64–0.85) |

Both responses contain 668,098 UTF-8 bytes, about 55,750 bytes with gzip. The
payload already uses board patches rather than full boards per event. It stays
as one JSON response; the expensive rebuild now yields approximately every
8 ms, retaining the existing six-entry cache. Snapshot capture and individual
event reduction remain synchronous. This reduces web blocking rather than the
total work required to rebuild a replay. A 1 ms interval measures timer gaps
through rebuild, serialization and the cached read; it runs once during the
baseline and 53–65 times during incremental rebuilds.

Run the benchmark after building shared:

```sh
npm run build --workspace=packages/shared
node scripts/performance/remote-replay.mjs
# Compare the retained synchronous API on the same fixture:
node scripts/performance/remote-replay.mjs --sync
```

No application database is accessed. Timings vary with machine load and do not
include HTTP, authentication, compression or network transport.
