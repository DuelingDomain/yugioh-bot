# Cube list import implementation plan

Goal: owners can add name/passcode lists to a cube or create a populated cube in one request.

Design: a pure web parser reuses `parseDeckText` for YDK/ydke, retaining the original text for diagnostics. The shared catalog resolves normalized exact names first, batches missing exact names with YGOPRODeck's `name` parameter, then uses conservative unique edit-distance matches. Resolved entries are merged by a synchronous shared cube transaction; network work finishes before cube writes. Catalog cache warming is independent of cube writes, as in existing imports.

Contracts: editor `{op:"importList",text}` returns existing `{pools,cards}` plus `{added,copies,unknown,corrected}`. Creation accepts `{name,importText,draftType?}` (optionally `kind:"list"` or `"blank"`) and returns `{cube,added,copies,unknown,corrected}` with 201. Reject combining import text with archetype/pool/config options. Zero resolved cards returns 400 and creates nothing. Limits: 64 Ki characters, 1000 distinct input identities, 99 copies per card.

Execution is inline in the supplied worktree, with focused TDD and small commits.

- [x] Write failing parser and catalog tests, including a trimmed real fixture.
- [x] Implement parser and catalog resolution; build shared, run those files, commit.
- [x] Write failing transactional cube merge and API tests (authorization, limits, failures, zero results, duplicate names).
- [x] Implement cube merge and both routes; run only affected test files.
- [x] Typecheck shared/web, review diff, document UI contracts and integration, commit.
- [x] Remove generated build output, verify clean branch, report exact verification results.

## Follow-up: resolve lists for the unsaved draft pool

Goal: resolve uploaded/pasted names or passcodes into the client pool editor without saving a cube.

Design: extend `POST /api/cards/resolve` with exclusive `{listText:string}` mode. Reuse `prepareCubeListImport` for parser/catalog resolution, format normal card summaries and ordered `{id,copies,pool}` entries, and return `unknown`/`corrected`. Classify Extra Deck frames before returning entries. Retain the existing auth guard and card-fetch error wrapper; map parser errors to JSON 400. Preserve YDK first-appearance order and ydke main/extra/side order. No cube/draft service is invoked for this mode.

- [x] Write failing tests in `cards-resolve-list-route.test.ts` and parser section-order regressions; run those plus `cards-resolve-route.test.ts` with one worker on Node 22.
- [x] Extend the resolve route and fix deck-list entry order/error typing; rerun only the same three targeted files.
- [x] Document request/response, limits/errors, and the client occurrences-map handoff in `docs/api/cube-list-import.md`.
- [x] Review the change and typecheck web; clarify the saved-cube versus scratch-pool documentation.
- [x] Finish with generated-output cleanup, diff verification, and a local commit with the requested co-author; verify clean status without pushing.
