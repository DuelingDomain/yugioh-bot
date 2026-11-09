# Ideas backend implementation plan

**Goal:** Implement the approved backend in `docs/specs/2026-10-31-ideas-board.md`.

**Architecture:** Shared SQLite migrations and a transactional service own the board rules. Thin authenticated web routes expose typed responses. Owner operations seed reviewed data; account lifecycle paths preserve or remove ideas data as specified.

**Constraints:** Node 22; no git writes, UI, design edits, analytics or websockets. Focused tests only. Shared must build before consumer checks.

- [x] Schema and shared service: add the four tables and prompt timestamp in `db/schema.ts`; export typed board, done, post, vote, prompt, notice and decision results. Verify ranking, privacy, completion gate, limits, transactional prompts and notices in `tests/services/ideas.test.ts`.
- [x] Accounts: update merge dry-run and apply, both identity-fold directions, deletion preview and apply. Verify overlapping rows preserve the survivor and approved authors become null.
- [x] Seed: keep exact mock content in `worker/src/ops/ideas-seed-data.ts`; implement dry-run/apply/report integration and stable keys. Verify zero votes, owner validation and second-apply idempotency.
- [x] API: implement all eight routes, shared request/response exports and `docs/api/ideas.md`. Verify guard 401/503, owner 404, Origin 403, no-store, body validation and expected conflicts.
- [x] Review and verify: shared focused tests/typecheck/build, worker focused tests/typecheck, web focused tests/typecheck, inspect final diff against spec.

Rulings: Public ranks are ordinal positions; `score` is up minus down. Recent Done in the queue means the latest 50 entries. Historical shipped lines retain their exact wording, including lines longer than the normal 80-character posting limit. The database permits up to 140 characters only for those flagged historical entries.

Verification: 126 focused shared/worker tests and 105 web route tests passed. Shared and worker typechecks, shared build, and web typecheck passed. Independent final review found no actionable issues. No git writes. Concurrent design-tool edits were preserved.
