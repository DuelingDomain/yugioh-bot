# Competitive clock recovery and idle backstop

Status: Accepted (owner direction, 2026-10-19)

A competitive play game is ranked or belongs to a tournament match through its series. Competitive clock expiry is a loss.
Ranked games use a 180-second bank; tournaments keep the organizer's bank, including unlimited.
Replay forks are local sessions and never participate in competitive clocks, settlement or heartbeat recovery.

Every play game has a ten-minute player-input idle backstop. For a competitive game, the host first attempts to settle
its saved deadline without recovering an engine. If no loss can be settled, including a settlement error, the host
interrupts without a winner or match/rating result. This includes unlimited tournament matches under the current rule.
Views, bot actions and heartbeats do not renew player activity. Downtime counts toward this idle backstop.

Engine installation ignores all idle play games when deciding whether replacement is safe. With services stopped,
it interrupts casual idle rows and preserves competitive rows for the restarted host. Competitive rows cannot block
deploys forever because the host always has the no-winner backstop. Clock sweeps rotate through bounded batches so
unsettleable rows do not starve newer games.

The host persists a heartbeat each tick while a competitive play game is active. Startup preserves a deadline at or
before the previous heartbeat for a real loss. It excludes subsequent downtime from later deadlines, rebasing banks and committing a new heartbeat in one
transaction. Ranked remaining time becomes the lesser of 180 seconds and live remaining time at the heartbeat;
tournament banks retain their size. Each running clock starts at boot. Without a heartbeat, use live remaining time
at boot and award no immediate win. Exhausted unproven clocks and legacy continue-at-zero freezes receive the existing
30-second minimum regain. A missing ranked clock is initialized when engine recovery succeeds; otherwise idle cleanup
closes it. An unlimited tournament retains its null clock.

Integration coverage uses the real SQLite services, host request/sweep lifecycle and installer subprocess, with
fixture engine workers and isolated temporary data. See `host-live-idle.test.ts`, `install-engine-bundle.test.ts` and
`scripts/deployment/deploy.test.ts`.

Decision time follows the engine's pending prompt owner, independently of the turn seat. The engine exposes one
pending decision at a time, including sequential FFA3/FFA4 and Tag response windows. Other seats' banks stay still.
The host holds clocks only for engine work: accepted responses, chain-mode changes, bot planning/actions,
actual recovery, starts and timeout settlement. Queueing and resident room/card/capability reads grant no credit
and do not write clock state. Rejected answers receive no server-work credit. Credit accumulates up to ten seconds
per prompt, including across nonpassing chain-mode changes and recovery. Excess work charges that prompt's owner;
an exhausted loss remains due across handoff, before any later turn regain. A deadline already due when an
operation starts still settles normally. Player-input activity and the ten-minute idle backstop remain independent.
Final snapshot failures are logged and use a minimal clock read so projection errors cannot leave a bank paused.

Fresh presentation events defer decision time by their expected animation duration at the next viewer's effective
FX speed, bounded to five seconds for ordinary effects and fifteen seconds for coin sequences including backlog.
Only a handoff to another seat adds its reveal/delivery allowance; the seat that just acted receives only real FX
time. Historical events never grant fresh grace. Event-free clocked handoffs and reconnects expose controls
immediately when the server clock is running and the client is quiet. Fresh FX and catch-up still keep their reveal
beat even if the server's clock has started. During a submitted move or chain-mode request the client freezes its
old snapshot; the authoritative reply replaces it. Paused/future clocks show a static bank without an answering marker.
