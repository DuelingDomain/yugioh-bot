# Cross-version replay implementation plan

**Goal:** Use the current engine family to rebuild old journals and check their saved final game state before ordinary replay or fork use.

**Architecture:** Compare public and all own-seat views inside the existing bounded replay build, before any saved result frame is appended. Store pass/fail results by duel and current bundle, with source, board and resource stamps to invalidate stale checks. Keep unchecked owner builds in separate cache entries. Do not rewrite source identity or version. Forks retain their original prefix and use the selected current identity.

**Tech stack:** TypeScript, SQLite, Vitest, engine worker threads.

1. Add comparator tests for all game fields, private projections, and ignored volatile fields. Add the canonical comparator and durable verification table/service. Run those targeted files and commit.
2. Add cross-version host and fork tests. Select the saved engine family, allow the bounded runner to use selected current resources, and check final views before saved-frame append. Preserve exact replay, command checks, access rechecks, limits, retry guards and the manual host-rule guard. Run the targeted host, runner, resolver and builder tests and commit.
3. Add strict web query and transport tests for unchecked and typed errors. Update shared response/request types and the replay/fork spec. Run the targeted web/shared contract files and the prepared real-engine case if available.
4. Request a focused code review. Repair material findings. Run shared, web, duel-server, ws and bot typechecks. Remove generated build output. Commit remaining changes with the required trailers, push this branch, and write the external report with test counts and final commit.

Use Node 22 with core dumps disabled. Run only named test files. Keep all saved seat views on the server. Use synthetic test identities and no machine paths in repository content.
