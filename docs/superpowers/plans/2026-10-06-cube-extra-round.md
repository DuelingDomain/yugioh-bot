# Normal cube Extra Deck round implementation plan

**Goal:** Extend shared-pool drafts with an optional Extra Deck pack after the main packs, preserving existing drafts and theme behavior.

**Contract:** Normal drafts default `extraDeckEnabled` to false and `extraDeckSize` to 15 (integer 0–15). `customExtraCardIds` contains one catalog ID per authored copy. An explicit array, including `[]`, overrides the source cube's extra pool; otherwise `poolSource.cubeId` supplies guild-scoped extra rows. Freeze both deals at start. One extra pack per seat has `extraDeckSize` cards. `picksPerStep` defaults to 1, supports 1 or 2, and means sequential timed selections before passing. Each selection retains its own existing pick-step number.

- [ ] Add focused shared tests in `packages/shared/tests/services/drafts-booster-extra.test.ts`, observe missing behavior, then implement config defaults/validation, analysis, phase quotas, persisted deal offsets, same-phase copy-cap swaps, and pick/pass grouping in shared types/services.
- [ ] Verify the shared file plus affected draft/theme/cube files with `vitest run <explicit files> --maxWorkers=1`; build shared before consumers.
- [ ] Add focused tests in `packages/web/tests/drafts-extra-round-route.test.ts` and `draft-pool-api.test.ts`; observe failures, then wire create/edit/preflight/pool/response and save-as-cube contracts. Preserve existing response fields and broadcast behavior.
- [ ] Run only explicit affected web files with `-c packages/web/vitest.config.ts --maxWorkers=1`. Typecheck touched packages under Node 22 and `prlimit --core=0:0`.
- [ ] Update `docs/api/cube-list-import.md` for the UI agent. Review, commit small verified changes with the required coauthor trailer, and delete generated build/typecheck output.

The owner's 4-seat format maps to `packsPerPlayer:5`, `packSize:24`, `cardsPerPlayer:120`, `picksPerStep:2`; its extra phase is pack 6. Existing main-pick quotas may end the last main pack early. Extra picks do not count toward that quota. Deck autosave keeps its existing 60/15/15 limits and preserves all picks in the draft pool.
