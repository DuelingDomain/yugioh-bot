# Effect CI tagging implementation plan

User-approved scope: extend the foundation at b096596c7 using the two owner briefs and the exact task. No further approval gate is needed. Work stays in es-ci-tagging; do not push or call paid APIs.

Design: reuse scripts/effects and its durable state/effect-tagging ledger. Reserve each request before its single POST. Use claude-haiku-5-5, worst-tier Batch prices, a $10 UTC calendar-month cap and a $2 run cap shared by tags and profiles. Keep historical Haiku 4.5 reservations readable. Refresh profiles with at least three members when membership grows beyond the upstream count, or a generated member-input hash changes, preserving hand-written profiles and synergy examples. One Batch contains tag and profile requests; new profile requests save prompt hashes and rebuild the prompt from pinned code before submission. Historical saved prompts remain readable; preserve all liabilities across restart/rollover.

Alternatives: a separate profile ledger risks two independent caps; workflow cache state can be lost. Both are rejected in favor of the existing Git compare-and-swap ledger. Keep data publication in the existing fixed-path validator and evaluated PR flow.

- [x] Extend the existing fake HTTP + real disk/artifact integration suite first. Verify Haiku 5.5, profile requests, cleanup, reuse, caps, historical results and candidate tamper guards.
- [x] Port upstream synergy prompt/profile selection into scripts/effects/profile-archetypes.ts and synergy-prompt.ts with source credit. Extend reservation schema/client/runner with profile work and model-specific billing.
- [x] Emit profiles with source hashes and validated provenance; expand the publication allowlist by profiles.jsonl.gz only. Verify the generated pin and all unchanged records.
- [x] Make missing-secret workflow skips explicit. Retain the approved engine-pin trigger and daily collection; document Monday/Thursday merge behavior, secret setup and ledger recovery.
- [x] Run targeted offline integration tests, shared/artifact/search evals, script TypeScript and workflow checks. Review the final diff, commit small changes with required trailers, and remove generated build caches.

Contract: runtime APIs, tables, EFFECT_SEARCH and attribution do not change. CLI remains scripts/effects/tag-cards.ts. The sole new published path is packages/shared/data/effects/profiles.jsonl.gz. No UI changes or screen checks are needed for this CI-only task.


Verification (2026-10-17): Node 22 npm ci and shared build passed. Script TypeScript passed. The Batch/disk/generated-pin SQLite suite passed 17 tests; shared artifact/search suites passed 21 tests; duel search eval passed 61 tests (60 labeled queries, precision and recall both 1.0). The workflow YAML parsed and git diff --check passed. Independent review findings were fixed and reviewed again. No paid API requests, GitHub writes, push, runtime flag changes or UI changes were made.

## Review follow-up

- [x] Preserve all hand-written rows and `SYNERGY_EXAMPLES`; dry-run integration checks protect Dark World and Tearlaments with 40 members, examples absent from an artifact, and other curated profiles.
- [x] Disable thinking on both Batch request kinds and verify the actual fake HTTP payloads.
- [x] Record sorted `generation.models` and validate it against accepted tags/profiles; verify current, historical and mixed-model publication plus re-signed provenance tampering.
- [x] Replace duplicate profile prompts with durable hashes. Verify restart, historical saved prompts, and a code/hash mismatch that leaves the reservation held before submission intent.
- [x] Defer failed profiles only while their member-input hash is unchanged. Verify changed-input retries, billed failures, and returning to previously failed inputs.
- [x] Retain the conservative 275,000-micro reservation. The 500 KB transport bound does not establish a billed-token bound including schema overhead. The default remains seven requests, at most 56 tag cards per run or 48 with one profile request.

Follow-up verification (2026-10-18): all 106 targeted integration tests passed (24 tagging/publication, 21 shared artifact/search, 61 duel search). All 60 labeled engine queries passed with precision and recall 1.0. TypeScript passed for scripts/effects, shared and duel-server; publisher syntax and git diff whitespace checks passed. The final read-only code review found no actionable issues. The real catalog dry run reported 2,219 card candidates, 134 profile candidates, zero protected-archetype candidates, zero submissions and zero spend; report saved to `.status/effect-tagging-review-dry-run/report.json`. UI is unchanged. No paid requests, GitHub writes or pushes were made. Generated build output was removed after verification; node_modules was kept.
