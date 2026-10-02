# E2E stack slots implementation plan

**Goal:** Run independent Playwright stacks concurrently in one worktree.

**Architecture:** One environment helper selects ports and all writable paths.
Service builds are shared and prepared before parallel work; web builds and
runtime state belong to a slot. Default paths remain backward compatible.

**Tech stack:** Node ESM, Node test runner, Next.js standalone, Playwright.

- [x] Add `packages/e2e/tests-unit/slot-env.test.ts` using subprocess imports of
  `stack/env.mjs` to test unset paths, all ten disjoint port families, rejected
  values, override precedence, and slot-aware manual defaults. Run with
  `node --test packages/e2e/tests-unit/slot-env.test.ts`; expect failures first.
- [x] Implement paths and strict slot parsing in `stack/env.mjs`; make
  `stack/manual-env.mjs` leave port defaults to slots when present. Update
  `playwright.config.ts`, `helpers/players.ts`, `tests/auth.setup.ts`, and
  `tools/{build-index,index-reporter}.mjs` to consume those paths. Add ignore rules.
  Re-run helper tests and E2E typecheck. Commit by explicit paths.
- [x] Test standalone packaging with a tiny temporary web fixture and both
  default and custom dist paths. Add freshness tests with temporary input/output
  files. Implement a small helper, update `stack/prepare.mjs`, `stack/start.mjs`,
  `packages/web/next.config.ts`, and `packages/web/scripts/package-standalone.mjs`.
  Run helper tests; commit this separate build/runtime change.
- [x] Symlink only the requested dependency directories. Build shared, duel-server,
  and ws sequentially once. Build slots 1, 2, and 3 sequentially in the foreground;
  inspect tracked Next-generated file changes before retaining any.
- [x] Run `E2E_SLOT=N E2E_DUEL_DATA_DIR=<read-only snapshot> npm run e2e
  --workspace=packages/e2e -- <same quick spec>` for N=1,2,3 concurrently,
  awaited in the foreground. Capture pass counts, port usage, and distinct paths.
  Assert shared dist and other slots' stamps are unchanged during test startup.
- [x] Review the implementation, run unit tests and E2E typecheck, document
  scheme/commands/proof in `stack/MANUAL.md`, and commit docs by explicit path.
- [x] Confirm all started processes stopped, remove all generated slot builds,
  stack/test artifacts, generated dist and dependency symlinks. Confirm clean
  git status and report commits, proof, incomplete work, and risks.
