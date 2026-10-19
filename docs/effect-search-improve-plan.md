# Effect search backend implementation

Approved scope: owner request, 2026-10-19. Base: b5ca17200.

- [x] Extend the existing real-engine eval with soft unknown words, relax counts,
  similarity, counters, and deterministic short reasons. Capture baseline performance.
- [x] Share query validation and deterministic matching helpers. Port credited
  counters and derive counter weaknesses from the pinned archetype hooks.
- [x] Extend compact host search and SQL insights. Preserve every outer filter,
  independent effect pagination, and the existing first name group.
- [x] Add permanent SQLite phrase claims/cache and hourly user/global limits.
  Authenticated host/insights make one bounded Messages POST after low-confidence/empty reads;
  successful name searches skip it. No credentials or user identities enter prompts.
- [x] Extend the CI ledger with runtime reservations under the same $10 cap and
  Git CAS. Missing/corrupt/conflicting ledger or credentials fail closed.
- [x] Extend existing integration files with mocked HTTP, cache/restart/concurrency,
  validation, timeout, budget, rate, flag, and authenticated API coverage.
- [x] Run affected builds/typechecks/evals, compare fresh-process RSS and name
  latency, document response fields and results, remove build output, commit.

No web components, engine resources, real paid calls, pushes, or environment-file reads.
