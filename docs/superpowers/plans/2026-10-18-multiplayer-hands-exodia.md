# Multiplayer hands and Exodia implementation plan

Owner 2026-10-18. Use the rulebook decision in the task and ADR-0002.

1. Add live scenarios for Card Destruction, Hand Destruction and Exodia in FFA3, FFA4 and Tag. Run both Standard and Domain multi cores. Check each hand and each player prompt. Check all possible Exodia winner seats and split pieces.
2. Extend the two hand overlays to FFA. Check Exodia in each separate hand. Use `Duel.Win` for the complete table result. Keep the engine data read-only.
3. Preserve an Exodia result marker in the host and saved views. Use it to remove FFA places from the end screen. Prove the saved result and replay with a real host integration test. Multiplayer ranked play is disabled.
4. Remove only these three bans. Add rule entries, script evidence and live proof references. Update ADR-0002, the scenario spec and the overlay manifest. Bump the host rule version for the result change.
5. Run only the affected test files with one worker. Run TypeScript checks for shared and duel-server. Review the changes, commit in small parts, remove build output, and write the requested report. Do not push.

Use live scenarios and integration tests only. Do not add unit tests.
