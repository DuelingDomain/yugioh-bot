# Surrender at the end of the turn

Task date: 2026-10-02.
Worktree: `/home/sulman633/repos/yugioh-bot/.worktrees/surrender-eot`.
Branch: `feat/surrender-end-of-turn`.
Base commit: `fdb3317f`. Keep this commit unchanged.

## Original task text

The owner rule in `DECISIONS-2026-10-01.md` states:

> In multiplayer, a surrender with no open chain takes effect at the END OF THE TURN; then the duelist leaves and may stay as a spectator.

Apply this rule to Standard and Domain FFA3, FFA4 and Tag.
Keep the duelist and their cards in the duel until all End Phase actions finish.
Stop their clock. Prevent their answers. Use pass answers when possible.
Use the existing automatic choice for a required answer.
If the turn player surrenders, use these answers to finish the turn.
Keep the existing open-chain rule and the immediate 1v1 surrender.
Keep time-limit loss timing.
Save the queue command at its accepted revision. Restore it at that point during recovery and replay.
Update the ADR and rule coverage. Use real engine tests and check every seat.

## Required corrections

Read `wave2/codex-rules.md`, `wave2/reports/review-surrender-eot.md`, and the section
"Owner answers 2026-10-02 (evening, engine session)" in `DECISIONS-2026-10-01.md`.
The owner answers replace any different rule in the first report.

1. In Tag, if both teams queue in one turn, the team that queued first loses.
   In FFA, apply queued losses in queue order. The last living duelist wins.
   If all living duelists queue in one turn, the last to queue wins.
   Each queued loss has its own place in `eliminationOrder`.
   Remove the queued-surrender draw text from `R-COMMON-SURRENDER-EOT`.
   Test FFA3, FFA4 and both Tag queue orders on both cores.
   Keep late queues behind earlier queues.
2. A Tag surrender with an open chain ends the duel at once. Restore and test this rule.
3. After a loss lands while the duel continues, give the leaver the spectator role automatically.
   Keep earlier spectators on the result screen.
   A loss that ends the duel keeps the player role, seat and deck.
   A draw does not mark its remaining seats as eliminated or make them spectators.
   Test completed results, draws, stale views, interrupted queues and replay.
4. Show the queue in each seat view and the public view.
   Use `pendingElimination`. Set it to true from queue acceptance until the loss lands.
   Clear it when the loss lands or the duel ends. Test this on the real engine.
5. Use `Surrender` as the result reason in all formats, including saved results and replay.
6. Keep HTTP 409 when an old core cannot queue a loss.
   Document this choice in the ADR. The old automatic-answer fallback cannot enforce the turn-end rule.
   Keep the immediate host cases and the existing time-limit fallback.
7. Add a real-engine test in which seat 0 loses to a card before queued seat 2 leaves.
   The global queue effect is registered to seat 0. Check that the loss still lands at turn end.
   Check every seat, recovery and replay.
8. Save this brief at the requested path. Keep a tracked copy on the task branch.

## Work and checks

Make one new commit for each correction. Include its code, tests and required documentation.
Do not amend, rebase, push or merge. Stage explicit paths only.
Do not read `.env`. Kill a process only by PID. Use `prlimit --core=1:1` for heavy commands.

Build shared first from `packages/shared`:

```bash
prlimit --core=1:1 npm run build
```

Run TypeScript and regenerate rule coverage from the worktree root:

```bash
prlimit --core=1:1 npx tsc --noEmit -p packages/duel-server
prlimit --core=1:1 npx tsx packages/duel-server/scripts/rule-coverage.ts --strict
prlimit --core=1:1 npx tsx packages/duel-server/scripts/rule-coverage.ts --strict --check
```

Run these tests from `packages/duel-server`, with one worker:

```bash
prlimit --core=1:1 env \
  DUEL_DATA_DIR=/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/duel-engine-next \
  DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 \
  MULTI_WASM=/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/duel-engine-next/ocgcore.multi.wasm \
  NSEAT_WASM=/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/duel-engine-next/ocgcore.multi-domain.wasm \
  npx vitest run tests/host-surrender-eot.test.ts tests/host-eliminate.test.ts \
  tests/host-ffa4-real.test.ts tests/host-nseat.test.ts tests/host-multiplayer-stack.test.ts \
  tests/host-clock-pending.test.ts tests/rule-coverage.test.ts --maxWorkers=1
```

The installed `ocgcore.multi.wasm` works with the synchronous wrapper used by the two custom workers.
The override avoids a missing local build at `packages/duel-server/domain-core/dist/ocgcore.multi.sync.wasm`.
If a required core is still missing, report its exact path. Do not count skipped tests as proofs.

End each commit message with these lines:

```text
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UrYy4jjEcbJHKdcVYasfdb
```

Write the final report to `wave2/reports/surrender-eot-fix1.md` in the domain-multiplayer worktree.
Name the view field in the report. State the commits, test results, limits and any required UI change.
Wait for long jobs in the foreground. The final message is the report.

## Corrections from the final source review

- Keep an interrupted room available if replay returns HTTP 409 or 503 and no final board exists.
  Keep the player role when the loss cannot be checked. An explicit replay request still returns its error.
- Keep an earlier old-core time-limit loser as a spectator on the result screen and in replay.
  The saved automatic answer shows that play continued after that fallback loss.
- Clear `pendingElimination` in the final replay frame when an interrupted duel has no final board.
- Use a new test worker for replay after the duel worker closes.

Each correction has a separate new commit. Do not change the earlier commits.
