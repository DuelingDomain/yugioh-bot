# Opening hand replay implementation plan

Goal: Present each game's opening once, protect decision time during the presentation, and make hand-entry animations about 10% faster.

Architecture: Remember presented openings by duel slug outside component instances. Give each new game bounded server-side opening grace; late snapshots skip a presentation that cannot finish inside the remaining grace. Preserve existing engine rules and reduced-motion rendering.

Constraints: Work only in `hand-deal-replay`; borrow dependencies with symlinks, build shared locally, never modify the live stack, push, or open a PR. The user authorized implementation, validation, and local commits.

- [x] Reproduce revision-zero replay after connection recovery and room remount in `packages/web/tests/components/use-start-beats.test.tsx`.
- [x] Latch the opening by game slug in `packages/web/src/components/duel/use-start-beats.ts`; check a game-1 to game-2 transition with restarted event IDs and a real `MoveFx` remount.
- [x] Validate the replay fix with Vitest and web typecheck; commit it separately.
- [x] Add failing server clock tests for opening grace, preserved grace across prompt changes, and unchanged reconnect deadlines. Add web tests for late snapshots and presentation duration.
- [x] Apply bounded opening grace at game creation, gate late presentations against the available grace, and verify the clock/display arithmetic. Commit the timer fix separately.
- [x] Add failing hand-entry timing tests; scale draw and add-to-hand durations/staggers by 0.9 while preserving reduced-motion behavior. Commit the pace change separately.
- [x] Run touched web tests with `packages/web/vitest.config.ts`, web typecheck, relevant server tests, and review the final diff.
- [x] Remove generated shared build output, TypeScript caches, `.next` and `test-results` created by this task. Report causes, commits, checks, and limitations.

There is no `packages/e2e` or Playwright harness in this checkout; regression coverage uses the existing hook/component and server-host test harnesses.

Final verification: 147 web tests in 10 suites and 92 server tests in four suites passed. Web and duel-server typechecks passed. The server tests read the borrowed engine resource snapshot without starting any listening server. Dependency links were removed after verification.

Review also caught and fixed an opening grace lost on a fast bot turn change, the window-choice screen consuming an opening before layers mounted, and a late opening arriving after an empty snapshot. Card and banner layers now share a consumed-history cursor without cancelling the first presentation; real-layer Strict Mode tests cover that order, and a draw-only batch publishes the cursor even before phase events arrive.
