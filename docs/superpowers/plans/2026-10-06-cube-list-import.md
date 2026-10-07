# Cube list import implementation plan

Goal: owners can add name/passcode lists to a cube or create a populated cube in one request.

Design: a pure web parser reuses `parseDeckText` for YDK/ydke, retaining the original text for diagnostics. The shared catalog resolves normalized exact names first, batches missing exact names with YGOPRODeck's `name` parameter, then uses conservative unique edit-distance matches. Resolved entries are merged by a synchronous shared cube transaction; network work finishes before cube writes. Catalog cache warming is independent of cube writes, as in existing imports.

Contracts: editor `{op:"importList",text}` returns existing `{pools,cards}` plus `{added,copies,unknown,corrected}`. Creation accepts `{name,importText,draftType?}` (optionally `kind:"list"` or `"blank"`) and returns `{cube,added,copies,unknown,corrected}` with 201. Reject combining import text with archetype/pool/config options. Zero resolved cards returns 400 and creates nothing. Limits: 64 Ki characters, 1000 distinct input identities, 99 copies per card.

Execution is inline in the supplied worktree, with focused TDD and small commits.

- [ ] Write failing parser and catalog tests, including a trimmed real fixture.
- [ ] Implement parser and catalog resolution; build shared, run those files, commit.
- [ ] Write failing transactional cube merge and API tests (authorization, limits, failures, zero results, duplicate names).
- [ ] Implement cube merge and both routes; run only affected test files.
- [ ] Typecheck shared/web, review diff, document UI contracts and integration, commit.
- [ ] Remove generated build output, verify clean branch, report exact verification results.
