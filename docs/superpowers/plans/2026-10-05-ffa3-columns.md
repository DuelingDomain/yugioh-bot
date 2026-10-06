# FFA3 columns implementation plan

**Goal:** Apply the owner's 2026-10-05 column rule, R-FFA-THREE-COLUMNS.

**Architecture:** Add column_peer_of independently of across_of. With three living FFA3 seats, only an activated effect's chosen opponent is a column peer. With two living seats, each is the other's peer in all column callbacks. Keep the existing opponent probe and prompt protocol. Extend Lua geometry guards only for columns. Keep each card overlay's stock hash.

**Tech stack:** C++ patch series, Lua overlays, TypeScript live scenarios, local Emscripten builds.

- [x] Add live scenarios for both opponent choices, own-field non-activated columns, and all surviving seat pairs. Prove the new cases fail with main's core.
- [x] Add a new core patch; do not edit EMZ/Link geometry or the concurrent hand-trigger patches.
- [x] Update column Lua guards and stock-hash entries where required. Test the named official cards.
- [x] Build both multi cores locally. Run new tests and existing shared-zone, local-zone, EMZ/Link and 1v1 tests. Run overlay hash checks and typecheck.
- [x] Update ADR, coverage and UI handoff notes. Record commands and before/after counts.
- [x] Commit each logical change with the required trailers. Remove build trees and temporary data. No push, PR or merge.
