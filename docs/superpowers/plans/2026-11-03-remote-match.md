# Remote match implementation plan

Goal: implement the backend contract in `docs/remote-duels/match-flow.md` on the isolated `feat/remote-match` branch.

Architecture: put match schemas/types in `packages/shared/src/remote/match-contract.ts` and transitions in `match.ts`. Integrate them with the YGO reducer and existing remote service transactions, event replay, private projection and room sweep. Reuse `DuelBestOf` and `DuelDeck`.

- [x] Extend only the existing shared reducer test in `packages/shared/tests/remote/remote-duels.integration.test.ts`; run that test alone and observe the missing-match failure.
- [x] Add match schemas and reducer transitions: scoring, declarations, siding deadlines, deck validation, next-game reset and first choice. Clear undo at the game boundary.
- [x] Persist room bestOf, replay actions, protect private swap events, keep tables active between games and advance deadlines in the existing broadcast sweep. Accept bestOf in create/configuration routes.
- [x] Run the one targeted test, shared build/typecheck and web typecheck with Node 22. Review the diff and contract. Delivery uses a WIP commit on `feat/remote-match`.

User constraints: no main-checkout changes, no UI, no stash, no attribution lines, no new test files and no broad test runs.

## Backend review fixes (round 1)

- [x] Extend only the existing `validates the action bus...` reducer test with timeout no-ops, declaration undo, eliminated-seat confirmation, the 20-second choice deadline, solo defaults/readiness and mixed deadlines. Run this test before implementation.
- [x] In `remote/match-contract.ts` and `remote/match.ts`, expose seat and choice deadlines, preserve undo through declarations, require living-seat confirmations, and default the first player after 20 seconds with everyone ready. Keep timeout checks deterministic and harmless when nothing is due.
- [x] In `services/remote-duels.ts`, bypass sequence races for timeout checks, default solo rooms to BO1, ready owned bots with their solo host, persist replay context, and select match metadata for lists and sweeps. Expose `setBestOf` from the existing room controller for lobby settings.
- [x] Update `docs/remote-duels/match-flow.md`, run the targeted reducer test and shared/web typechecks with Node 22, review the diff, then WIP commit and push `feat/remote-match`.

Validation: the extended reducer test and the two existing solo undo/idle tests pass (3 targeted tests). Shared and web typechecks and the shared build pass under Node 22. Review found a historical replay issue; versioned match event context fixes it, and follow-up review found no remaining important issues.
