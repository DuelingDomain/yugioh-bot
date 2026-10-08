# Tag facing rules implementation plan

> Execute inline in the dedicated `feat/tag-facing-rules` worktree. Owner decisions of 2026-10-07 authorize the rules below; no additional design approval is needed.

**Goal:** Match the owner's Tag geometry and Konami team Field Spell/direct attack rules in Standard and Domain.

**Architecture:** Keep separate main fields and existing partner material handling. Extend the FFA4 geometry gates to Tag with fixed pairs p0/p1 and p2/p3. Replace the partner's Field Spell at placement and compute ordinary direct attacks from the complete opposing team's monster fields.

**Tech stack:** Patched ygopro-core C++, Lua geometry helpers, TypeScript scenario DSL/Vitest, pinned emsdk 4.0.9 Docker, native nduel.

## Tasks

- [x] Trace seat/team setup, column and Link APIs, EMZ availability, Field Spell placement, and attack target enumeration. Read ADR 0002 and the supplied rulebook/owner decisions.
- [x] Add `tests/scenarios/multiplayer/tag-facing-rules.ts` and `.test.ts`: each facing pair sees mirrored columns and shared EMZ; non-facing opponents and partners do not contribute geometry; facing Link arrows offer linked MMZ; real Field Spell activation and Set replace the partner's old face-up or face-down card in its owner's GY while preserving opponents' fields. Run Standard and Domain variants.
- [x] Update `tag-direct-attack-rule.ts`: ordinary direct attacks blocked by either opponent's MMZ or EMZ; both opposing fields empty permits direct attacks; both opponents' monsters remain targets. Keep explicit card-granted direct attacks.
- [x] Run these tests against the isolated pre-change cores and record expected failures before implementing.
- [x] Generate successive `git format-patch` files (next numbers 0111 onward) from the prepared dev tree: geometry, team Field Spell, and team direct attack. Use fixed yugidraft author/date and the requested commit trailers; never hand-edit generated patches.
- [x] Update obsolete Tag expectations in `df-shared-zones.ts` and check any Tag rows in `attack-direct-all.ts` (it is FFA-only; its header now points to the revised Tag suite). Document the source and any absent/misnamed old scenario reference.
- [x] Build both production multi cores through `build-multi-core.sh` with the exact pinned Docker image/flags used by `build-deploy-multi-cores.sh`, writing only into `~/.cache/dk-duel-engine-tagrules`. Set Node 22 and block core dumps for builds/tests.
- [x] Run only related Tag scenarios, `df-shared-zones.test.ts`, and `multi-scripts-table.test.ts -t 'Mekk-Knight Purple Nightfall'` (plus any other touched geometry card). Inspect real Lua errors and scenario outcomes.
- [x] Run `scripts/run-nduel.sh --check`. New patch fingerprints require explicit `--record`; compare historical rows and explain any step/hash changes before accepting them, then rerun `--check`.
- [x] Update `docs/adr/0002-multiplayer-duel-rules.md`, patch README, coverage references as needed. Add an owner-decisions entry only if that file exists in this worktree. Document the snapshot/UI contract and exact shared EMZ rendering instructions for the UI worker.
- [x] Review the complete diff, fix material findings, commit named file groups with requested trailers; no push or PR. Save hashes/build information and local env path. Delete `domain-core/.build` and `.emcache` after verification.

## Verification commands

Use `set -a; source ~/.cache/dk-duel-engine-tagrules.env; set +a`, Node 22 on PATH, and `ulimit -c 0`. Run Vitest from `packages/duel-server` so its local config/setup applies.

- `npx vitest run tests/scenarios/multiplayer/tag-facing-rules.test.ts tests/scenarios/multiplayer/tag-direct-attack-rule.test.ts`
- `npx vitest run tests/scenarios/multiplayer/tag-*.test.ts tests/scenarios/multiplayer/df-shared-zones.test.ts tests/scenarios/multiplayer/rule-proof-tag-order.test.ts`
- `npx vitest run tests/multi-scripts-table.test.ts -t 'Mekk-Knight Purple Nightfall|Link Spider|Imduk|Saryuja'`
- `bash packages/duel-server/scripts/run-nduel.sh --check` from repo root with isolated `NDUEL_DIR` and `NDUEL_STATUS_DIR`.
