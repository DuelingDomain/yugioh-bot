# Pre-release cards in cubes and drafts

Owner brief is the accepted design. Use the bundled engine database read-only; keep YGOPRODeck authoritative when available. Do not change engine pins or add unit tests.

- [x] Add a cached engine metadata reader with type, stats, race, setcodes and mapped archetype names. Store provenance and pre-release status in the catalog.
- [x] Resolve engine cards through passcode, fuzzy search, exact name and list imports. Preserve alternate artwork handling and API data.
- [x] Keep weekly API upserts authoritative. Remap cube and draft references at graduation; refresh copied metadata and image URLs without duplicates.
- [x] Enable full Ignis art for missing crops. Add small dark pre-release labels to cube results, cube cards and deck browsing.
- [x] Prove with a real SQLite file and engine CDB integration test, targeted regression tests, touched-package TypeScript checks, and isolated Playwright tests at the three requested sizes.
- [ ] Review, commit with owner trailer, push, open PR, watch CI, stop owned processes and remove build caches. Do not merge.
