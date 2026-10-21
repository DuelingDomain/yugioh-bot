# Admin live spectating

The requested console owner policy (`OWNER_USER_IDS`) remains authoritative. All reads and subscriptions bind to the configured guild. Private POV snapshots travel only through owner-authenticated, uncached HTTP reads; Socket.IO carries existing invalidations, never private snapshots.

- Add purpose-separated signed admin spectator claims and recheck owner identity/guild on socket joins and broadcasts. Force invisible duel observation regardless of client flags.
- Add an owner-only duel host read operation using existing worker seat views. Never run normal view side effects, bot driving, clock settlement or activity updates. Reconstruct a missing worker in isolation and close it after the read.
- Reuse draft projection with a server-only spectator option that suppresses lobby ticking and pick expiration. Return the chosen player's pack, pool, picks and saved draft deck without changing membership.
- Add owner-gated snapshot/connection routes under `/api/admin/{duels,drafts}/[slug]/spectate` and basic watch pages under `/admin/watch/{duel,draft}/[slug]`. Connect existing live-list Watch links.
- Verify with targeted integration tests across real SQLite routes, signed host requests and real Socket.IO clients; typecheck changed packages. Document behavior, commit in small groups, push and open a PR without merging.

Implemented and verified: service/host/route integration with real SQLite, real Socket.IO subscriptions, and browser UI fixtures. Read-only regressions cover overdue draft timers/lobbies, capped-pack swapping, image fallback identity creation, resident query-error telemetry, and revocation. The independent security review found no remaining blockers after these fixes.
