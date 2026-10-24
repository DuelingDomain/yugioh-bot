# Local card drawer and status integration plan

**Goal:** Add PRs #459 and #465 to `test/local-main`, with reproducible sandbox URLs on port 3000.

**Architecture:** Follow the existing local review fixture seeder and independent engine bundle. Merge upstream changes, preserve sandbox controls, build and copy the standalone web bundle into `web-live`, and restart only the three named user units.

**Stack:** Node 22.23.3, TypeScript, SQLite, Next.js, Emscripten multiplayer cores, systemd.

- [x] Fetch both heads. Merge #459; poll #465 every few minutes for at most one hour until `b5da75c49` is its ancestor.
- [x] Merge #465 and resolve conflicts by retaining both features and sandbox behavior. Assign a unique higher host rule version if necessary.
- [x] Add three fixtures in `scripts/local-ready-pr-scenarios.ts`: FFA4 drawer chain/target selection, FFA3 status, and 1v1 status. Use legal manual actions for counters, equipment, and negation because saved boards cannot inject those states.
- [x] Apply the wrapper patch and run `duel:prepare` against `data/engine-local-ready`. Build `multi` and `multi-domain`, install matching metadata/checksum sidecars, and record/check native golden rows.
- [x] Validate and seed fixtures without changing existing IDs. Exercise real-engine status/drawer regressions and each new fixture; build shared, duel-server, ws and web.
- [x] Sync the packaged standalone web build into `../web-live`. Restart `yugidraft-web-local`, `yugidraft-duel-server`, and `yugidraft-ws-local`; verify port 3000 and live duel startup with logs.
- [x] Document actual URLs, setup actions, validation, conflict fixes, and failures in `docs/testing/local-ready-pr-scenarios.md`. Remove unused build output and engine `.build` folders, then commit on `test/local-main` without pushing.

User supplied the integration scope, fixture requirements, target branch, deployment paths, and completion requirements. Execute this plan in the existing checkout.

Validation: both real-engine status setups and the FFA4 chain/target sequence passed. Golden replay checked 80 rows with no mismatches. Targeted shared/server/web suites passed. Browser review found and fixed a target-pick LP overlap, with a failing then passing regression. All three saved fixtures started through the deployed service after build cleanup. See the scenario guide for detailed results and local harness notes.
