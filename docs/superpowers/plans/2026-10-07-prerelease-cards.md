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

Validation: Node 22; shared build and shared/duel-server/web typechecks passed. Targeted Vitest checks passed 202 tests in 19 shared/duel-server files and 114 tests in two web files, including every retained preview on legacy/pinned 1v1, FFA3/FFA4 and Tag in normal/Domain modes. Native golden --record completed 80 duels; --check verified 80 rows, zero skips and zero mismatches. All targeted test commands used prlimit --core=0 and Vitest --maxWorkers=1.

Prepared data remains in data/engine-prerelease/bundle: 14,979 cards, 134 retained previews, five remaps, zero Rush/Legend rows and no duplicate preview identities. WASM cores were copied read-only from the existing bundle. Created dependencies, shared dist, tsbuildinfo and native source caches were removed; data/engine-prerelease is retained. The geometry audit documents Castellan FFA4 and Tag zone-mask limitations; initialization checks do not prove those effect callbacks.
