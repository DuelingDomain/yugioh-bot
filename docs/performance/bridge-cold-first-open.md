# Bridge first-open timeout check — 2026-10-30

The timeout failure path is confirmed; a cold call exceeding five seconds was
not reproduced on this machine. Before this change, every bridge web call had a
five-second transport deadline and engines callers had a 4.5-second host deadline,
including worker startup and queue wait. A cold worker could continue warming
after its caller had already received 503. The browser helper rejected that
response, which made the first-open UI show its unavailable state. An empty-message
abort is not enough evidence to distinguish browser cancellation from the web's
own deadline.

The regression checks delay a first engines/list response until six seconds.
They failed against the old deadlines, then passed after the change. Separate
checks exercise the web's own deadline with an empty-message abort rejection,
retryable host responses, eventual successful detection, permanent failures,
malformed loading responses, and cancellation during a retry delay.

## Measurements

Node v22.23.3, compiled JavaScript, actual Standard saved deck 9, “Light and
darkness azamina” (38 Main, 11 Extra). The live database at
`.worktrees/domain-multiplayer/data/bot.sqlite` was opened with SQLite
`mode=ro` only to create a consistent backup. All replay/benchmark work used that
disposable backup. It contains 13,954 capability rows, 2,677 bridge rows and 68
judgements. No artifact imports, migrations or reviews were run against the live
database.

Each trial constructed a fresh `DeckSuggestionWorkers` pool and called
`bridgeEngines` with the deck, followed by two identical direct worker calls.
These warm timings bypass the host's five-second result cache. Only the caller
deadline was extended to 25 seconds for observation; the real interactive worker
limits remained 208 MiB old generation + 16 MiB young generation. Cold means a
new worker, read-only DB connection and scanner/ranking context; the OS file cache
was not purged.

| Trial | Cold engines | Warm engines | Second warm engines |
| --- | ---: | ---: | ---: |
| 1 | 768 ms | 73 ms | 80 ms |
| 2 | 730 ms | 68 ms | 66 ms |
| 3 | 810 ms | 69 ms | 65 ms |

A compiled `createDuelHost` replay used signed requests and the scratch DB,
including the normal background engine-resource warmup after host construction:

| Request | Status | Duration |
| --- | ---: | ---: |
| First engines detection | 200 | 827 ms |
| Corrected Chaos + Sinful Spoils, same deck | 200 | 76 ms |
| Cached repeat of detection | 200 | 1 ms |
| Sinful Spoils → Azamina directed lookup | 200 | 255 ms |

Every engines answer detected Chaos (weight 6) and Sinful Spoils (4) as engines,
Diabell (3) and Azamina (2) as light, with three next-engine suggestions. These
measurements cannot establish the duration or resource contention of the owner's
historical request.

## Change

Engines requests now have a 20-second host budget, and engines/list reads have a
25-second web budget. Other bridge web calls retain five seconds; completed
projection workers retain 4.5 seconds. Worker counts, memory limits, queue caps,
idle retirement and the 30-second cold-scanner hard cap are unchanged.

The web converts retryable engines 503 responses into HTTP 202
`{ state: "loading", retryAfter: 1 }`, with a validated 1–10 second retry delay
and `Retry-After` header. `fetchBridgeEngines` retries these reads while keeping
its promise pending, so the existing loading UI remains visible. Tab/deck
cancellation stops both active requests and retry timers. Missing ranking data
and early network failures still surface as errors. The web's own engines read
timeout follows the same loading path, including an empty-message abort at the
deadline. List read timeouts have a descriptive still-loading error and retry
hint.

No eager bridge warmup was added: the measured cold duration is under one second,
and the longer deadline plus loading retries cover slower initialization without
adding CPU work to startup. No web component changes are part of this fix.

## Validation

- Web `card-bridges-route.integration.test.ts`: 26 passed.
- Host `bridge-engines.integration.test.ts`: 20 passed.
- Host `bridge-workers.integration.test.ts`: its existing multi-step deep-scanner
  stress test hit its explicit 20-second test limit, including when replayed with
  the original worker implementation from `139f64788`. A temporary timing harness
  completed it in 20.47 seconds. Its overall test limit is now 45 seconds; the
  individual query-deadline and pressure assertions are unchanged. The final run
  passed all seven worker tests and all 20 engines tests (27 total).
- The selected `starts with EFFECT_SEARCH=0` check in
  `startup-database.integration.test.ts`: one passed, five unselected. The real
  child process recovered from a SQLite lock and became healthy with an old graph.
- Shared and duel-server production builds, plus duel-server and web type checks:
  passed.
- The compiled signed-host scratch replay above passed. No judge calls or live
  service restarts were performed.

Only targeted integration tests were used; no unit tests were added. Disposable
timing harnesses, scratch databases and generated build output are removed after
verification. The commit stages explicit paths and excludes concurrent UI work.
