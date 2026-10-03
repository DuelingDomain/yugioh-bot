# Engine hand order implementation plan

**Goal:** Render the engine hand sequence and land every hand entry in its current engine slot without a position jump.

**Architecture:** Project hand membership, order and coordinates directly from the core query. Retain opaque IDs solely for React keys, arrival glow and animation targets; hidden permutations must never become public through those IDs. Existing hand FLIP slides handle insertion, removal and re-sequencing.

**Constraints:** Work on `fix/hand-order-counter-fx`, new commits only, no push. Preserve opening presentation memory, grace, timing and consumed-history cursor. Do not modify services, ports, worktrees or card backs.

- [x] Replace stable-order assertions with engine-order assertions and observe them fail.
- [x] Remove `packages/duel-server/src/hand-order.ts`; index identity metadata by engine sequence in `hand-identities.ts`. Project `engineHand.map(...)`, with no identity-based sorting or filtering. Preserve reveal compaction and removed-card accounting.
- [x] Replace the server unit tests with identity, insertion, removal, shuffle privacy, missing-metadata and projected-view cases. Use the real normal and Domain engines for Reinforcement of the Army and compare views against raw hand queries through test instrumentation. Replay accepted answers and compare all viewers.
- [x] Replace `duel-hand-order.test.tsx` with engine-order DOM, mirrored hand, insertion/removal/resequence FLIP, flight destination, prompt index and glow assertions. Add a failing showcase case where its destination changes during flight.
- [x] Use resting engine-slot geometry for flights. Keep hidden arrivals out of neighbour FLIP; follow the current destination before releasing the real card and during landing fades and glows. Preserve reduced-motion fades and entry pace.
- [x] Update `/dev/fx-lab#move-hand-order` to show middle insertion, later engine re-sequencing, departure and mirrored anonymous insertion. Require every lab hand sequence to equal its array index.
- [x] Review the diff and run targeted regression tests.
- [x] Run the requested shared build, full web tests, shared tests, full duel-server tests with the supplied `DUEL_DATA_DIR`, and root typecheck. Re-run any isolated flakes; report exact results.
- [x] Commit only task files with `fix(web): ...` and the required co-author trailer. Report removals, preserved behavior, geometry, commit, lab URL, results and verification limits.

## Verification

- Shared build passed. Shared suite: 43 files, 461 tests passed.
- Final full web run: 206 files passed, 16 failed; 2,700 tests passed, 23 failed. All 16 failing DB/seed files passed individually (121 tests); nine needed a 30-second timeout under machine load. Final focused hand animation tests: 31 passed. Lab suite: 592 passed.
- Final full duel-server run with the supplied data directory and the package's standard 15-second timeout: 27 files, 355 tests passed. Focused engine events, hand projections, identities and real-engine search/replay tests: 48 passed.
- Root typecheck: 5 of 5 tasks passed. Read-only review and `git diff --check` passed.
- No live browser visual pass was performed. Game-two coverage uses a fresh real core with a changed deck, rather than the complete side-deck UI flow.
