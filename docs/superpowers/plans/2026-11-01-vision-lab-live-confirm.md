# Vision lab live confirmation implementation plan

**Goal:** Save owner confirmations by default and inspect live-camera cards in a readable, immediate popup.

**Authorization:** The owner supplied the design and requested completion, small commits and a branch push. Execute inline in this existing worktree; no approval pauses, PR, port 3000 or port 3417 changes. Node 22; targeted tests in existing test files only.

**Architecture:** Resolve admin status from the existing server owner policy. Default an unanswered admin preference on, preserve explicit opt-out, and atomically approve their samples at ingestion. Keep regular-user consent and global collection switch. Reuse the camera ring buffer and worker sharpness ranking, selecting one frame for live reads. Return its detected quad for a transient gold outline. Open the popup before recognition, load catalog details through the existing card resolver, and display full image/text/stats with confirm and uncertain alternatives. Keep frozen/photo interactions and local export.

**Files:** Shared feedback service; feedback API and settings component; vision types/options/pipeline; lab component, focused result component and styles; existing shared feedback, route, pipeline and lab tests; feedback runbook and browser smoke script.

- [x] Extend shared and API tests for trusted admin defaults, explicit opt-out, immediate approval, deduplication and regular-user isolation. Observe failures, implement, build shared, rerun targeted checks and commit.
- [x] Extend existing pipeline tests for single sharpest-frame selection and returned detected outline. Observe failures, implement and run pipeline/vision tests.
- [x] Extend existing lab tests for immediate skeleton, live preview/outline, full detail popup, top-1 confirm, admin toggle and stale request cleanup. Observe failures, implement accessible responsive popup and targeted checks; commit.
- [x] Update runbook, privacy wording where needed and browser smoke. Run affected tests, typechecks and an isolated browser check if available. Review changes, commit and push branch; verify remote head and report coordinator restart requirements.

Verification: 82 targeted cases pass (10 shared feedback, 28 vision pipeline/client/board, 44 web lab/admin-route). Shared build and vision/web typechecks pass. Real Chromium/WASM synthetic-camera smoke passes: owner default-on without prompt, one 13,287-byte crop, immediate approval, pause toggle, live outline/advancing video, desktop/mobile popup, moderation and deletion, zero page errors. The isolated port 3448 server was stopped by PID; generated Next references were restored. No physical webcam accuracy claim. Review found and resolved two preference races, with regressions in the existing lab test file.
