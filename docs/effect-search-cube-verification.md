# Cube effect backend verification

Validated with Node 22.23.3 in the assigned `es-cube-backend` worktree. The
[cube UI contract](effect-search-cube-contract.md) records the routes and types.

## Results

- Shared build passed before consumer checks.
- Shared and web TypeScript checks passed.
- Four targeted shared files passed, 76 test cases.
- Six targeted web files passed across the regression runs, 206 test cases.
  The theme-lobby file was rerun after updating its supply-only assertions to
  account for additive health observations. Its 66 cases and the 13 new route
  integration cases passed. The final route/name-resolution run passed all
  24 cases after the last seed and request changes.
- The existing cube list import route also passed its 51 cases during the
  batch-add slice.
- `git diff --check` passed. No code or data from the read-only upstream or
  engine directories was modified. Existing NOTICE and upstream source headers
  remain. Enabled responses carry the exact attribution constant.

The two new test files contain integration checks only: 12 shared SQLite cases
and 13 authenticated route/SQLite cases. They cover engine type precedence,
copy bounds, artwork and config-backed duplicates, atomic rollback, real pinned
tags, deterministic previews, no preview writes, shortage warnings, role quota
capacity, quota-bearing members beyond the retained core page, chosen-row
confirmation, description search, feature disablement, body bounds, community
and user ownership, host-assignment privacy, and unavailable health data.
Existing name-resolution branches keep their old service path. A new name
latency benchmark was not run for this backend slice.

Review found role quota starvation in a large roleless core. The integration
case failed before the fix. Selection now reserves unmet quota space and picks
role-bearing members/partners before ordinary filling. A second case covers
useful members outside the bounded core page and checks their category/reason.

## Commands

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
prlimit --core=0 -- npm run build --workspace=packages/shared
prlimit --core=0 -- npx vitest run \
  packages/shared/tests/cube-effect-search.integration.test.ts \
  packages/shared/tests/services/cubes.test.ts \
  packages/shared/tests/services/cubes-extra.test.ts \
  packages/shared/tests/services/cubes-import-list.test.ts --maxWorkers=1
prlimit --core=0 -- npx vitest run \
  packages/web/tests/cube-effects-routes.integration.test.ts \
  packages/web/tests/cards-resolve-route.test.ts \
  packages/web/tests/drafts-theme-lobby.test.ts \
  packages/web/tests/drafts-theme-table-contract.test.ts \
  packages/web/tests/private-cubes.test.ts \
  packages/web/tests/drafts-booster-preflight.test.ts \
  -c packages/web/vitest.config.ts --maxWorkers=1
prlimit --core=0 -- npm run typecheck --workspace=packages/shared
prlimit --core=0 -- npm run typecheck --workspace=packages/web
```

## Limits and handoff

Seed previews deliberately use the cached catalog and may be short on a cold
cache. Missing tags and unavailable quotas are reported. Health observations
are not deck legality or guaranteed playability. They never add draft errors;
unreadable health returns null with a warning.

No UI components changed. The cube UI worker must integrate the documented
routes and run the required 1920×1080, 2560×1440, 1366×768 and mobile checks.
Existing `:3000` servers were untouched; no development servers were started.
No environment files were read. No paid API requests, GitHub writes, pushes or
deployments were performed.

Generated shared `dist` and web TypeScript build-info were removed after checks.
No `.next` output was generated. `node_modules` and the local JSON web result
remain. Rebuild shared before running consumers again.
