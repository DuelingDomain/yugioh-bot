# Local ready PR review implementation plan

**Goal:** Put the twelve ready PRs on local :3000 and give the owner repeatable sandbox URLs.

**Architecture:** Keep changes on test/local-main. Restore the existing sandbox against current Clerk, fork and timer contracts. Build into an independent engine data copy and sync the standalone web bundle to web-live.

**Stack:** Node 22, TypeScript, Next.js, SQLite, pinned Emscripten multiplayer cores, systemd user services.

- [x] Fetch origin and merge only PRs #452–458 and #460–464. Never push main; this local branch tracks origin/main.
- [x] Combine Damage Step and sort replay changes as host rule version 9. Combine LP manifests/docs and verify generator count 408.
- [x] Restore sandbox source from feat/dev-sandbox-main, adapting current user IDs, signed transport, fork controls and decision clocks.
- [x] Add idempotent owner fixtures in scripts/local-ready-pr-scenarios.ts, preserving scenarios 1–4. Seed 14 scenarios; document actual IDs and manual timer steps.
- [x] Rebuild multi and multi-domain cores; record and check all 80 native golden rows. Install cores and overlays under local data/engine-local-ready.
- [x] Run real-engine PR regressions and start every fixture. Check sandbox, identity, fork and web controls. Review merge changes and fix findings with regressions.
- [x] Build shared, duel-server, ws and final web; sync standalone output to web-live; restart the three local services.
- [x] Verify :3000, saved URLs, a live service duel start and clean new service logs. Delete engine .build trees and unused local web build output.
- [x] Commit sandbox and fixture work locally and report URLs, conflict fixes, checks and any limits.
