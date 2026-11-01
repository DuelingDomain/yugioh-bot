# Remote Deck choice publicity implementation plan

**Goal:** Apply the owner's approved change: Cards Set from Deck are shown to all by default, with the same rule for searches to hand and a strict private opt-out.

**Architecture:** Add a boolean table option, persist it additively, and replay it through lifecycle events. Publish only a selected or ref-linked recognized identity, retaining face-down presentation and controller-only candidates. Preserve the existing strict-table path and assistive mismatch notes.

**Tech stack:** TypeScript, SQLite, Zod, React, Socket.IO, Vitest, Playwright.

The owner supplied the design and authorized implementation, small commits and push without a PR. Continue inline in the existing worktree; no additional approval gate is needed.

- [x] Add failing migration/default/configuration cases to the existing remote integration file; implement persistence, validation and replay. Commit.
- [x] Add failing public/strict choice and recognition cases, including hand searches, candidate privacy, undo/replay and copy depletion. Implement chosen-identity publication without flipping the physical Set. Commit.
- [x] Extend existing browser tests for both modes and create/lobby controls; implement labels, guidance and API wiring. Verify on isolated allowed ports. Commit.
- [x] Update the contract, preserve five real-card examples and sample deck, run relevant tests/build/typechecks, review, remove generated output, commit and push.


Review follow-up: restrict publication to the touched origin; preserve pre-option event semantics during replay without rewriting old rows/events; keep Deck/Extra Deck current identities private; preserve distinct same-name searched copies. Legacy snapshots, announcements and observation behavior have regression coverage and were compared with the original reducer implementation.
