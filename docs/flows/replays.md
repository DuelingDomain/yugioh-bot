# Replays and Jump in

After a duel ends, anyone who can see the duel can watch its replay. The owner can also see every seat and "Jump in" at a step to play on from there in a private copy (a replay fork). Spec: [specs/2026-10-10-replay-fork.md](../specs/2026-10-10-replay-fork.md) (section 7.6 is the live API). Data flow: [architecture/data-flow.md](../architecture/data-flow.md).

## Entry points

| URL | What it is | Source (`packages/web/`) |
| --- | --- | --- |
| `/duels/[slug]/replay` | Replay viewer | `app/(app)/duels/[slug]/replay/page.tsx`, `src/components/duel/replay.tsx` |
| Match history on `/duels` | Links to replays of finished duels | `src/components/duel/lobby.tsx` |
| `/admin` "Duels today" | Replay links for the owner | see [owner-admin.md](owner-admin.md) |
| `/settings/bug-reports/[id]` | "Open replay at this moment" | see [bug-reports.md](bug-reports.md) |

## Watch a replay

1. The player opens `/duels/[slug]/replay`.
2. The page calls `GET /api/duels/[slug]/replay`. The web route checks access to the room, then asks the duel server (`op: "replay"`).
3. The duel server runs the saved journal again on the engine and returns one frame per step.
4. The player steps, plays or seeks through the timeline. The log panel shows each step. 1v1 uses the two-seat board; Tag uses the Rooftop table; FFA uses its own layout (`replay-tag.tsx`, `replay-ffa.tsx`).

Views for a player (`readReplayQuery` in `src/lib/duel-host.ts`):

| Query | Shows |
| --- | --- |
| `visibility=public` | What a spectator saw |
| `visibility=mine` | Your own cards too (players in the duel) |

The player keeps the same card visibility rules as in the live duel.

## Owner views

`isOwnerUser` (`OWNER_USER_IDS`) turns on more controls. The owner route is `GET /api/admin/duels/[slug]/replay` (`op: "owner-replay"`).

| Query | Shows |
| --- | --- |
| `seat=0..3` | That seat's own view, with hand and prompts |
| `reveal=1` | All hands open |
| `unchecked=1` | Play a replay that failed the version check (owner only) |

## Cross-version check

Card data and engine scripts change each week. An old journal may not give the same board on the current files. Each replay answer has `verification`:

| Value | Meaning |
| --- | --- |
| `exact` | Same engine version and identity as when the duel was played |
| `verified` | Rebuilt on current files; the final public board and every seat's board match the saved boards |
| `unverified` | The owner chose to open it unchecked, or the page shows only the saved final board |

If the check fails, the route answers 409 `REPLAY_UNVERIFIED` with `reason` (`board_mismatch`, `command_mismatch`, `no_saved_board`) and `canOpenUnchecked`. Only the owner can open it unchecked, and never after a command mismatch. The verdict is stored in `duel_replay_verifications`.

If the replay is too large (16 MiB wire budget), a player gets 413 `REPLAY_TOO_LARGE` and the saved final board when it exists. The owner gets step metadata only, so Jump in still works.

## Jump in (owner only)

1. On the replay, the owner pauses at a stable step and presses "Jump in here".
2. The page calls `POST /api/admin/duels/[slug]/replay/fork` with the step cursor, the source version and a retry key.
3. The duel server checks the journal prefix in a separate worker and creates a new private duel with `kind: "replay-fork"`. The source duel does not change.
4. The page opens the fork room `/duels/[forkSlug]`, marked "Replay fork". All seats use Manual control.
5. The owner plays every seat. Requests carry `as=<seat>`. "Follow prompt" moves to the seat that must answer.
6. Restart from the same step: `POST /api/duels/[forkSlug]/fork/restart`. Stop: `POST /api/duels/[forkSlug]/fork/cancel`.

Rules for forks:

- A fork never counts for stats, scores, series, tournaments or matchmaking. It sends no invites or messages to the source players. Bug reports from a fork are refused.
- At most 4 active forks per owner. A fifth answers 429 `FORK_LIMIT`. List them with `GET /api/admin/duels/forks`.
- Forks do not expire. The owner cancels them.
- A cross-version source must pass the check first. The first Jump in on such a source can answer 503 `REPLAY_VERIFIED_RETRY`; press Jump in again.

Engine families and old replays: [deployment/duel-engine-switch.md](../deployment/duel-engine-switch.md). Load measurements: [performance/replay-load.md](../performance/replay-load.md).
