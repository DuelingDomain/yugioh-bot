# Duel snapshot storage compaction

The owner approved this work. Preserve the final public board and each seat's own board. Keep events: finished room history and last-damage displays use them. Keep log lines for the UI and bug context.

Use one server-side snapshot accessor. It accepts old JSON text and gzip BLOBs in the existing SQLite snapshot columns. SQLite permits BLOB values in these TEXT-affinity columns. New final writes remain JSON. For rooms with more than two seats, write the complete seat list and omit duplicate seat 0 and seat 1 columns. If the list is incomplete, keep the legacy columns. The list takes precedence on every read. Hash the stored bytes for replay cache keys; a storage change invalidates the cache.

Add nullable `turn_count` and `snapshot_compacted_at` columns. Write the count at duel end. History selects the count without parsing boards. Counts on old rows can be unknown until the background pass reaches them. Migration adds columns only; it does not rewrite snapshots.

The duel host already runs archive jobs. Add a separate low-frequency timer there. Each pass reads at most 50 eligible terminal rows, prepares gzip data outside the write transaction, and yields between rows. Each transaction uses a zero busy timeout and yields between batches. Limit the number of batches per sweep. A durable completion stamp permits restart and avoids repeated work. Compare original snapshot bytes and terminal metadata before each update to protect concurrent changes. Preserve unreadable values. Null a duplicate only when a valid seat list supersedes it. No events or logs are removed.

Delete only replay-fork rows that are cancelled and ended more than seven days ago. Require foreign keys and exclude series-linked rows. Seat, command, grant, and retry rows cascade. Source references in the fork setup and retry table are strings, not foreign keys; deleting a fork does not delete a source. Normal duels and active or finished forks are preserved. Restart clears count and compaction metadata.

Environment: `DUEL_SNAPSHOT_RETENTION_ENABLED` (default on; `0` or `false` disables compression and fork cleanup), `DUEL_SNAPSHOT_RETENTION_DAYS` (30), `DUEL_SNAPSHOT_RETENTION_INTERVAL_MS` (6 hours). Batch size, batch delay, and sweep cap are fixed to bound work.

VACUUM is manual. Drain all writers, take a SQLite backup, reserve free disk at least equal to the database file size, then run VACUUM and integrity checks. Compression makes pages reusable; VACUUM returns space to the file system.

## Implementation plan

1. Add tests for complete multiplayer seat lists and two-seat compatibility. Omit duplicates on final writes. Run targeted shared room tests. Commit.
2. Test the nullable count and migration reruns. Write the count at duel end and select it in history. Update old-row tests to use background backfill. Commit.
3. Measure synthetic realistic boards before compression. Test the codec, plain reads, corrupt values, room selection, web fallback, owner reveal, host result frames, bug context, and cache invalidation. Add the accessor and convert all readers. Commit.
4. Test retention limits, resumability, kill switch, short lock handling, concurrent restart, and guarded fork deletion. Add the background job and host timer. Commit.
5. Document storage, environment settings, measurements, and manual VACUUM. Run only the named test files. Typecheck shared, web, duel-server, ws, and bot with Node 22 and core dumps disabled. Review the diff. Fetch and merge the base branch if it changed. Repeat affected checks, remove generated build output, commit with required trailers, and push. Write the external completion report.

## Review constraints applied

Cap each update transaction at 50 rows and 4 MiB of original snapshot bytes; one larger row can proceed alone. Gzip runs asynchronously before the transaction. Delete one fork per transaction, with at most 50 fork deletes per sweep. Index `replay_fork_requests.fork_duel_id` to bound cascade lookup work. Restore the connection timeout in `finally`. The final DELETE rechecks kind, cancelled status, end age, and absent series link. The host runs one sweep at a time, checks stop between work units, and awaits it at shutdown. Only a complete list with every expected seat board can supersede both legacy columns. Stamp unreadable rows but preserve their bytes.

Code review added nested seat validation, turn preservation on active cancellation, and exclusion of queued fork work before deletion. Foreign-key enforcement is rechecked after each yield before deletion. Regression tests cover each case.
