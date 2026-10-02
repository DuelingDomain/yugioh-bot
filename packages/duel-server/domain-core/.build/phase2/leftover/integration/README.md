All paths below are relative to phase2/leftover. These are exact proposals. No protected source file was edited.

Use repo-apply-order.json to select controller-turn route A or B after the owner decision, and the applicable Fork route. There is no default route. Route A has 46 leftover repository patches. Route B has 43. The decision is still pending. The four integration/repo-order-*.json files record the exact leftover sequences. fix2/integration-apply.json records fresh sequential checks with the owner/action and C6 predecessors. The older repo-apply-check.json is historical. It is not a claim that all C1-C7 proofs pass on installed P68. Integrate the accepted owners' current source changes before applying patches that use their context. The current shared branch includes the owner's final first-draw commit d4338a216a6c7eccadfa83d265c3ce4c7cfc890d.

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

Use the manifestPatches list of the selected route in repo-apply-order.json. Route A uses all eight metadata proposals; route B skips controller-turn.manifest.patch and uses seven. integration/manifest-apply-order.json is the complete proposal list. All eight apply in sequence and change notes only for the 17 listed card records. Evil Star Twins has one separate serialization change. integration/manifest-note-check.json records every resulting code, name and note. integration/manifest-final-expected.patch is the combined expected generated output. Do not apply the combined reference with the individual proposals. The integrator must use the generator API and run scripts/generate-multi-scripts.ts, with each card note in that fix's own commit.

integration/manifest-other-four-notes.patch replaces the old five-note proposal for Gnomes, Alba-Los, Card Destruction and Hand Destruction. Underworld Circle's final note comes from turn-resource/manifest-notes.patch. Clear World's final note also comes from that patch and includes maintenance and one global hint. Do not apply hints-fork/clear-world-hint-manifest-note.patch with that final note.

Use the finding-specific hint and Fork proof patches. Do not apply hints-fork/review-proofs.patch with them. Use turn-resource/clear-world-hints.patch after its maintenance patch; the equivalent hints-fork suffix is an alternative. Use the Fork route that matches the source already applied:

- Production suffix: use `integration/repo-order-A-production.json` or `repo-order-B-production.json`. Apply the current C6 old-to-new scenario export first. Use `hints-fork/fork-controller.patch`.
- Owner-seat suffix: use `integration/repo-order-A-owner-seat.json` or `repo-order-B-owner-seat.json`. Apply `phase1/gap-overlay/out2/mp-owner-seat.scenarios.patch`, then `mp-action-seat.pre-tag.scenarios.patch`, then `mp-action-seat.tag-shared-cards.patch`. Use `integration/c6-after-owner.scenarios.patch` for the C6 scenario export on this route. **hints-fork/fork-controller.patch: skip when the owner-seat export (phase1/gap-overlay/out2) is applied.** Use `hints-fork/fork-owner-route.patch` instead. It is the existing corrected owner suffix delta, with repository paths. The target controller still chooses.

The current owner/action and C6 scenario exports both append to mp-utility.lua and update EXPECTED_COUNTS. The owner-route C6 variant changes those two contexts only: it keeps the action-seat API comment, appends the exact C6 geometry helper, and sets 192 entries (171 base + 1 owner + 20 C6). All other C6 file changes are copied from the current export. `fix2/c6-owner-merge.json` records this merge. Do not apply both C6 scenario variants. Original owner/C6 export files were not edited.

C6 scenario SHA-256 used: `91a630589a80ba1dc9812b4e9a15cdcf66fae857d4989703784fe5ebc1e4c51e`. Source: `phase1/df-c6/out/ffa4-shared-zones-scenarios-old-to-new.patch`. C6 fix4 was active when it was read. `seat-queries.native-registration.patch` was regenerated after this C6 export. It keeps both native rows. **The integrator must regenerate this registration patch if C6 changes checks.tsv again.** Regenerate the C6 owner-context variant if C6 or owner/action changes its shared context. Hashes are in `fix2/c6-input.json`.

Fresh sequential source checks pass: A/production 47 patches, A/owner-seat 50, B/production 44, B/owner-seat 47, including each route's predecessors. A separate fresh core check passes all 12 current core exports in order through the hint-call fix; see `fix2/core-chain-apply.json`. These checks prove application, not combined engine behavior. Run `python3 verify-repo-exports.py --controller A --fork owner-seat` with the chosen route to repeat the source check.

The hint-call fix needs hints-fork/core-hint-call-boundaries.patch, engine-hint-logs.patch, native-hint-call-proof.patch and hint-log-call-review-proofs.patch together. The native patch replaces the existing hint collector so that it checks the metadata boundary separately from real recipients. No duplicate native registration is needed for that replacement.

The core order is P68, C1, C2, C3, C4, C5, C7, owner-seat, action-seat, C6, mp-turn-seat.patch, mp-living-seats.patch, then the hint-call boundary patch. full-chain-apply.json and hints-fork/full-chain-apply.log record the forward checks. dependencies/inventory.json has the current owner source paths and hashes. That inventory is the earlier task snapshot. fix2/core-chain-apply.json records the current core source hashes, and fix2/c6-input.json records the current C6 scenario source hash. C3/C4 and C6 can still change; repeat the checks with the final exports.

Keep one fix and its proofs in each commit. Use the required trailers:

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UrYy4jjEcbJHKdcVYasfdb

After final integration, build both cores and rerun the affected real-engine proofs, native checks, six fixed and 20 random differential seeds, golden replay checks, TypeScript and strict coverage. The task's private helper and hint builds passed their own checks. They were not installed and do not replace that final combined run.
