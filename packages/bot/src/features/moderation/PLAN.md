# Moderation module

Implements the approved Phase 1 plan in `bot-phase1-common.md`. All handlers use
fresh guild membership and shared `isModerator`; warning removal also requires
shared admin access. Discord command defaults remain Moderate Members, with the
Moderator role enabled in Server Settings → Integrations as specified in the plan.

- [x] Add integration coverage with real SQLite, real interaction adapters and a local Discord REST server.
- [x] Add permission, hierarchy, audit and confirmation helpers within this module.
- [x] Add member moderation, warnings, purge and channel controls.
- [x] Add the User info context menu through the module startup hook, because the runtime adapter only handles chat commands.
- [x] Verify targeted integration tests, runtime integration tests and bot TypeScript.
- [x] Review implementation. Commit with the required trailer and push; do not create a PR.

Lock snapshots use successful `lock` audit parameters (including the complete
previous @everyone overwrite, or null). A durable pending audit row precedes the
REST write so a lost response or process exit cannot discard the snapshot. Unlock
restores that overwrite exactly. No shared schema or runtime change is required.

Confirmation payloads retain the shown target, reason and options. One-use buttons
expire after 60 seconds. The actor, permissions, hierarchy and channel are checked
again at confirmation. Mutations use the runtime guild lock and actor cooldown.

Timeout accepts compound integer units s/m/h/d/w, up to 28 days; `remove`/`0`
clears it. Ban delete-message-days is 0–7. Purge scans the most recent `count`
messages (1–100), applies the optional user filter, skips messages at least 14
days old, and reports skipped counts. Purge over 10 and overwrite changes require
confirmation. Warnings are listed in pages, and only admins can clear one.

Audit rows and one mod-log outbox post commit together, including actor, target,
reason and duration. Failures contain fixed error codes; upstream error text never
goes to Discord or the database.

Verification: 30 moderation integration tests and 61 total bot tests passed.
Bot typecheck and build passed. Independent code review has no open findings.
