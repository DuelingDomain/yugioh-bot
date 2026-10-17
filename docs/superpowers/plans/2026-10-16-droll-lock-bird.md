# Droll & Lock Bird verification plan

**Goal:** Allow Droll & Lock Bird in FFA only after real engine scenarios prove its multiplayer behavior.

**Architecture:** Use the existing scenario board compiler, Session actions, real card scripts, and Standard and Domain multi cores. Keep the existing event-bit patch unless a scenario proves a small defect. Follow ADR-0002 R-COMMON-EACH-PLAYER and R-TAG-PARTNER.

- [x] Test every searcher/holder seat pair in FFA3, FFA4 and Tag on both cores.
- [x] Test Deck searches and draws for every seat under the resolved lock, and its End Phase reset.
- [x] Test Draw Phase searches and draws for every seat. The official card text has no once-per-turn limit; prove repeated use instead of adding one.
- [x] Test activation and the lock after elimination in both FFA layouts.
- [ ] If all checks pass, remove the FFA ban, update catalog expectations and documentation, and check the deck-check path for Tag and the web UI.
- [ ] Run only the relevant scenario/catalog tests and the duel-server, shared and web typechecks. Commit small changes with the requested co-author. Do not push.

Use Node 22.23.3. The private data copy is `/tmp/droll-engine`; only its manifest wrapper hash differs from the source bundle. No service or shared data changes are part of this task.
