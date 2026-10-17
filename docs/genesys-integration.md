# Genesys integration verification

Genesys settings, verified points, deck admission, saved-deck editing, and live/replay
field layouts are integrated. The branch also retains the owner's committed waiting-room,
edit-link, idle-notice, and live-list fixes.

## Main merge

`origin/main` is merged without rewriting feature history. Resolution retains main's
host rule version 6, viewer-log privacy checks, Droll behavior, larger fields, Deck
Master emblem, edge drawers, and test cleanup. The host error test conflict uses
main's file; the added mocked transport cases stay removed.

## Test policy

Only integration and e2e coverage is retained in the touched areas. Mixed files
remain when they exercise real SQLite, routes backed by real SQLite, real child
processes, or the duel engine. No e2e spec is removed.

Removed pure test files (including files deleted by PR #379):

- `packages/bot/tests/services/genesys-sync.test.ts`
- `packages/duel-server/tests/engine-resource-resolver.test.ts`
- `packages/duel-server/tests/replay-cursor.test.ts`
- `packages/duel-server/tests/views-shared-extra.test.ts`
- `packages/shared/tests/duels/genesys.test.ts`
- `packages/shared/tests/duels/settings.test.ts`
- `packages/web/tests/api/duels-deck-validate-route.test.ts`
- `packages/web/tests/components/deck-editor.test.tsx`
- `packages/web/tests/components/duel-creator-genesys.test.tsx`
- `packages/web/tests/components/duel-deck-name-search.test.tsx`
- `packages/web/tests/components/duel-genesys-deck-choice.test.tsx`
- `packages/web/tests/components/duel-import-save-names.test.ts`
- `packages/web/tests/components/duel-import-save.test.tsx`
- `packages/web/tests/components/duel-tag-shared-extra.test.tsx`
- `packages/web/tests/components/genesys-badge.test.tsx`
- `packages/web/tests/components/tournament-rules-form.test.tsx`
- `packages/web/tests/duel-genesys-labels.test.ts`
- `packages/web/tests/genesys-deck-model.test.ts`
- `packages/web/tests/genesys-deck-picker.test.ts`
- `packages/web/tests/sheet-rules.test.ts`
- `packages/web/tests/table-grid-emz-gate.test.tsx`
- `packages/web/tests/table-grid-stage.test.tsx`
- `packages/web/tests/tournament-duel-rules.test.ts`
- `packages/web/tests/components/duel-lobby-seats.test.tsx`

Removed obsolete fixture: `packages/duel-server/tests/support/host-rule-fingerprints.json`.

Retained integration/engine files:

- `packages/duel-server/tests/genesys-deck-legality.test.ts`
- `packages/duel-server/tests/genesys-engine-real.test.ts`
- `packages/duel-server/tests/host-genesys-admission.test.ts`
- `packages/duel-server/tests/host-table-legality.test.ts`
- `packages/shared/tests/db/schema.test.ts`
- `packages/shared/tests/services/genesys-contract.test.ts`
- `packages/shared/tests/services/genesys-points-check.test.ts`
- `packages/shared/tests/services/genesys-points.test.ts`
- `packages/web/tests/api/genesys-creation-routes.test.ts`
- `packages/web/tests/tournament-deck-route.test.ts`
- `packages/worker/tests/process.test.ts`
- `packages/shared/tests/services/duels-creation.test.ts`
- `packages/web/tests/duel-hidden-waiting.test.tsx`
- `packages/web/tests/duel-spectator-routes.test.ts`

Main's `packages/web/tests/duel-host-errors.test.ts` is also retained unchanged.

## Local verification

Node 22.23.3 verification after the main merge:

- `npm ci` and shared/worker/web production builds passed.
- `npx tsc --noEmit` passed for shared, web, duel-server, bot, ws, worker, and e2e.
- 180 targeted integration tests passed: 91 shared (including two real CLI
  subprocess checks), 50 duel-server SQLite/host-admission checks, 34 web
  route/SQLite checks, and five real worker process checks.
- The 32 `genesys-engine-real` worker cases were skipped because this worktree has
  no engine data or built cores. The retained `host-table-legality` file was not
  run because its real card database is absent. CI supplies the engine bundle.
- Only the real-database cases were selected from `duel-spectator-routes` and
  main's `duel-host-errors`. The pure comparison cases in the CLI test file were
  not run. No complete local package suite was run.
- Documentation contains no duplicated BabelCDB/CardScripts pin SHAs.

Read-only review found a saved-deck refresh race: a background focus request could
replace a pending initial request and hide its error. Background refresh now waits
for an initial list, preserving the initial request's success/error handling.

## Operational limits

Future unfamiliar points lists fail closed until their official effective date
and exact revision are verified; see [sync procedures](genesys-sync.md).
Earlier binaries do not support Genesys journals; see [engine notes](genesys-engine.md).
