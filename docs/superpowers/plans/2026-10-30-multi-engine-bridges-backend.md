# Multi-engine Bridges Backend Implementation Plan

> **For agentic workers:** Execute these tasks sequentially in the approved shared worktree. The owner requires three backend commits, explicit staging paths, no UI edits, and integration checks rather than new unit tests.

**Goal:** Detect the open deck's engines, rank accepted next-engine links, and run bounded multi-source deep searches.

**Architecture:** Shared code owns weighted detection and deterministic ranking. The duel host owns graph access, review gates, deck points, and persistent jobs. Web routes validate bounded input and host output without loading the graph.

**Tech Stack:** TypeScript, Node 22, better-sqlite3, Next.js, existing Haiku judge workers, Vitest integration checks.

### Task 1: Shared detector (commit 1)

- [x] Add artifact-backed integration fixtures for Odion + Ashtra, Blue-Eyes, Snake-Eye, and Fiendsmith, plus threshold/folding/staple checks.
- [x] Implement shared weighted detection and expose it through the host-only bridge service.
- [x] Verify targeted integrations and shared compilation; commit detector paths and this plan.

### Task 2: Stored next-engine ranking and API (commit 2)

- [ ] Add shared ranking with grade/hub weights, directional links, coverage, target idf, and global access-path deduplication.
- [ ] Expose stored incoming rows, startup hub statistics, accepted-only projections, and the target lookup index.
- [ ] Add host `engines`, the bounded authenticated POST route, and the web library request function.
- [ ] Verify accepted/rejected/pending rows, open-deck detection, Genesys accounting, input/output validation, and hub control; update API documentation and commit explicit paths.

### Task 3: Multi-source deep jobs (commit 3)

- [ ] Add engines/deck selectors, deck-independent multi keys, subscriber context, and fresh single-source reuse.
- [ ] Add reverse scans and deterministic top-eight shortlist; review top down until six engines or twelve new pair reviews, with cached reviews free.
- [ ] Project at most six suggestions from currently accepted display pairs and preserve single-source results.
- [ ] Verify cache sharing, hourly admission, review budget, stop rules, reverse scanning, and subscriber-specific points; benchmark one through four sources.
- [ ] Update API docs, run touched-code checks, review the diff, commit explicit paths, and remove only build output created by this task.
