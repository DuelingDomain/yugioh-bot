# Guaranteed outside synergy partners

**Goal:** Keep named support and members while reserving outside partners their own share of the 40-card result.

**Design:** Classify every qualified hit as `member`, `support`, or `outside` in `synergyCategory`. A member belongs to any requested archetype (or is the exact named anchor); support explicitly names any target; outside belongs to neither category. Every shared hit must still qualify for every target. Retain at most 15 member/support hits and 25 outside hits, ranked independently with existing hook strength and tie breakers. Apply this selection before pagination; never fill a missing share with generic matches.

**Implementation:**

- [x] Extend existing SQL and real-catalog integration cases to cover category flags, quotas, pagination and unchanged generic exclusions; demonstrate failure first.
- [x] Add shared classification/selection, use it in both SQL insights and host queries, and preserve flags through resolver/format adapters.
- [x] Group Cards and Describe results under “Archetype cards” and “Works with”; retain independent target headings and keyboard selection.
- [x] Run relevant integration suites and TypeScript checks; measure all five queries against the existing read-only catalog and compare both entry points.
- [x] Review changes, record top outside partners and validation, remove generated output, and commit only explicit owned paths (retry index locks).

No new unit tests, bridge edits, live database writes, engine bundle changes, paid calls, or environment-file reads.
