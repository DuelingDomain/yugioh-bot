# Prerelease graduations and script safety implementation plan

> **For agentic workers:** Execute inline using the executing-plans skill, with review before completion.

**Goal:** Preserve saved passcodes across renamed/type-changed graduations and exclude broken prerelease scripts during preparation. Keep EDOPro runtime error handling and a card block list on a separate branch.

**Architecture:** Extend the pinned BabelCDB history reader with per-commit removed-preview/new-release transitions. Match only main cards with equal ATK, DEF, level, attribute and exact race plus nonempty effect text normalized by replacing their own names. Ignore type for this rule, require reciprocal uniqueness, and keep uncertain codes unknown with review findings. Validate a tracked old-to-new override map, include its exact contents in the existing integrity-protected card-remaps artifact, and use the established import/validation/startup migration. Isolate prerelease initialization smoke checks from released rows, exclude failing previews and preserve findings in the artifact. Runtime Lua diagnostics and a versioned block list live on a child branch.

**Tech Stack:** Node 22, TypeScript, better-sqlite3, Git history, ocgcore-wasm, Vitest.

### 1. Historical evidence and matching
- [ ] Record three real BETB rows and script rename commits in a reproducible fixture.
- [ ] Add failing tests for renamed/type-changed transitions, unrelated same stats, ambiguous pairings, skipped bumps, artworks, manual overrides and reporting.
- [ ] Extend `scripts/prerelease-history.ts`; add `scripts/prerelease-graduations.ts` and `card-remap-overrides.json`.
- [ ] Integrate with `scripts/released-card-data.ts`, `prepare-data.ts` and weekly report/update helpers. Bump recipe; include helper/override in bundle cache inputs.
- [ ] Verify import and startup migration using historical codes and official names/types, covering decks, cubes, drafts, registration, series and scenarios.
- [ ] Run targeted Vitest with `prlimit --core=0`, `--maxWorkers=1`; commit with requested trailer.

### 2. Prepare-time prerelease safety
- [ ] Add failing engine tests for load/initial_effect errors, healthy previews, aliases, unchanged previews, released errors and probe infrastructure failure.
- [ ] Add isolated registration smoke checking of every preview on the installed npm core. Exclude only previews with attributable errors; fail preparation on infrastructure errors. Do not play effect callbacks.
- [ ] Persist exclusions in remap artifact and report `excluded: script error`; filter database and scripts before hashing.
- [ ] Update deferred weekly validation, cache keys and deployment documentation.
- [ ] Prepare `data/engine-prerelease/bundle-v3`, reuse local cores read-only; targeted checks; commit.

### 3. Separate runtime policy branch
- [ ] Create child branch `feat/edopro-script-errors` in the same worktree after committing prerelease work.
- [ ] Verify EDOPro log behavior from source; regression-test engine continuation and bounded diagnostics on Lua errors, preserving structural/startup failures.
- [ ] Add a small versioned card block list enforced by legality even with deck validation disabled; report blocked cards in preparation/weekly report.
- [ ] Run targeted tests; commit with requested trailer; leave primary prerelease branch checked out.

### 4. Final verification
- [ ] Independent code review of scope and safety, fix material findings.
- [ ] Verify new bundle integrity/wrapper and retained card count, no unexpected remaps/exclusions; document smoke limits.
- [ ] Remove created dist/tsbuildinfo output, keep data directory. No pushes or WASM builds.
- [ ] Report evidence, rule, overrides, exclusions, tests, SHAs, bundle path/wrapper in <=14 lines.
