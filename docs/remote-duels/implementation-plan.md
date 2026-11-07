# Remote Duels foundation implementation plan

Goal: expose a stable shared game/action contract and a working authenticated HTTP → SQLite → Socket.IO loop for 2–4 physical players.

Architecture: independent remote tables, a pure game module, immediate SQLite transactions, signed internal invalidation, and seated-only room tokens. Follow the owner MVP spec over the older design report where they differ. No engine, media, recognition, or speech runtime.

- [x] Shared contract: typed actions and runtime validation, game registry, Yu-Gi-Oh phases/resources/zones, FFA turn and elimination rules, deterministic five-second undo. Add one reducer/service integration test file and first verify missing behavior fails.
- [x] Persistence: additive migration in schema.ts, transactional create/join/leave/ready/start/act/get/list/sweepIdle service, scoped to guild and application user. Sequence conflicts and idempotent retries. Append-only events and replay.
- [x] Transport: remote-room tokens, Socket.IO room handlers, bounded/rate-limited recognition data relay, persisted access checks on joins and delivery, signed /internal/remote/changed invalidation. Run idle sweep every 30 seconds in ws; presence never writes activity.
- [x] Web: existing web-session guard and configured guild, feature-gated routes under /api/remote, LiveKit 503 stub, minimal /duels/remote pages and section navigation.
- [x] Document docs/remote-duels/contract.md, run targeted tests and package typechecks, review the final diff, remove generated output, commit in small batches and push feat/remote-duels. No PR or merge.

Verification: Node 22; targeted Vitest reducer/service, existing token/ws/internal HTTP/web route test files with added remote cases. Shared build before consumer checks. No engine suites. Confirm deploy guard still reads only duels/drafts and main checkout status remains unchanged.

Validated: 184 targeted cases across reducer/service/schema, room tokens, real Socket.IO handlers, signed internal HTTP, web auth/routes, identity linking, history detection and account deletion. Shared build plus shared/ws/web typechecks passed. Two Chromium sessions exercised create/join/ready/start, connected Socket.IO, LP update, cross-seat undo and phase synchronization. Review findings on account history and copied names were reproduced and fixed; re-review found no remaining important findings.
