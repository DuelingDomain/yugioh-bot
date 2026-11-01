# Remote effect origins implementation plan

**Goal:** Track public effect sources and private Set/search candidates without exposing decks or choices to other seats.

**Architecture:** Resolve card metadata and existing effect-search tags on the server. Shared pure remote logic derives filters, tracks origins, consumes the next face-down placement, and validates later reveals assistively. Explicit viewer projections cover HTTP, replay, event history, undo, lists and WS; WS sends private snapshots directly to authenticated sockets.

**Tech stack:** TypeScript, SQLite, Zod, React, Socket.IO, Vitest, Playwright.

- [x] Add failing cases to existing remote integration tests: real Set/search filters, depletion, private choices, reveal notes, ownership and every projection.
- [x] Add shared effect filter/tracking/projection modules, action schemas and replay inputs. Reuse `createInsightCatalog`, effect tags and `filterReachesCard`; conservative card-text fallback where tags are missing.
- [x] Integrate authenticated service and WS projections, including snapshots sent by internal HTTP; verify no private payload reaches room broadcasts.
- [x] Add small UI controls for Activate, Set, private candidate picks, hand announcement and dismissible notes; connect voice activation and feed selections.
- [x] Extend existing e2e spec with a focused origin/pick/reveal flow. Run targeted tests, builds and typechecks using Node 22 and allowed isolated ports only.
- [x] Document contract and five real-card sample candidate lists; complete code review.

**Publication:** Commit in small chunks and push `feat/remote-facedown` without a PR or attribution lines.

The coordinator supplied the detailed feature design and authorized implementation through push. Work is isolated in `.worktrees/remote-facedown`; the main checkout and reserved ports remain untouched.
