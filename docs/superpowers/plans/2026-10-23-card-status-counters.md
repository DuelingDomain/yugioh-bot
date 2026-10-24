# Card status and counters implementation plan

**Goal:** Expose live public card hints, protection categories, counters and base stats in both engine families, with no UI changes.

**Approved design:** Owner-approved `.fx-demo/status-counters/{index.html,data.js,cards.js}` in the main checkout. Scope and acceptance criteria are the owner's backend/data task.

**Architecture:** Derive hint memory exclusively from ordered engine messages, following card instances through field moves and clearing them on departure or face-down resets. Resolve descriptor IDs through the card database, classify only active hint text, and expose JSON-safe IDs. Keep existing counters and negated contracts compatible. A shared static counter catalog follows the demo. Protection overlays add client hints to actual live effects without changing their rules.

**Tech stack:** TypeScript, shared duel contracts, Lua script overlays, Vitest real WASM engine scenarios.

## Tasks

- [x] Inspect both engine/view implementations, resource preparation, overlay manifest and real-engine scenario support.
- [x] Add shared counter catalog (demo families, 17 primary glyphs, official IDs checked against strings.conf and constant.lua); named counter type alias keeps `{type,count}` shape. No pure unit tests.
- [x] Write failing real-engine scenarios for Dracombatant Tribute Summon / destruction, counters and base stats, and negated public views in legacy, pinned and multi engines.
- [x] Implement shared per-instance hint tracker, ordered descriptor add/remove processing and lifecycle resets; wire both engines and project public hints with categories and resolved text. Add BASE_ATTACK / BASE_DEFENSE queries.
- [x] Select about 20 staple protection cards from repository format/effect data and verify absence of stock client hints. Add an overlay manifest and hints attached to live protection effects, supporting legacy via its existing shared script-loading path if feasible. Verify real effects and conditions with targeted engine tests.
- [x] Review contract, replay determinism, identity moves, privacy and overlay deployment integration; fix review findings.
- [x] Run only targeted real-engine tests and shared/server TypeScript checks. Commit logical changes with required coauthor trailer, push branch, no PR.
- [x] Remove worktree dependency folders, generated build output and engine .build; report contract, patched cards, verification and commit IDs.

## Validation

Use Node 22.23.3 first in PATH. Read engine resources at `/home/sulman633/repos/yugioh-bot/data/duel-engine` without modifying them. `DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1` and explicit core paths prevent silent skips. Build shared before consumers. Use `tests/support/cores.ts` gates and real engine games; do not add pure unit tests. Wait for long jobs in foreground and preserve main-checkout changes.

## Completion evidence

- Branch `feat/card-status-counters` created from `origin/main` in the requested isolated worktree and pushed without a PR.
- 224 cases passed across `card-status-real`, `card-hints-lifecycle-real`, `attack-stats-real`, and `protection-hints-real`; two existing real-core decoder cases also passed. No required engine cases skipped.
- 44 existing deployment installer integration checks passed. Shared and duel-server builds/typechecks passed; shell syntax and whitespace checks passed.
- An extra real A-Counter case exposed the historical legacy type/count swap, now corrected in the package patch and covered in public views plus all six cores' single/location queries.
- Compatible multiplayer test cores were copied temporarily from another workspace and removed after verification; provenance and reproducible build instructions are in `docs/card-status-protection-overlays.md`.
- All task-local node_modules, generated dist output, temporary core copies and engine build output were removed. The original checkout and its data were not changed.
