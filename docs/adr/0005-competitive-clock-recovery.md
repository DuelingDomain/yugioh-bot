# Competitive clock recovery and idle backstop

Status: Accepted (owner direction, 2026-10-19)

A competitive game is ranked or belongs to a tournament match through its series. Competitive clock expiry is a loss.
Ranked games use a 180-second bank; tournaments keep the organizer's bank, including unlimited.

Every play game has a ten-minute player-input idle backstop. For a competitive game, the host first attempts to settle
its saved deadline without recovering an engine. If no loss can be settled, including a settlement error, the host
interrupts without a winner or match/rating result. This includes unlimited tournament matches under the current rule.
Views, bot actions and heartbeats do not renew player activity. Downtime counts toward this idle backstop.

Engine installation ignores all idle play games when deciding whether replacement is safe. With services stopped,
it interrupts casual idle rows and preserves competitive rows for the restarted host. Competitive rows cannot block
deploys forever because the host always has the no-winner backstop. Clock sweeps rotate through bounded batches so
unsettleable rows do not starve newer games.

The host persists a heartbeat each tick. Startup preserves a deadline at or before the previous heartbeat for a real
loss. It excludes subsequent downtime from later deadlines, rebasing banks and committing a new heartbeat in one
transaction. Ranked remaining time becomes the lesser of 180 seconds and live remaining time at the heartbeat;
tournament banks retain their size. Each running clock starts at boot. Without a heartbeat, use live remaining time
at boot and award no immediate win. Exhausted unproven clocks and legacy continue-at-zero freezes receive the existing
30-second minimum regain. A missing ranked clock is initialized when engine recovery succeeds; otherwise idle cleanup
closes it. An unlimited tournament retains its null clock.

Integration coverage uses the real SQLite services, host request/sweep lifecycle and installer subprocess, with
fixture engine workers and isolated temporary data. See `host-live-idle.test.ts`, `install-engine-bundle.test.ts` and
`scripts/deployment/deploy.test.ts`.
