# Duel startup SQLite contention

A deploy restarted duel once after `resumeCompetitiveClocks` failed
writing `duel_host_heartbeat`. The subsequent startup succeeded. The deploy
requirement of `running restarts=0` correctly rejected this rollout.

## Writers during simultaneous startup

| Service | Startup database work |
| --- | --- |
| duel | `openDatabase` runs `migrate`; immediate card-passcode remapping; immediate effect-artifact import when enabled; competitive-clock rebase/heartbeat; optional script-error pruning; initial clock/archive sweep and service-health report. Snapshot retention starts later. |
| worker | `openDatabase` runs `migrate`; initial VPS health/history transaction, presence cleanup, product-event drain, draft and tournament timers, heartbeat, disk snapshots. Set sync runs initially only for an empty set cache; Genesys sync can also write after its fetch. |
| bot | `openDatabase` runs `migrate`; after Discord login, feature startup/outbox processing, online-status publication and heartbeat write shared state. |
| web | Node instrumentation starts health reporting through `getDb`, which calls `openDatabase`/`migrate`; routes can initialize another module/process connection. Health reporting writes immediately. |
| ws | Opens an existing database directly for a best-effort service-health write with a zero busy timeout. Does **not** run `migrate`; duel socket presence is kept in memory. |

`migrate` is not one enclosing transaction. It runs DDL, immediate column checks,
idempotent backfills, cube migration and access-index transactions on each open.
Consequently, even fully migrated services compete for SQLite's single writer.

## Why five seconds did not protect the heartbeat

The old clock rebase used a deferred transaction: read the heartbeat and active
duels, then update clocks and write the heartbeat. In WAL mode, another writer
can acquire the writer slot during those reads. SQLite can reject the upgrade
immediately with `SQLITE_BUSY`, or `SQLITE_BUSY_SNAPSHOT` if that writer committed.
Waiting cannot repair a stale snapshot. The transaction must roll back and start
again. See SQLite's [isolation documentation](https://www.sqlite.org/isolation.html)
and [busy-handler documentation](https://www.sqlite.org/c3ref/busy_handler.html).

A local two-connection WAL reproduction with `busy_timeout=5000` returned
`SQLITE_BUSY` in 1 ms while the writer held its transaction, and
`SQLITE_BUSY_SNAPSHOT` in 0 ms after the writer committed between reads and writes.
There need not be a transaction holding the lock for more than five seconds.
The production log has neither the extended SQLite code nor lock-owner tracing,
so it cannot establish which concurrent service owned the writer slot.

Reviewing the three-day schema history and PRs #438/#441/#443/#440 found no
evidence of a five-second migration introduced by these PRs. #438 adds the
`discord_status_messages` table and `duel_series_guild_status_idx`; the other
three do not change the application schema. #443 changes engine data, so duel
can run its existing per-bundle passcode migration. That phase completed before
the failed clock resume. No long lock holder was established to shorten.

## Recovery

Clock recovery now takes `BEGIN IMMEDIATE` before reading and samples time only
after acquiring the lock, keeping rebases and the heartbeat atomic without
charging lock waits to players. Duel retries synchronous startup database phases on
`SQLITE_BUSY` and its extended codes with exponential backoff from 100 ms to
1 second and a 60-second retry budget. Each SQLite attempt retains its normal
five-second busy timeout; a final attempt can finish after the retry budget.
Other errors and persistent contention still fail startup. Phase, SQLite code,
attempt and elapsed time are logged on retries. Failed database opens close
their connections; failed transactions roll back before retrying. Auto-block
startup refresh is also retried. Clock recovery follows cleanup and precedes
host timers. Request-time behavior is unchanged.

The integration suite uses a real WAL file and a worker-thread connection
holding write transactions for 6.25 and 11.25 seconds. It verifies host startup,
one clock rebase without charging lock waits, database-open/migration recovery,
retry exhaustion and other-error handling.
The retry helper asserts that an existing connection is outside a transaction
before every attempt, so a retry cannot reuse an open transaction or stale snapshot.

## Readiness and deploy confirmation

`GET /healthz` on the private duel listener returns only `ok` after startup has
finished, including clock recovery and worker-pool setup. Game workers start on
demand; advisory resource-cache warming does not gate readiness. The listener is
absent while startup retries and closes during shutdown (requests received while
closing get 503). The probe does no database work and requires no secret. Port
4003 is not published and Caddy does not route to it.

The image and Compose probe every 10 seconds, with a five-second timeout, three
retries and a five-minute startup grace period. During startup, probes run every
five seconds; success marks the container healthy immediately, even within the
grace period. The probe itself bounds HTTP waits to two seconds.

Deploy polls duel every five seconds for up to six minutes, then checks ws and
worker with their existing three-minute budgets. It rechecks duel is running,
healthy and has zero restarts after the web auth checks, before recording healthy
images. A failure follows the existing deploy failure path. There is no fixed
20-second sleep or five-minute delay for a ready service. Web keeps its
`service_started` dependency so unrelated pages can start while duel recovers.

For an explicit rollback to a release without a duel healthcheck, Deploy adds a
probe to its temporary runtime Compose configuration. It requires exactly 404
from `GET /` on the old private listener, which also opens only after startup.
This retains readiness and zero-restart checks for older images without requiring
them to implement `/healthz`. Current releases use their declared healthcheck.

The real-server integration check holds a SQLite write lock past the busy timeout,
verifies the endpoint is absent during retries, releases the lock, and checks the
unauthenticated 200 response and that gameplay still requires authentication.
