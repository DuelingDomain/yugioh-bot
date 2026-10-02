# Concurrent E2E stack slots

`E2E_SLOT` accepts exactly one digit, 0–9. Unset retains the existing E2E and
manual ports and paths. Invalid values fail before any build or stack writes.

For slot N, default ports are web `3301+10N`, ws `3303+10N`, internal ws
`4304+10N`, and duel `4305+10N`. Explicit `E2E_*_PORT` values win. These ten
families avoid the ordinary 3300 family, manual 3400 family, and live ports.
Manual commands use the same slot family; the login command needs the same slot.

Centralize paths in `stack/env.mjs`: `.stack-N` contains the database, logs,
card images, auth state, Playwright output/report/JSON, multi-seat evidence,
manual data, and persistent profiles. Unset retains every existing path.
Service children use slot-local working directories with absolute entry points;
database and report paths remain explicit.

Each slot builds into `packages/web/.next-e2e-N` via `E2E_NEXT_DIST_DIR`.
Next config and standalone asset packaging honor that variable only when set.
Prepare and start share the derived standalone and build-stamp paths. Production
and Docker defaults remain `.next`.
Next web builds use a shared preparation lock because Next also rewrites config
and type declarations. Slot builds restore tracked config bytes and mtimes before
stamping success. Borrowed dependency symlinks use Webpack for slot builds, avoiding
Turbopack's filesystem-root restriction. Manual wrapper checks verify a local copy
of the installed bytes so Git need not traverse borrowed dependency symlinks.

Shared/duel-server/ws dist remains shared. Prepare checks freshness including
source, package, and TypeScript config changes and avoids fresh builds. Workers
must finish those three builds once before launching concurrent slots; no source
or shared dist mutation during a parallel batch. Slot web builds are independent.

Use the existing Node unit test setup for slot boundaries, invalid input,
override precedence, legacy paths, manual integration, asset packaging, and
freshness. Verify with three concurrent Playwright runs of one small browser spec
against a read-only core snapshot. Stop supervisors and delete generated output,
dist, and dependency symlinks. Keep commits on the requested branch only.
