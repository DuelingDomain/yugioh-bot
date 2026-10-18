# Effect CI tagging implementation plan

User-approved scope: extend the foundation at b096596c7 using the two owner briefs and the exact task. No further approval gate is needed. Work stays in es-ci-tagging; do not push or call paid APIs.

Design: reuse scripts/effects and its durable state/effect-tagging ledger. Reserve each request before its single POST. Use claude-haiku-5-5, worst-tier Batch prices, a $10 UTC calendar-month cap and a $2 run cap shared by tags and profiles. Keep historical Haiku 4.5 reservations readable. Refresh profiles with at least three members when membership grows beyond the upstream count, or a generated member-input hash changes. One Batch contains tag and profile requests, each with its own saved prompt; preserve all liabilities across restart/rollover.

Alternatives: a separate profile ledger risks two independent caps; workflow cache state can be lost. Both are rejected in favor of the existing Git compare-and-swap ledger. Keep data publication in the existing fixed-path validator and evaluated PR flow.

- [ ] Extend the existing fake HTTP + real disk/artifact integration suite first. Verify Haiku 5.5, profile requests, cleanup, reuse, caps, historical results and candidate tamper guards.
- [ ] Port upstream synergy prompt/profile selection into scripts/effects/profile-archetypes.ts and synergy-prompt.ts with source credit. Extend reservation schema/client/runner with profile work and model-specific billing.
- [ ] Emit profiles with source hashes and validated provenance; expand the publication allowlist by profiles.jsonl.gz only. Verify the generated pin and all unchanged records.
- [ ] Make missing-secret workflow skips explicit. Retain the approved engine-pin trigger and daily collection; document Monday/Thursday merge behavior, secret setup and ledger recovery.
- [ ] Run targeted offline integration tests, shared/artifact/search evals, script TypeScript and workflow checks. Review the final diff, commit small changes with required trailers, and remove generated build caches.

Contract: runtime APIs, tables, EFFECT_SEARCH and attribution do not change. CLI remains scripts/effects/tag-cards.ts. The sole new published path is packages/shared/data/effects/profiles.jsonl.gz. No UI changes or screen checks are needed for this CI-only task.
