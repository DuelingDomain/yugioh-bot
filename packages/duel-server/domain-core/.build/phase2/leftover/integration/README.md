All paths below are relative to phase2/leftover. These are exact proposals. No protected source file was edited.

Use repo-apply-order.json to select controller-turn route A or B after the owner decision. Route A has 46 repository patches. Route B has 43. The decision is still pending. repo-apply-check.json records a successful sequential check in a private copy of the current shared tree. It is not a claim that all C1-C7 proofs pass on installed P68. Integrate the accepted owners' current source changes before applying patches that use their context. The current shared branch includes the owner's final first-draw commit d4338a216a6c7eccadfa83d265c3ce4c7cfc890d.

`R-COMMON-CONTROLLER-TURN` is a proposal. Its source is the Messenger of Peace decision in ADR 0002, under "The other cards use the defaults": only the holder's own duelist Standby Phase pays maintenance, with team LP in Tag. That card-specific decision does not confirm the proposed general rule. Owner confirmation is required before this rule enters ADR 0002. No route is selected here.

Route A (owner confirms): apply `turn-resource/controller-turn-rule.patch`, then `integration/law-normal-after-controller.adr.patch`. Apply `mp-turn-seat.patch` to the private core before tests. Apply `controller-turn.overlays.patch` and `controller-turn.scenarios.patch` for Nova and Snake. Include `controller-turn.manifest.patch` in the generator note changes. The six Standard and six Domain stolen-controller cases must pass. The Law cases must also pass.

Route B (held): apply `law-normal.adr.patch` only for this ADR change. Skip `turn-resource/controller-turn-rule.patch`, `controller-turn.overlays.patch`, `controller-turn.scenarios.patch` and `controller-turn.manifest.patch`. Keep the existing Nova and Snake suffixes. The Law cases must pass. Both Law patches contain the same owner-approved hand rule. Never apply both.

Both route prefixes apply in sequence on separate copies. Fresh real-engine runs pass: route A has 46 cases (23 Standard and 23 Domain, including 1v1 Law controls); route B has 34 (17 per core, including 1v1 controls). See `fix2/route-A-apply.json`, `fix2/route-B-apply.json` and `fix2/route-test-results.json`. These runs use private P68 + turn/living helper cores. They do not claim a combined C1-C7 proof. Run from the selected copy's `packages/duel-server`, with private data and cores:

```bash
DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 npx vitest run tests/scenarios/multiplayer/law-normal-empty-hands.test.ts --maxWorkers=1
# Also run this file for route A only:
DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 npx vitest run tests/scenarios/multiplayer/controller-turn-review.test.ts --maxWorkers=1
```

Set `DUEL_DATA_DIR`, `NSEAT_WASM` and `DOMAIN_MULTI_WASM` to the private test data and the two helper cores before these commands.

Use integration/c1-10-host-gates-current.patch instead of either earlier C1.10 patch. It preserves the owner's current hand-count line. The gates and plain rule metadata are the same changes that passed the 22 host cases and the 11 Standard-only cases.

integration/first-draw-owner-current.patch is an archive of the owner's source changes before commit d4338a2. Do not apply it after that commit. Its inventory records the snapshot base and source hashes. The final first-draw rule is now already fixed by d4338a2.

Use integration/manifest-apply-order.json for the eight metadata proposals. All eight apply in sequence and change notes only for the 17 listed card records. Evil Star Twins has one separate serialization change. integration/manifest-note-check.json records every resulting code, name and note. integration/manifest-final-expected.patch is the combined expected generated output. Do not apply the combined reference with the individual proposals. The integrator must use the generator API and run scripts/generate-multi-scripts.ts, with each card note in that fix's own commit.

integration/manifest-other-four-notes.patch replaces the old five-note proposal for Gnomes, Alba-Los, Card Destruction and Hand Destruction. Underworld Circle's final note comes from turn-resource/manifest-notes.patch. Clear World's final note also comes from that patch and includes maintenance and one global hint. Do not apply hints-fork/clear-world-hint-manifest-note.patch with that final note.

Use the finding-specific hint and Fork proof patches. Do not apply hints-fork/review-proofs.patch with them. Use turn-resource/clear-world-hints.patch after its maintenance patch; the equivalent hints-fork suffix is an alternative. Use one Fork source route: the corrected owner-seat export is preferred when integrating that owner's source; the production delta is for the existing installed suffix. Do not let the old owner-seat suffix replace the corrected chooser.

The hint-call fix needs hints-fork/core-hint-call-boundaries.patch, engine-hint-logs.patch, native-hint-call-proof.patch and hint-log-call-review-proofs.patch together. The native patch replaces the existing hint collector so that it checks the metadata boundary separately from real recipients. No duplicate native registration is needed for that replacement.

The core order is P68, C1, C2, C3, C4, C5, C7, owner-seat, action-seat, C6, mp-turn-seat.patch, mp-living-seats.patch, then the hint-call boundary patch. full-chain-apply.json and hints-fork/full-chain-apply.log record the forward checks. dependencies/inventory.json has the current owner source paths and hashes. Only the C3/C4 scenario exports changed at final review; their copies were refreshed. No core predecessor changed.

Keep one fix and its proofs in each commit. Use the required trailers:

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UrYy4jjEcbJHKdcVYasfdb

After final integration, build both cores and rerun the affected real-engine proofs, native checks, six fixed and 20 random differential seeds, golden replay checks, TypeScript and strict coverage. The task's private helper and hint builds passed their own checks. They were not installed and do not replace that final combined run.
