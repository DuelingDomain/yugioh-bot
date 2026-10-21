# Admin VPS health implementation plan

Goal: add owner-only VPS pressure diagnostics beside disk, with bounded one-minute history.

Architecture: services report their own cgroup v2 counters to shared SQLite; Caddy writes its own counters to a private volume read by the worker. Worker samples host /proc and aggregates fresh reports every minute. Keep 1,440 minute buckets. The web reads history through its existing owner/session guard and guild-scoped activity queries. No Docker socket or host cgroup mounts.

- [x] Add integration coverage using real temporary proc/cgroup fixtures and SQLite for sampling, retention, stale/missing data and pressure thresholds.
- [x] Add shared sampler, service reporter, bounded persistence and status evaluation; wire worker/ws/duel/web lifecycles and actual engine pool counters.
- [x] Add Caddy self-reporting with a private read-only worker volume, preserving its normal entrypoint.
- [x] Add isolated health API/component/styles, with host/cgroup/capacity sparklines and freshness; preserve disk.
- [x] Run targeted integration checks and affected package typechecks, review, update admin docs, remove generated output.
- [x] Make small attributed commits, push and open PR to main without merging.

Thresholds: RAM >80% and 1-minute load > host vCPU count for a continuous 15 minutes => Upgrade soon. Engine reservations >= two-thirds of max (8/12) in >=15 distinct minute buckets in the last hour => Upgrade soon. Any reported OOM kill (current cgroup or retained history) => Upgrade soon. Current pressure => High. Missing/stale host => n/a, with explicit incomplete coverage; do not infer sustained pressure across gaps. History resets only after retention, not service/worker restarts.

Tests use real filesystem/SQLite boundaries. No new unit tests, engine data, env files, production listeners or full test suites.

Verification: 27 targeted integration assertions/tests plus the production Compose security check pass (28 total); shared/ws/duel/web/worker typechecks pass. Shared and worker TypeScript builds pass. The worker SIGTERM check uses its built entrypoint on an isolated SQLite fixture. No engine suite or production listener is involved.

Published as PR #433: https://github.com/DuelingDomain/yugioh-bot/pull/433 (base main; not merged).
