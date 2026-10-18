# Cube effect backend verification

See [the integrated performance report](effect-search-performance-verification.md)
for the later seed cache and preparation changes. The measurements below record
the earlier backend state.

Validated on `feat/effect-search-cube-backend` with Node 22.23.3 in the assigned
`es-cube-backend` worktree. This report covers the review fixes after
`1e912bf82`; the [cube UI contract](effect-search-cube-contract.md) records the
current routes and types.

## Review fixes

- Pool health requires `includeHealth: true`, passed only by the web preflight
  route. Health warnings stay in `poolHealth[].health.warnings`; supply and
  lobby warnings keep their original meaning. Unavailable health returns null
  and reports the failure on the server without adding a supply warning.
- The three original cube supply assertions are restored. Theme-lobby checks
  assert the unfiltered error/warning arrays, allowing the additive preflight
  response fields. With `EFFECT_SEARCH=1`, a real theme-lobby GET returns no
  health warnings and prepares no insight/tag statements. Shared integration
  coverage also verifies that the insight catalog factory is never called
  unless health is explicitly requested.
- Seed selection records every first-pass core match in a Set and reuses it
  during partner selection. One unfinished preview per user is allowed across
  cubes in each web process. The reservation begins before body reading and
  releases in `finally`. Route integration checks verify 429 for an overlapping
  request, independent access for another user, and release after success and
  validation failures.
- Preview and foundation insights share validated archetype-profile reads.
  Invalid JSON, non-array hooks and null hooks are skipped. Previews include a
  warning; foundation suggestions log the warning and retain card-level links.
- Effect resolution warms display metadata only with an explicit pool, passing
  `createCardLookupBudget()` explicitly. Unscoped effect results and existing
  name-resolution paths do not invoke that warming step.

## Results

- Shared build passed before consumer checks.
- Five targeted shared files passed: **89 tests**, including the real-catalog
  benchmark.
- Six targeted web files passed: **209 tests**.
- `tsc --noEmit` passed for **shared, web and bot**.
- `git diff --check` passed. A final independent read-only review found no
  blocking issues in the three fix commits.
- Regression cases failed before their respective fixes, including the restored
  supply assertions, malformed profiles, overlapping previews and metadata
  warming assertions. All new cases are integration checks; no unit tests
  were added.

## Real catalog measurement

The supplied `/home/sulman633/repos/yugioh-bot/data/bot.sqlite` contains 2,047
cached catalog rows and no effect-tag tables. The opt-in integration benchmark
opens it read-only and backs it up to a disposable temporary database. It
migrates that copy, imports the pinned tag artifact and fills missing catalog
rows from the read-only engine data, producing **13,702 real cards**. Setup is
outside the timed operation. No source database or engine files are changed.

For `dark magician`, 180 requested rows, `console.time` around `previewCubeSeed`
measured **9.133 s before**, **7.811 s after** the seed changes, and **7.961 s**
on the final regression run. These are individual local measurements, not a
latency guarantee. Because the result exceeds 300 ms, the per-user in-flight
guard is included. The scan remains synchronous and can block the web process;
the guard limits overlap per user but does not move work off the request thread
or coordinate separate web processes.

The optional benchmark is skipped unless `CUBE_SEED_BENCHMARK_DB` is set. Its
temporary database is deleted after the measurement.

## Commands

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
prlimit --core=0 -- npm run build --workspace=packages/shared
CUBE_SEED_BENCHMARK_DB=/home/sulman633/repos/yugioh-bot/data/bot.sqlite \
prlimit --core=0 -- npx vitest run \
  packages/shared/tests/cube-effect-search.integration.test.ts \
  packages/shared/tests/card-insights.integration.test.ts \
  packages/shared/tests/services/cubes.test.ts \
  packages/shared/tests/services/cubes-extra.test.ts \
  packages/shared/tests/services/cubes-import-list.test.ts \
  --maxWorkers=1 --silent=false --reporter=verbose
prlimit --core=0 -- npx vitest run \
  packages/web/tests/cube-effects-routes.integration.test.ts \
  packages/web/tests/cards-resolve-route.test.ts \
  packages/web/tests/drafts-theme-lobby.test.ts \
  packages/web/tests/drafts-theme-table-contract.test.ts \
  packages/web/tests/private-cubes.test.ts \
  packages/web/tests/drafts-booster-preflight.test.ts \
  -c packages/web/vitest.config.ts --maxWorkers=1
prlimit --core=0 -- npx tsc --noEmit -p packages/shared/tsconfig.json
prlimit --core=0 -- npx tsc --noEmit -p packages/web/tsconfig.json
prlimit --core=0 -- npx tsc --noEmit -p packages/bot/tsconfig.json
```

## Scope and cleanup

No UI components changed; browser viewport/hover/badge checks were not rerun
for these backend review fixes. Existing `:3000` servers were untouched and no
development servers were started. No environment files were read. Engine and
upstream source data, NOTICE and copied-source attribution headers remain
unchanged. Enabled successful effect responses retain the exact searchygo
attribution constant.

No paid APIs, pushes, deployments or external messages were used. Generated
shared `dist` and web TypeScript build-info were removed after verification;
no `.next` output was generated. `node_modules` remains. Rebuild shared before
running consumers again.
