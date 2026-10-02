leftover-fix2 is complete. Six separate commits fix the six review items. Each commit has the exact two required trailers. The branch is feat/multiplayer-nseat-duels. No history was changed. No other task's source file was committed.

| Fix | Commit | Title |
| --- | --- | --- |
| Owner-return rule | `9e48236` | fix(multiplayer): make the owner return rule parseable |
| Controller-turn routes | `9084a7d` | docs(multiplayer): keep both controller turn routes open |
| Owner/C6 patch order | `28dc44a` | fix(multiplayer): apply leftover patches after owner and C6 exports |
| TA.I. Domain guard | `2d62f3d` | test(multiplayer): require the Domain core for TA.I. proofs |
| Heritage constant | `4cb8b0b` | test(multiplayer): name the Dark Hole constant HOLE |
| Missing brief | `972108b` | docs(multiplayer): restore the leftover fix task list |

The return-to-owner patch now uses backticks for both rule IDs and has no blank line before the rule. Its words match owner-seat-fix-answer.md. The parser check fails before the fix and passes after it. Strict coverage recognizes the rule as covered.

The original fix kept both controller-turn routes open in leftover/integration/README.md and repo-apply-order.json. Route A required owner confirmation and included the controller rule, the Law patch with controller context, and the Nova/Snake patches. Route B used law-normal.adr.patch and skipped all controller-turn patches, including the manifest note patch. The proposal named the Messenger of Peace decision as its source. No route was selected at that time.

Owner decision, 2026-10-02: `R-COMMON-CONTROLLER-TURN` is confirmed. "Your" turn is the card's current controller's turn; in Tag, only that duelist's own turn counts. Route A is chosen in leftover/integration/README.md. Route B remains a documented fallback. See the final section of briefs/DECISIONS-2026-10-01.md.

| Fresh proof | Result |
| --- | --- |
| Route A | 23 Standard + 23 Domain pass |
| Route B | 17 Standard + 17 Domain pass |
| TA.I. | 12 pass in each installed-core run |
| Heritage | 25 pass in each installed-core run |
| Missing Domain core | Required failure; six Standard cases pass |
| Source application | A/production 47, A/owner 50, B/production 44, B/owner 47; no conflicts |
| Current core export chain | 12 patches apply in order; no conflicts |

All Vitest commands used --maxWorkers=1. Route tests used private P68 plus the existing turn/living helper exports and included 1v1 Law controls. They do not prove the combined C1-C7 engine.

Export paths below are relative to phase2/leftover. Use the four integration/repo-order-*.json files. seat-queries.native-registration.patch now follows C6 and keeps both native rows. hints-fork/fork-controller.patch says to skip it when phase1/gap-overlay/out2 is applied. The owner route uses hints-fork/fork-owner-route.patch instead.

The current owner/action and C6 exports also had utility and entry-count context conflicts. integration/c6-after-owner.scenarios.patch supplies the C6 variant for that route. It keeps both changes and sets 192 entries. Original owner/C6 export files were not edited.

C6 scenario SHA-256 used: `91a630589a80ba1dc9812b4e9a15cdcf66fae857d4989703784fe5ebc1e4c51e`. C6 fix4 was active. The integrator must regenerate the native registration patch if C6 changes checks.tsv again. Regenerate the owner-context C6 variant if its shared context changes. fix2/c6-input.json and fix2/integration-apply.json record the inputs and checks. verify-repo-exports.py repeats each selected sequence on a copy and rejects changed inputs.

The restored briefs/wave2/leftover-fix.md states that leftover/plan.md replaces the missing original brief and gives the task list.

Full strict coverage still fails on other tasks' unknown markers, pending entries, weak cases and unrun lists. Package TypeScript still reports only extra-monster-zones.ts:73, owned by triage. These source files were not changed. Whitespace and commit ownership checks pass. Native, differential gate and nduel checks were not rerun for this export-only revision; the integrator must run them on the final combined cores.

No core was installed and no live stack was started. Installed Standard, Domain and Domain 1v1 hashes match the prior report. The read-only review found no high or medium issue. It repeated all four source checks and checked the C6 merge and rule words. Private builds and scratch copies were removed. Proof logs, patches and hash records remain under leftover/fix2.
