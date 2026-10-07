# FFA dice opening implementation plan

The owner approved public seat moves in roll order. Work stays in the existing worktree and branch.

1. Add a shared dice state and view beside the existing RPS types. Record each round by lobby seat. Split tied groups within their rank. Reveal each round for 3 seconds. Test ties, three equal rolls, two tied pairs, final order, public views, stored state, and deadlines before implementation.
2. Extend the duel service opening to FFA3 and FFA4. Move complete seat rows in one transaction at the final deadline. Keep deck links and bots on their rows; remap stored clocks and structured setup fields. Test rollback, repeated settlement, access, bots, decks, tokens, recovery inputs, and results.
3. Drive FFA dice openings from the host regardless of the RPS switch. Keep Tag and 1v1 behavior. Test FFA3 and FFA4, deadlines, delayed reads, ties, bots, and start failure. Add real worker start/recovery/replay tests for CI if the cores are absent here.
4. Add plain dice text to the opening screen. Check that the current seat-dependent websocket effect requests fresh credentials after the move. Run targeted client and route tests; do not build the UI.
5. Update the investigation with the chosen approach and remove its standalone mapping proof. Run affected type checks and focused tests with Node 22 and prlimit --core=0. Commit each step with the requested trailers, push the branch, then delete this worktree's dependencies, caches, and generated build files.

Implementation and targeted validation are complete. The investigation records the seat audit and test results. The six low review findings have follow-up fixes and regression tests, including a CI-ready browser seat-move test. The coordinator confirmed that real-core tests pass with the main repository's cores selected through `DUEL_DATA_DIR`; the full dice screen remains a separate UI task.
