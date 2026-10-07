# Dev Sandbox on current main

Base: `origin/main` `0450da0dea61585bf1addcb0b7cdbba94c11f790` (2026-10-07).
Source: local `feat/dev-sandbox` `5e5600d53933344476c9cb2eaf58c0b89ea3213c`.
Target: `feat/dev-sandbox-main`, worktree `/home/sulman633/repos/yb-wt-sandbox`.

## Selection

`git log --no-merges origin/main..feat/dev-sandbox` and `git cherry origin/main feat/dev-sandbox`
identified the 58 sandbox commits below, plus 19 sandbox task-integration merges.
Every non-merge source commit is sandbox work. A direct merge retains all of those commits,
including v1, v2, access allowlisting, Set card behavior and their review fixes.
The sandbox paths are identical on `feat/dev-sandbox` and `test/engine-local`; there are no
later sandbox-only fixes to take from that test branch. Its merge-resolution changes were
reviewed separately. No engine-local, FFA column-core or field-wipe branch was merged.

## Main compatibility

Nine conflicts were resolved: `duel-server/src/host.ts`, `shared/src/services/duels.ts`,
web `app/api/duels/cards/route.ts`, `src/components/duel/api.ts`, `prompts.tsx`,
`src/components/layout/nav-list.tsx`, `shell-model.ts`, `src/lib/duel-host.ts` and `nav-items.ts`.
The stored resolution for `prompts.tsx` was inspected before use.

- Keep main's dice and RPS opening, seat movement and opening error handling.
  Sandbox start creates its worker directly and activates the compiled board. It does not
  call `beginGame` or `startOpening`; `startOpening` rejects sandbox rows.
- Retain main's card text fallback, artwork operations and diagnostic queue bypass.
- Retain room receive timestamps, including updates from sandbox controls.
- Keep Admin navigation and sandbox access separate. Guild admin status does not unlock Sandbox.
- Retain main's bundleVersion calculation and every core pin. No core or engine-data file changed.
- Update stale v1 tests for v2 phase selection, start-event order and main's explicit core
  capability metadata. Test doubles now return current card-search and room shapes.

Read-only review also found two sandbox UI faults: handing the acting seat back to a bot
kept an invalid acting-seat query, and FFA pile drops used the selected seat instead of the
destination seat. Each fix has a regression test that failed before the change.

## Verification

All commands use Node 22.23.3 and `prlimit --core=0`; only selected test files were run.

- Shared contracts/services, regular duels, dice/RPS and bot sandbox cleanup: 333 tests passed.
- Duel host/compiler/snapshot/real sandbox, presets and dice/RPS: 300 tests passed, none skipped.
  `DUEL_REQUIRE_CORES=1`, `NSEAT_LIVE=1` and the existing local core paths were supplied.
- Web sandbox, Admin navigation, card-info route, room API and dice/RPS: 621 tests passed.
- Shared, duel-server and web type checks passed.
- Shared, duel-server and web standalone builds passed.

## Local runtime

The web unit uses this worktree's `.next/standalone/packages/web/server.js` on port 3000.
The duel unit uses this worktree's `packages/duel-server/dist/server.js` on 127.0.0.1:4003.
Both use Node 22 and `LimitCORE=0`, with the existing environment files, database and engine data.
The developer ID is supplied only with `systemd-run -E`; no ID is stored in source or env files.
The bot and websocket containers are unchanged.

The sandbox schema migration creates `sandbox_scenarios`, its guild/update index and the
`duels.sandbox` column. It is idempotent and runs on the local database at service startup. The local database
already had the table and column before the restart.

## Exact source commits

```text
ace9e160 docs: dev sandbox design spec
ec2965be feat(shared): add sandbox board parser and limits
478eea2b feat(sandbox): add pure seat control helpers
069d3127 feat(web): sandbox builder state model with quick add, paste and fast clear
4d192ead feat(shared): add guild sandbox scenario storage
5d82f30e feat(sandbox): compile draw starts and multi-seat turn players
2e3c4091 feat(sandbox): validate runtime boards before engine start
88075432 feat(shared): isolate sandbox duel rows and persist setup
82dac70a fix: type connection route room as DuelRoom after sandbox merge
c07b6193 feat(web): sandbox builder client api and placement rules
b9864c83 feat(web): sandbox builder UI with quick add, zone slots and card popover
4424261c feat(web): add admin-only sandbox scenario and start APIs
54599cb5 feat(web): route sandbox seat and phase controls to the host
08845a3b feat(duel-server): add sandbox host start and restart operations
3f8c0fea fix(web): sandbox builder handles art that fails before hydration, larger slots
99ccb939 feat(web): admin-only Sandbox nav link with an access probe
979a243f feat(web): sandbox pages for list, new, edit, save as copy, share and play
a1be6c23 feat(sandbox): control seats and walk real engine phases
9cb83f2a fix(sandbox): preserve bot recovery outside phase stops
5f60c22f feat(sandbox): duel api passes the acting seat and reveal, adds sandbox control calls
0765610b feat(sandbox): in-duel sandbox bar in the 1v1 room and the table shells
a12b5887 fix(sandbox): center the bar and keep clear of the table tool rails
9391b58d fix(sandbox): share the web and host phase contract
318b3f9a fix(sandbox): pass empty phase hooks during normal play
a120f190 fix(sandbox): enforce archive and deletion retention
fd94de52 fix(sandbox): resume Practice bots after next turn
b013c47d fix(sandbox): search card choices as the Manual seat
37820a7f fix(sandbox): surrender the selected Manual seat
caab567a fix(sandbox): preserve engine setup after board parse errors
4b790dc8 fix(sandbox): focus quick-add search on mount
63c04a84 docs(sandbox): define v2 owner contract and file ownership
3d7dac74 feat(sandbox): add v2 board and portable share contracts
baf3cd00 fix(sandbox): accept every start phase in the duel-server BoardSpec
cbd4f703 feat(sandbox): in-duel Eliminate, Save state, Save & close and Close
ffa0ee86 feat(sandbox): model start phase and eliminated seats in the builder state
5f221df0 feat(sandbox): add the share code import and export dialog
e8c413ad feat(sandbox): start phase select, share codes, seat elimination and table view in the builder
8b46b537 test(sandbox): cover Import code on the scenario list
bcd8a60c feat(sandbox): add live state actions and require admin on duel routes
0bb9e80d feat(sandbox): capture raw engine state as validated boards
568d44f7 feat(sandbox): walk start phases and journal seat elimination
b406dd04 refactor(sandbox): export LpField and MONSTER_LABEL, tag slots with their place
feca38b0 feat(sandbox): table view that mimics the 3-way plaza and the 4-way grid
24ebef8d feat(sandbox): dispatch owner-only snapshot and close operations
cd8e4206 fix(sandbox): pass activeSeat to the table view and type the import test board
897fefd5 fix(sandbox): builder test table view mock reads activeSeat
e13d3c82 fix(sandbox): capture private snapshots through the worker
cdbbce91 fix(sandbox): return saved scenario details from the route
af41157a fix(sandbox): resume bots after start and elimination
488a99d0 fix(sandbox): keep the turn player in the duel
7c9c1063 test(sandbox): round-trip both shared extra monster zone pairs
9756cc9d fix(sandbox): select a living seat after elimination
b73dc19d fix(sandbox): reuse scenario ids for state saves
d75bb903 fix(sandbox): require admin access on remaining duel routes
13f22bc8 fix(sandbox): wire the table view In/Out toggle
80639531 fix(web): restrict sandbox access to listed developers
69f26968 fix(sandbox): cards put in a Spell & Trap Zone start Set; Face-up is disabled for Normal and Quick-Play Spells and Normal and Counter Traps
5e5600d5 test(duel-server): a Set Dark Hole from a sandbox board is face-down, activates and destroys; Set Quick-Play and Trap respond at once
```
