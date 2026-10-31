# Bridge API cleanup

## Implemented

- Removed `deckId` from browser types and both web/host validators. The host no longer loads a saved deck or runs a separate most-Main-cards archetype detector.
- Removed `readBridgeQuery`. JSON POST is the canonical stored-list transport, including calls without an open deck.
- Removed the separate `source + target` deep-search save/judge loop and ten-pending-pair bound. Such requests return 400 on both boundaries; pairs use the existing `engines` set form. Source-only compatibility callers use the same `searchBridgeEngines` scan/shortlist/review path as engine sets, retaining their existing directed status projection.
- Consolidated the complete browser API surface into `packages/web/src/lib/bridges-api.ts`, with `BridgeRequestError` for list, engines, deep start/status, feedback and archetype-name errors. Loading retries, cancellation, join-only context refresh and retry hints are preserved.
- Updated integration coverage and `docs/api/archetype-bridges.md`. Kept CLI/scanner `explain` methods because the administrative/evaluation scripts still use them; the player API no longer dispatches that operation.

## Pending the narrow component-file exception

The owner's instruction says **“Do NOT touch packages/web/src/components.”** The second client module is inside that directory: `packages/web/src/components/bridges/bridges-api.ts`. Existing components import it, and it sends GET when no deck is open. Replacing it with the required re-export shim therefore needs an exception to that explicit restriction. The owner was asked; no answer had arrived at this checkpoint.

That file remains untouched. A temporary GET transport adapter delegates to the same POST validator, so existing components remain functional. This means **GET removal and the final removal of duplicate client implementation are not complete**. The exact follow-up is prepared, without applying it, at `/tmp/claude-1000/bridge-client-shim.patch`: replace only the component-local API module with `export * from "@/lib/bridges-api"`, remove the GET adapter, and update the corresponding route assertion. It passes `git apply --check` against this worktree.

No `deck-suggestion*` files or component files were changed by this work.

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
  ArchetypeBridge, RankedEngine, BridgeDeck, BridgePackage, CoreCard, EngineCore,
  DetectedEngine, EngineSuggestion, BridgeEnginesRequest, BridgeEnginesResponse,
  BridgeFormat, BridgeReviewStep, BridgeAlternativePath, ShownBridge,
  BridgeListRequest, BridgeListResponse, BridgeLoadingResponse, BridgeDeepSearchRequest,
  BridgeScope, BridgeList, DeepState, DeepStep, DeepStatus, DeepStart,
} from "@/lib/bridges-api";
```

Compatibility names retained for current component imports: `BridgeScope`, `BridgeList`, `DeepState`, `DeepStep`, `DeepStatus`, `DeepStart`, `BridgeRequestError`, `fetchBridges`, `startDeepSearch`, `pollDeepSearch`, `reportBridge`, `fetchBridgeArchetypes`, and the shared type re-exports. `BridgeScope.target` is list context; the canonical deep helper translates it to an engine set and never sends a pair deep selector. No runtime symbol was removed from the old module.

## Verification

| Check | Result |
| --- | --- |
| Stored strict runner, batch judge, artifact publication, official-name API, host API and engine lifecycle (six suites, source imports) | 43 passed |
| Web signed-host routes and canonical browser helpers | 34 passed |
| Cache integration (sequential retry with 20-second default timeout) | 5 passed |
| Niche and durable search-job integration | 28 passed |
| Full worker integration, final complete run | 6 passed, 1 timed out at its explicit 20-second limit |
| Isolated deep-lane worker case after an earlier scanner-stop failure | Passed in 27.48 seconds |
| Isolated full-projection worker case after the full-suite timeout | Passed in 17.58 seconds (test body 16.20 seconds) |
| Shared build, shared/server/web TypeScript, `git diff --check`, prepared-patch applicability | Passed |

An initial concurrent scanner run also hit the default five-second cache-test timeout. The passing isolated retries do not erase the full worker suite's timing failure. No paid tests ran, and no new unit tests were added. The host DB was compared against its backup across all 90 tables: no changed tables, `quick_check: ok`.
