# Multiplayer hands and Exodia implementation plan

Owner 2026-10-18. Use the rulebook decision in the task and ADR-0002.

1. Add live scenarios for Card Destruction, Hand Destruction and Exodia in FFA3, FFA4 and Tag. Run both Standard and Domain multi cores. Check each hand and each player prompt. Check all possible Exodia winner seats and split pieces.
2. Extend the two hand overlays to FFA. Check Exodia in each separate hand. Use `Duel.Win` for the complete table result. Keep the engine data read-only.
3. Preserve an Exodia result marker in the host and saved views. Use it to remove FFA places from the end screen. Prove the saved result and replay with a real host integration test. Multiplayer ranked play is disabled.
4. Remove only these three bans. Add rule entries, script evidence and live proof references. Update ADR-0002, the scenario spec and the overlay manifest. Bump the host rule version for the result change.
5. Run only the affected test files with one worker. Run TypeScript checks for shared and duel-server. Review the changes, commit in small parts, remove build output, and write the requested report. Do not push.

## Item 3 follow-up (owner 2026-10-18)

The owner clarified that simultaneous Exodia claims count teams in Tag and seats in FFA. Two complete hands on one Tag team win for that team; simultaneous claims from both teams draw.

- [x] Update the live scenarios first: retain `owner-exodia-draw-tag-0-2` with a team-win expectation, cover team 1 too, and retain opposing-team draws. Verify the regression fails before changing the overlay.
- [x] Count claims with the existing seat/team helper in `domain-core/multi-scripts/c33396948.lua`. Update the ADR, scenario spec, source rule entry and manifest through the generator. Exodia has no separate handwritten source copy in this checkout.
- [x] Rebuild Standard and Domain multiplayer cores in the supplied `mp-cores` folder. Run affected Vitest files with `--maxWorkers=1`, native golden checks if Exodia is in the fuzz pool, and TypeScript checks for shared, web and duel-server.
- [x] Review, commit with the requested trailers, remove build output and `.build`/`.emcache`, and preserve `mp-cores`. Do not push.

Validation: 1,114 targeted duel-server passes across 23 files (one existing triage skip and 35 TODOs); the catalog source citations passed on rerun after updating shifted Lua lines. All 108 hand/Exodia scenarios, 36 host/replay cases, 12 web cases and three TypeScript checks passed. Native golden check: 80 rows, no skips or mismatches; only the overlay fingerprint changed. Both rebuilt WASM cores match their preserved hashes. Generator check and independent review passed. Build output and caches were removed; `mp-cores` is preserved.

Use live scenarios and integration tests only. Do not add unit tests.
