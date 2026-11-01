# Remote deck checks implementation plan

**Goal:** Register saved decks against existing table rules and provide conservative, assistive live deck checks.

**Architecture:** Share the existing editor validator with compatibility exports from duel-server. Snapshot selected decks and normalized rules transactionally. Keep instance tracking and deck-edit decisions pure in shared/remote; persist server-resolved facts in events for deterministic replay. A sighting reuses a hidden instance before creating one. Only simultaneous public locations or a single recognition batch prove additional copies.

**Tech stack:** TypeScript, SQLite additive migrations, Zod event contract, Next/React raw controls, Vitest.

- [x] Share validator and banlist sources; run targeted existing legality tests and build shared.
- [x] Add failing remote integration cases for ready validation, selected-deck ownership, format changes, valid/invalid additions, instance movement, simultaneous sightings, dismissal/merge, replay and migration.
- [x] Add normalized format/deck registration helpers, additive table/seat columns, service operations and authenticated routes. Selected decks are table snapshots; saved originals remain independently editable.
- [x] Add conservative instance reducer, server card facts, proof flags and logged corrections. Keep recognition accepted even if validation metadata is unavailable.
- [x] Add minimal format/deck selectors, validation errors, recognition badge/add action, shared flags and correction controls. Run targeted UI/route tests.
- [x] Update docs/remote-duels/contract.md; review requirements and implementation; fix findings with regressions.
- [x] Run targeted shared/web/ws and moved-validator checks, typechecks/build; delete generated output, commit, push feat/remote-duels, verify clean worktree. No PR or attribution lines.

Validation: 398 targeted tests passed (182 shared, 55 web, 2 WS, 159 validator compatibility), all four workspace typechecks, shared build. Review findings have regressions, including unknown/overlapping positions, hidden reuse/reveal, nonmember privacy, twin ownership, solo owner elimination and account anonymization.
