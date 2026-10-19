# Effect search foundation implementation plan

The owner-approved build and integration briefs in `data/briefs` are the source design. The current task extends that design to include card/deck synergy and SQL insight APIs. Explicit owner decisions supersede the older clean-room, summary-label, phase and flag wording in the briefs.

## Architecture and boundaries

- `packages/shared/src/cards/effects/`: credited searchygo schema, vocabulary, query reader, matcher, archetype hooks and card/deck links. Pure functions accept a small normalized card shape. Reuse the existing card name matcher for aliases and typos.
- Pinned compressed data under `packages/shared/data/effects/`, with source commit, hashes and schema version. An atomic SQLite importer folds artwork IDs and engine remaps, tracks artifact versions and records text hashes. Independent of engine bundle identity.
- `card_tags`, `card_tag_profiles` and import-version state are migrated with the shared DB. Passcode remaps carry tags alongside catalog data.
- Duel host: a compact, summary-free facet index, constructed once at startup. The existing catalog scan applies the current filters before matching effects. Ordinary name queries retain their current path. Additional effect results have their own group and pagination metadata.
- `createCardInsightService(db)`: bounded SQL iteration for summaries, effect results, card/deck synergy, pool health and draft scores. No full JSON artifact in web memory. API input limits and existing configured-guild guards apply.
- `EFFECT_SEARCH`: literal `1` enables and `0` disables; absent defaults on outside production. APIs report the capability. The UI shows no searchygo credit; attribution lives in `NOTICE`.

## Implementation sequence

- [x] Install dependencies with Node 22 and record the baseline card-query latency/memory.
- [x] Copy/adapt schema, vocabulary, reader and matcher; integration-test the real tags including Spellcaster slot assignment and aliases.
- [x] Pin/import tags and profiles, migrate tables and verify canonicalization, re-import idempotence, remaps and corruption failure.
- [x] Add explainable card/deck synergy, SQL insight service and scoped insight routes.
- [x] Add compact duel index and effect group to host/card-query without changing existing admission and format filters.
- [x] Add deck-browser interpretation, exact control and attribution; check the requested desktop/mobile viewports.
- [x] Implement Haiku Batch tagging of only new/changed text, with a persisted monthly $10 reservation cap and CI validation.
- [x] Run roughly 60 real-artifact query cases in CI, report labeled precision, catalog coverage, name latency and index memory.
- [x] Run targeted integration/regression tests and shared/web/duel-server tsc, review contracts, commit in small slices, remove generated build caches.

## Validation and delivery

New tests are integration/e2e only. Existing targeted tests may be updated when the contract changes. Commands use Node 22, `prlimit --core=0`, and Vitest `--maxWorkers=1` (web config explicitly). No pushes, no other worktrees or port 3000 servers, no environment-file reads and no writes to engine data. Source headers and NOTICE retain author/commit credit. All commits include the owner's required trailers. `docs/effect-search-contract.md` will state exact exported signatures, routes, request/response fields, tables, capability and attribution.
