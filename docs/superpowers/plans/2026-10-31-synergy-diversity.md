# Outside synergy diversity follow-up

**Goal:** Limit Works with to three cards from any other archetype and exclude random milling that only satisfies a generic material-setup hook.

**Design:** Apply the shared diversity selector to ranked outside results before the existing 25-card share and pagination. Count every known engine membership, falling back to the primary SQL archetype when engine membership is unavailable. Ungrouped cards do not share a bucket. Leave the 15-card member/support share intact. Require deliberate Deck setup, rather than incidental top-of-Deck milling, for the typed send-to-GY hook.

**Implementation:**

- [x] Extend SQL and real-engine integration coverage for diversity, constrained pools, pagination, and loose Blue-Eyes picks; observe failures first.
- [x] Update the shared selector and setup matcher, then connect both query paths without changing web or bridge files.
- [x] Run integration suites and shared/duel typechecks, compare both read-only query paths, and record Monarch/Blue-Eyes outside top tens.
- [x] Review, remove generated build output and scratch files, then commit only explicit owned paths, retrying index locks.

The coordinator's supplied design and request authorize inline implementation and one follow-up commit. No new unit tests, live DB writes, environment-file reads, paid calls, engine-bundle changes, web edits, or process kills.
