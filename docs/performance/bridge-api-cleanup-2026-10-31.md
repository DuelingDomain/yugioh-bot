# Bridge API cleanup

## Implemented

- Removed `deckId` from browser types and both web/host validators. The host no longer loads a saved deck or runs a separate most-Main-cards archetype detector.
- Removed `readBridgeQuery`. JSON POST is the canonical stored-list transport, including calls without an open deck.
- Removed the separate `source + target` deep-search save/judge loop and ten-pending-pair bound. Such requests return 400 on both boundaries; pairs use the existing `engines` set form. Source-only compatibility callers use the same `searchBridgeEngines` scan/shortlist/review path as engine sets, retaining their existing directed status projection.
- Consolidated the complete browser API surface into `packages/web/src/lib/bridges-api.ts`, with `BridgeRequestError` for list, engines, deep start/status, feedback and archetype-name errors. Loading retries, cancellation, join-only context refresh and retry hints are preserved.
- Updated integration coverage and `docs/api/archetype-bridges.md`. Kept CLI/scanner `explain` methods because the administrative/evaluation scripts still use them; the player API no longer dispatches that operation.

## Final POST-only cleanup

The UI owner's import migration landed in `91475597346e7ab7f507de2ad023d5eee5f4ca62`: bridge components import `@/lib/bridges-api` and no longer import the component-folder client. This satisfied the owner's Step B gate before any component-folder removal.

Removed the temporary GET transport adapter and the obsolete `packages/web/src/components/bridges/bridges-api.ts` implementation. `GET /api/cards/bridges` now receives Next.js's 405; JSON POST is the only list transport, with or without an open deck. The canonical client no longer exports the unused `BridgeList` alias or unused shared compatibility re-exports (`ArchetypeBridge`, `RankedEngine`, `BridgePackage`, `BridgeReviewStep`). Deep helper request/response types and names still used by components remain.

Both existing validators remain aligned: POST list bodies reject query parameters, unknown fields and `deckId`; deep `source + target` requests are rejected at both boundaries and pairs use `engines`. The integration route assertion now rejects any GET export. The component client deletion is the only component-folder change in this final cleanup. No `deck-suggestion*` files were edited.

## Canonical imports for the UI owner

All runtime exports:

```ts
import {
  BridgeRequestError, fetchBridges, fetchBridgeEngines, isBridgeLoadingResponse,
  startDeepSearch, pollDeepSearch, reportBridge, fetchBridgeArchetypes,
} from "@/lib/bridges-api";
```

All type exports:

```ts
import type {
  BridgeDeck, CoreCard, EngineCore,
  DetectedEngine, EngineSuggestion, BridgeEnginesRequest, BridgeEnginesResponse,
  BridgeFormat, BridgeAlternativePath, ShownBridge,
  BridgeListRequest, BridgeListResponse, BridgeLoadingResponse, BridgeDeepSearchRequest,
  BridgeScope, DeepState, DeepStep, DeepStatus, DeepStart,
} from "@/lib/bridges-api";
```

`BridgeScope` and `DeepStep` remain in use by components. `DeepState`, `DeepStatus` and `DeepStart` describe the canonical deep helpers' responses. `BridgeScope.target` is translated to an engine set by the deep helper and is never sent as a pair deep selector.

## Verification

Final cleanup uses integration coverage only. The POST-only assertion first failed because GET was still exported, then passed after removal. An initial test collection attempt could not resolve the missing compiled shared package; building the shared prerequisite resolved that setup issue. Generated shared build output is removed after verification.

| Check | Result |
| --- | --- |
| Web signed-host routes and canonical browser helpers | 34 passed |
| Stored strict runner, batch judge, artifact publication and host API (four suites) | 22 passed |
| Shared prerequisite build | Passed |
| Whitespace and old-client import removal | Passed |

The earlier broader cleanup had a full worker-suite timeout, with passing isolated retries; that worker suite was not rerun for this narrow final change. The owner-approved paid strict pass completed for $1.950417. Live integrity and foreign-key checks passed; concurrent application updates prevented an all-unrelated-tables-unchanged assertion. A disposable replay confirmed that the 840 judgement writes affect only `bridge_judgement` and its revision trigger. Full counts, scope and the concurrent-table caveat are recorded in `bridge-strict-review-2026-10-31.md`.

Commands (Node v22.23.3):

```sh
node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.build.json
node node_modules/vitest/vitest.mjs run \
  scripts/effects/tests/stored-strict-judging.integration.test.ts \
  scripts/effects/tests/bridge-batch.integration.test.ts \
  scripts/effects/tests/bridge-artifacts.integration.test.ts \
  packages/duel-server/tests/bridge-api.integration.test.ts \
  --maxWorkers=1 --testTimeout=120000
# From packages/web:
node ../../node_modules/vitest/vitest.mjs run \
  tests/card-bridges-route.integration.test.ts --maxWorkers=1
```
