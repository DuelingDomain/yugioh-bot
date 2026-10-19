# Local test stack port implementation plan

> **For agentic workers:** Use executing-plans to execute these tasks in this worktree. Keep the user constraints below.

**Goal:** Port both requested fixes to test/local-all and verify the services on port 3000.

**Architecture:** Cherry-pick the four branch commits in order. Resolve conflicts by hand. Keep the sandbox and NextAuth Discord access checks. Use OWNER_USER_IDS for private report access. Change signed stat reads in the existing wrapper; do not apply the package patch to that wrapper.

**Tech Stack:** TypeScript, Vitest, Next 16, SQLite, ocgcore-wasm, user systemd services.

## Constraints

Use Node 22.23.3 and prlimit --core=0. Keep the no-env-file-read preload. Do not read .env files, push, stash, use reset --hard, or kill by name. Do not change data/duel-engine or data/duel-engine-next. Back up each changed active engine file. Keep both requested trailers on each new local commit. Wait for long jobs in the foreground. Resolve all active paths and symlinks before writes. Skip the wrapper work if the real path is under either forbidden engine directory.

## Task 1: Port signed combat stats

- [x] Check the tests from 073453300 and ae9cd6a9d against local code before the fix where possible.
- [x] Cherry-pick 073453300, then ae9cd6a9d. Resolve conflicts in docs/engine/ocgcore-wasm-abi.md, patches/ocgcore-wasm+0.1.2.patch, packages/duel-server/tests and packages/web/src/components/duel by preserving local behavior.
- [x] Back up node_modules/ocgcore-wasm/dist/index.js. Change current/base ATK and DEF reads from u32 to i32 in the local query and BATTLE parsers only. This wrapper uses Q for legacy queries too; it has no Ql function.
- [x] Confirm the active engine path from the duel process. Back up its manifest.json, update integrity.wrapper, and derive bundleVersion by the existing algorithm. Verify the bundle.
- [x] Run attack-stats-real, host-replay-cross-version, attack-stats.integration and summon-stats tests. Use the active engine directory and require cores.

## Task 2: Port bug report flow

- [x] Cherry-pick 9bd0e25e3, then 00df21832. Resolve conflicts in packages/shared/src/db/schema.ts, services, packages/duel-server/src/host.ts, packages/web/app/api/bug-reports, report components, navigation and tests.
- [x] Adapt owner access and submitter identity to NextAuth, OWNER_USER_IDS and discord-web-access. Keep sandbox checks. Redirect unauthenticated owner page requests to the local sign-in page.
- [x] Run shared bug-report tests, duel host-bug-context tests, and web bug-report route, flow, host, library and GitHub tests. Omit the nonexistent Clerk account-deletion service and test.

## Task 3: Build and publish

- [x] Build shared, duel-server, and web in that order. Build web with webpack, then package standalone. Use the existing no-env-file-read guard.
- [x] Review the diff and record conflict adaptations and test results.
- [x] Rsync standalone into ../web-live, exclude .env files and preserve the guard. Copy packages/shared/data/effects into the deployed shared package.
- [x] Restart yugidraft-duel-server and yugidraft-web-local directly. Recreate only if a unit is missing, using the existing process settings without printing credentials.
- [x] Verify both units, bundle integrity, port 3000, and the owner report page with an authenticated local session. Verify private report API access.
- [x] Commit any port adjustments and this record with the requested trailers. Report all local SHAs, adaptations, wrapper hashes, checks and limits.

## Port decisions and checks

- Keep the local player schema. Save the submitter as a Discord string ID, the player display name, and the nullable email from the authenticated NextAuth session. Old rows use the player identity with no email.
- Keep `requireWebAccess`, `discord-web-access`, and `OWNER_USER_IDS`. Redirect unauthenticated report page requests to `/login`.
- Keep the sandbox routes and menu link. Put the report link on Settings, visible only to an allowlisted owner. Keep the separate guild-admin card-data menu rule.
- Omit the Clerk account deletion change and its test. That service does not exist in this worktree.
- Keep the local signed HTTP transport and logging. Add the branch capture timeout and retry metadata to it.
- Adapt the branch test fixtures to local player rows and NextAuth. Do not call a live GitHub write API.
- The first 11 engine stat regressions failed with unsigned `4294967294`. All 11 passed after the wrapper correction. The replay and host capture suites also passed: 100 duel tests in total.
- The 12 shared report tests passed after the player-schema adaptation. The shared and duel builds passed. The engine bundle verification passed.

### Active wrapper

Only eight reads changed in `node_modules/ocgcore-wasm/dist/index.js`: four query fields and the four attacker/target battle fields. The local `Q` parser also handles legacy queries; there is no separate `Ql` function. The package patch was not applied to this wrapper.

- Previous wrapper SHA-256: `1098364ea36ff76c52b5d2f26ace3ec53db9bc6d10009b772c3626ce03dc990d`.
- New wrapper SHA-256: `0b569a445af2ee9b61b8342f6cd1e7993f42e4b3fd03851e4e8db293b38ebf91`.
- Active manifest: `/home/sulman633/repos/yugioh-bot/data/engine-facing/manifest.json`.
- New bundleVersion: `73c0ee5cc06ee14a273b0004ef9802b2d8e20e5ec721e9f703d8bf5b25c10aaf`.
- Both files have a sibling backup with the suffix `.local-all-port-20261019.bak`.
- The real paths were checked before writes. No file in `data/duel-engine` or `data/duel-engine-next` was changed.

## Final verification and publication

- Shared: 12 report service and migration tests passed.
- Duel server: 100 signed-stat, replay comparison and report capture tests passed. Required cores were available; no test was skipped.
- Web: 298 report flow, host transport, dialog, route, privacy, summon, Settings, navigation and sandbox checks passed. The 10 real engine-to-inspector checks also passed. All 420 targeted tests passed.
- The shared build, duel-server build, final Next production build with webpack, and standalone packaging passed with Node 22.23.3 and the no-env-file-read guard.
- Code review found a navigation access mismatch. The Settings owner link fixed it, and the reviewer confirmed the correction.
- Copied standalone to `/home/sulman633/orca/workspaces/yugioh-bot/web-live/` with rsync. Excluded `.env*`. Copied all seven shared effect files. Verified that the deployed server, build ID, bundled report routes and effect files match their build sources. The report service is bundled in the routes; it is not a separate file in standalone.
- Restarted both existing user services directly. Both are active with `LimitCORE=0`, `NRestarts=0`, and the no-env-file-read preload. No unit recreation was needed.
- The duel server passed its startup bundle check and listens on port 4003. A separate call to `verifyEngineBundle()` also passed with the new bundleVersion.
- Browser verification on port 3000 passed: the owner Settings link is visible, the report page loads, and there are no page errors. The owner list API returns 200 with `private, no-store`. Anonymous report page requests redirect to `/login`.
- The live list contains no reports. The detail route and stored board/log access were verified with synthetic data in the route tests; no live report was created and no live GitHub write was sent.
- The service environments still share the same sandbox allowlist, database path and engine path. Effect search remains enabled.
- Evidence: `.status/local-all-port/prove.mjs`, `live-results.json`, and `wrapper.json`. They contain no session tokens or environment dumps.
- No `.env` file was read. No push, stash, hard reset, or kill by process name was used. The worktree stays on `test/local-all`.

## Local commits

| Source | Local | Change |
| --- | --- | --- |
| `073453300` | `84d67767e` | Signed combat stats and display |
| `ae9cd6a9d` | `439dda950` | Replay comparison and summon effects |
| `9bd0e25e3` | `a72137ad1` | Report capture and owner page |
| `00df21832` | `f56bd2799` | Report privacy and local auth adaptations |

Each port commit keeps both required Claude trailers. The final local record commit also has both trailers.
