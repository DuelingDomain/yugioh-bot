# Trap synergy filter correction

The coordinator's supplied design authorizes this bug fix and the complete audit. Existing search shares, diversity, constraints and pagination stay in force.

- [x] Reproduce the Temple Counter Trap false positive in SQL and real-catalog integration tests, including narrow filters stored in `other`, hand/Deck Sets and GY recursion.
- [x] Update `packages/shared/src/cards/effects/synergy-search-hooks.ts` to check the same action/trigger filter against the Trap mechanic: Normal Traps for Labrynth, Normal/Continuous Traps for the Set-Trap plan. Use `filterReachesCard`; reject unresolved narrow restrictions. Distinguish Deck/hand setup from weaker GY recovery and describe the matched action concretely.
- [x] Audit every retained Temple/Labrynth Works with entry against its printed clause through both query entry points, using the existing catalog read-only. Remove false matches and record conditions, exclusions and exact lists in `docs/performance/archetype-synergy-trap-audit.md`.
- [x] Run the affected integration suites and shared/duel typechecks. Review the diff, delete generated build output and audit scratch files, then commit only explicit owned paths, retrying index locks.

No unit tests, web/bridge implementation edits, live database writes, environment-file reads, paid calls, service restarts or changes to `data/duel-engine`.
