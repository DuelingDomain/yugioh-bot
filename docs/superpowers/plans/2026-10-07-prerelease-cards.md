# Prerelease Cards Implementation Plan

**Goal:** Load casual-format prerelease cards without duplicate identities or broken saved passcodes.

**Architecture:** Merge base, sorted non-Rush prereleases, then sorted releases. Drop prerelease identities already released or duplicated, preserving SQL integer values. Record deterministic passcode remaps from current inputs and upstream prerelease history since the feature's initial pin, so fresh deployment bundles retain graduations. Include the remap JSON in integrity and bundle identity. Apply remaps during deck reads/import/validation and an immediate, idempotent duel-server startup transaction across saved decks, registrations, cubes and drafts; leave replay journals untouched.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, pinned ProjectIgnis data, Git history.

The owner supplied the design constraints and authorized implementation to completion in the brief. Execute inline in the supplied worktree.

- [x] Add failing selection/merge tests for precedence, duplicates, Rush/Legend exclusion, and graduation/deletion.
- [x] Implement merge, historical identities, remap artifact, recipe bump and integrity verification.
- [x] Add failing migration/read tests; implement transaction and startup integration, remapped deck reads and scenario resolution.
- [x] Expose prerelease metadata through existing card APIs, preserving pool/banlist behavior.
- [x] Extend weekly reports and probes; retain the three-file publication allowlist.
- [x] Prepare the real bundle in data/engine-prerelease, reuse existing cores read-only, run targeted checks and update geometry fixtures as required.
- [x] Document verified upstream examples, migration, images, deployment and golden requirements; commit logical parts with the specified trailer.
- [x] Remove created build/dependency output, retain the prepared data, and return the brief's report.

Review fixes (2026-10-07):

- [x] Merge current origin/main and use integer user identities in remap fixtures.
- [x] Restrict identity deduplication/history remaps to main artwork, non-token rows; retain all five real artworks.
- [x] Protect read/import and migration paths from artwork remaps; refuse unsafe nonempty v1 artifacts before writes.
- [x] Repair surviving artwork aliases after historical graduations; check application artwork families inside the migration transaction.
- [x] Skip and log malformed/non-object JSON rows, cap cube collisions at 99, and declare the migration marker table in schema.ts.
- [x] Fetch historical database blobs in one batch and walk full merge history.
- [x] Report disappeared codes without remaps and matching-stat renamed-release suggestions; report ambiguous old snapshots without aborting candidate updates.
- [x] Add the bundle rollback note to both deployment docs.
- [x] Prepare a fresh v2 bundle, run targeted tests/typechecks, and record/check all native golden rows.

Validation: Node 22; shared build and repository typecheck passed (all seven packages, no cached checks). Targeted Vitest passed 200 tests in 14 shared/duel-server files and 44 tests in two web files, including every retained preview on legacy/pinned 1v1, FFA3/FFA4 and Tag in normal/Domain modes. Commands used prlimit --core=0 and Vitest --maxWorkers=1. The native driver was reused with fresh card dumps: golden --record wrote 80 rows; --check verified 80 rows with zero skips and zero mismatches. Forty-two golden rows changed; all three fingerprint headers stayed unchanged. Bundle integrity and an idempotent startup migration were also verified against an isolated in-memory application database with zero FK violations. A final independent review found no remaining actionable issues.

Prepared data remains in data/engine-prerelease/bundle-fixed: 14,984 cards, 139 retained previews, zero drops/remaps at the initial pin, and zero Rush/Legend rows. The five alternate-art aliases match their upstream families, including King of Beasts' alias 41463181. Existing WASM cores were reused without rebuilding. Created dependencies, shared dist, tsbuildinfo, typecheck caches and temporary native test output are removed at handoff; the prepared bundle remains. The geometry audit still documents Castellan FFA4 and Tag zone-mask limitations; initialization checks do not prove those effect callbacks.
