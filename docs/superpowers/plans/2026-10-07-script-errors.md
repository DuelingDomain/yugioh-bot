# Card script error tolerance implementation plan

> For agentic workers: use the subagent-driven-development skill for the independent block-list task and review.

Goal: follow the owner's 2026-10-07 decision: report runtime card-script errors and continue all duel engines.

Architecture: one conservative classifier shared by legacy and pinned engines; setup errors and unrecognized core errors remain fatal. Deterministic generic script-error events and existing text logs contain no hidden identities. Worker replies carry private error metadata to a host recorder, which deduplicates by duel ID, seeded command-path hash and deterministic error ordinal before incrementing SQLite counters. Deck legality uses an empty repository block list outside engine bundle identity.

Tech stack: TypeScript, ocgcore-wasm, better-sqlite3, Vitest; existing compiled WASM only.

- [x] Verify pinned interpreter and processor recovery, capture the stock c3743515 reproduction, and add failing classification/integration tests.
- [x] Implement shared classification, tolerant defaults/strict override, generic event/log messages, and deterministic private error ordinals in both engines.
- [x] Add SQLite migration, structured logging, occurrence deduplication and top-errors CLI; connect private worker telemetry to the host (replay viewers have no recorder).
- [x] Add repository block list, all-format validation/start rejection and unavailable search flags, with targeted tests (delegated independent task).
- [x] Document classification, environment switch, replay/privacy behavior and block-list workflow in deployment documentation.
- [x] Review specification compliance and code quality; run only targeted tests with Node 22, prlimit --core=0, --maxWorkers=1, and native --check without changing golden rows.
- [x] Commit each logical part with the requested co-author trailer. Remove dependencies and build outputs created during this task; report evidence, tests and commit SHAs in at most 15 lines.

Constraints: work only in this worktree; no .env reads, WASM builds, pushes or other-worktree edits. Source data/duel-engine is read-only; copied resources are under data/script-error-tests. Long jobs remain foreground processes.

## Approved review follow-up

User's reviewed fixes are the implementation design; execute inline in the same worktree.

- [x] Merge origin/main (keep both documentation sections); no rebase or push.
- [x] Isolate card callbacks in views and runtime FFA scripts; private query telemetry only; generic fatal text. Verify real-engine queries, three accepted answers, recovery and replay.
- [x] Coalesce process events per answer, cap per-duel/card telemetry at 20, remove centre banners, and guard 100,000 process calls without a prompt.
- [x] Replace stock Sabersaurus crash dependencies with a synthetic test script, and remap block-list passcodes through the bundle remaps.
- [ ] Key process telemetry by journal position plus request ordinal; bound old occurrence rows.
- [ ] Run targeted Node 22 tests with prlimit --core=0 and --maxWorkers=1, typechecks and native golden --check; remove generated build output. Commit each review item with the requested trailer.
