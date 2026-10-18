# Effect search integration and performance plan

The owner approved the design in the task and the effect search contracts.
Execute in the assigned worktree. Do not push.

- [x] Measure the old seed preview and facet import with Node 22.
- [x] Merge the date branch with both publication and draft-pick intents.
- [x] Pass cube era through seed preview, worksWith and pool health.
- [x] Prepare seed members, hook matches and role sets outside requests.
      Cache phrase selection for five minutes, include size and era, and
      retain the user request guard. Exclude current cube identities.
- [x] Stream artifact records to the shared disk database. Reuse a verified
      artifact version and release import data before index construction.
- [x] Check integration tests, the 60-query evaluation and date cases.
      Check shared, web and duel-server TypeScript after rebuilding shared.
- [x] Check the UI at the four required sizes, including hover and badges.
- [x] Record speed, retained RSS and startup peak. Review the changes.
- [x] Commit with the required trailers. Remove generated build output.

Baseline: 13,702-card seed, `dark magician`, size 180: 6.424 s.
Old in-memory benchmark: RSS growth 73,162,752 bytes (69.77 MiB), retained
facet heap 18,456,920 bytes. Raw memory report:
`.status/effect-search/perf-before.json`.

Files: seed selection and preparation in `packages/shared/src/services/`;
cube routes in `packages/web/app/api/cubes/`; streaming artifact and compact
host facets in their existing modules. Use integration/e2e tests only.
