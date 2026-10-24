# Dueling Book alternate passcodes

**Goal:** Import every verifiable Dueling Book alternate passcode while preserving engine identities and visible preview notes.

**Design:** Fetch the public static `https://static.duelingbook.com/cards.json` once per refresh with a bounded plain GET. Its `cards` array uses `n` (name), `s` (serial number), and `s2` (alternate passcode), expanded by `loadCards` in `utils.js`. Generate a deterministic committed numeric JSON object after checking the pinned engine database, playable targets and normalized names. Skip all engine-known source IDs, missing/unplayable targets, name mismatches and ambiguous mappings. Resolve locally at import time; no Dueling Book request is needed during an import. A companion JSON name table preserves the existing runtime name/playability guard when the prepared engine differs from the generation snapshot. Engine IDs always have priority.

The owner supplied the design constraints and authorized implementation through an open PR in the specified worktree. Execute inline. Live import-time fetching would add an external dependency; inferring neighboring IDs would lack evidence. A generated, reviewed table follows the supplied design.

**Weekly update:** Prepare the candidate (or current pins on an unchanged run) and refresh on every scheduled run. Permit table-only updates by recomputing final changed/files metadata and using the actual prepared pins. Fetch/validation failures preserve the old table and emit a warning. Carry a changed table through candidate metadata and the patch. Extend the trusted publisher's exact allowlist only for the mapping and companion name JSON files; validate numeric passcode pairs, target name evidence, canonical formatting, regular file mode and exact changed paths before any working-tree write. Keep pin-content and human-commit protections.

**Validation:** Extend the existing import-route integration tests for multiple real entries (including a non-neighbor mapping), copies/sections, named notes, save behavior, and engine ID priority. Exercise the generator against a real temporary SQLite database and controlled HTTP responses in an existing integration test file. Extend Git-backed publication coverage for accepted table-only and combined pin/table updates and rejected malformed/unreported patches. Run only relevant test files and the duel-server/web typechecks; build shared as their prerequisite. Verify deterministic generation and fetch-failure preservation.

- Verify public source and inspect its loader/exporter.
- Install Node 22 dependencies and establish targeted baseline.
- Add failing integration coverage before implementing table resolution/generation.
- Generate against the current pinned engine database; report skip counts/examples.
- Add best-effort weekly refresh and strict publication support with failing integration coverage first.
- Update format documentation and validate touched packages.
- Request independent code review, address findings, commit logical changes with the requested trailer, push and open the PR.
- Delete worktree dependency/build output and confirm the main checkout is unchanged.

Validation: Node 22.23.3; 117 targeted duel-server tests and 133 import-route integration tests passed. Duel-server and web typechecks and the shared/duel-server builds passed. The compiled resolver checked all 78 mappings without network, cached-source generation reproduced both committed JSON files byte-for-byte, and workflow YAML parsed. Independent review covered runtime source-ID priority, retained name evidence, strict publication, history recovery and legacy bot PRs.
