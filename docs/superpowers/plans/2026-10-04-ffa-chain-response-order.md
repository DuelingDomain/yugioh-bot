# FFA Chain Response Order Implementation Plan

**Goal:** Apply the owner's 2026-10-04 rule to Standard and Domain FFA3/FFA4.

**Architecture:** Restart the FFA response cursor immediately after the last link's activating seat. Keep the open-window turn-player anchor, SEGOC, triggers, Tag branches and two-player processors unchanged. Existing per-seat pass records reset on a new link and skip eliminated seats.

**Tech stack:** ygopro-core C++ mail patches, TypeScript scenario DSL, Emscripten 4.0.9, Vitest.

- [x] Update `tests/scenarios/multiplayer/nseat-ffa.ts` and `rule-proof-ffa-chain.ts`; prove A activates, B passes, C chains, D/A/B/C pass, plus FFA3, pass reset, eliminated/leaving seats and Tag/1v1 controls.
- [x] Run regression tests against the installed old cores with `prlimit --core=1:1` and one Vitest worker; record the expected order failure.
- [x] Add isolated multi targets to `scripts/build-domain-core.ts` so the requested entry point can build both multi cores under the shared lock with at most two compiler jobs.
- [x] Prepare a new local core tree; change `response_sequence` and its header comment; generate `0090-ffa-chain-response-order.patch` using deterministic `git format-patch` metadata.
- [x] Reapply the complete patch series from clean pinned sources; build both cores into this worktree's `.build/chain-response-order` output through the shared lock.
- [x] Run targeted scenarios, including unchanged open-state/trigger and Tag/1v1 behavior; run TypeScript checks as appropriate.
- [x] Update ADR-0002, patch README, verified binary hashes and deployment source/hash records; regenerate rule coverage and run its strict check.
- [x] Commit verified work in small commits with the requested coauthor trailer; delete generated engine/core build output; report commits, hashes and any remaining problems. Do not push or open a PR.

Verification: 70 targeted tests passed with one Vitest worker (29 chain/FFA-trigger/Domain-surrender cases, 39 Tag-response/coverage checks, 2 original four-way-chain scenarios). TypeScript and `rule-coverage.ts --strict --check` passed; all 44 rules are covered. Both 85-patch cores applied from pinned sources, built through the shared lock and pinned emsdk 4.0.9 with two compiler jobs, passed WebAssembly validation and matched `expected-sha256.txt`. Generated core/resource trees and the local shared-package build were deleted after verification.

Separate UI follow-up: `packages/web/src/components/duel/priority-chips.tsx` still computes the superseded turn-player response order. This engine-core task does not change that component.
