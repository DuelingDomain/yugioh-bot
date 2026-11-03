# Remote match implementation plan

Goal: implement the backend contract in `docs/remote-duels/match-flow.md` on the isolated `feat/remote-match` branch.

Architecture: put match schemas/types in `packages/shared/src/remote/match-contract.ts` and transitions in `match.ts`. Integrate them with the YGO reducer and existing remote service transactions, event replay, private projection and room sweep. Reuse `DuelBestOf` and `DuelDeck`.

- [x] Extend only the existing shared reducer test in `packages/shared/tests/remote/remote-duels.integration.test.ts`; run that test alone and observe the missing-match failure.
- [x] Add match schemas and reducer transitions: scoring, declarations, siding deadlines, deck validation, next-game reset and first choice. Clear undo at the game boundary.
- [x] Persist room bestOf, replay actions, protect private swap events, keep tables active between games and advance deadlines in the existing broadcast sweep. Accept bestOf in create/configuration routes.
- [x] Run the one targeted test, shared build/typecheck and web typecheck with Node 22. Review the diff and contract. Delivery uses a WIP commit on `feat/remote-match`.

User constraints: no main-checkout changes, no UI, no stash, no attribution lines, no new test files and no broad test runs.
