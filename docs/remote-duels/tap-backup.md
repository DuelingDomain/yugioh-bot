# Tap backup: stacks, tokens and sleeved Sets

15 November 2026 extension, `feat/remote-tap-backup` / PR #612. Work is uncommitted for the orchestrator. Logic, state and tests only; existing popup, picker, token controls and button styles are reused. No vision-package, recording-pipeline, training, deployment or PR changes.

## Actions and decisions

- Tap an own playable field zone, occupied or empty, or its **Changed here** badge, to open zone actions. Piles retain their existing pile viewer. Opponent zones retain their existing inspection/attack behavior.
- **Put a card on top** uses My deck / Recent reads / Search and the existing physical-copy choice. After selection, choose **Summon using the card(s) here as material** or **Replace (old card to GY)**. The current card is selected as material; other own field monsters can be selected too. Xyz uses `twin.place.summon` and the existing `materials` / `materialOf` relation, carrying an older Xyz's materials through a rank-up. Synchro, Fusion and Link materials go to GY under the existing rules. No second stack model was added.
- **Detach material to GY / banished** uses `twin.detach`. Targeted Undo uses the existing history and conflict checks.
- **Add token** opens the existing token dialog: generic or catalog token, Attack/Defense and a free Main Monster Zone. An empty tapped Main Monster Zone is preselected. From another zone, choose a free Main Monster Zone. Extra Monster Zones remain excluded by the existing server contract. Tokens have `token` stats/art, never a guessed physical-card identity.
- **Set a card here** on an empty Main Monster or Spell/Trap Zone creates a nameless face-down twin (Defense in a Monster Zone). On an occupied zone it Sets that same card; an already public identity follows the existing server rules. **Flip** opens the picker and sends one `twin.flip` with the chosen identity, preserving the ref. Naming before flipping would lose the identity under the existing hidden-card contract.
- Opening a menu, selecting a candidate or closing a menu does not write board state. Commands reserve manual holds before entering the room queue. Stale occupants/copies are rechecked in the transaction. A summon and a flip are single server actions. Replace is two existing actions (old card to GY, then top placement); a partial failure explicitly directs the player to the dock's Undo before retrying. This is not an atomic replacement transaction.

## Changed here lifecycle

`src/lib/remote/changed-zones.ts` consumes the existing watcher tracks, never detector frames. A confirmed occupied cell gets one local episode after **1.2 seconds** of resting unresolved evidence: another outline, a candidate/blank read, a Best match, a waiting weak-back decision, a face mismatch or a name mismatch. Track-ID churn does not restart an episode. A temporary occlusion retains an already shown cue. A matching known resting state, a cleared board cell or a manual hold clears it. Opening the menu alone does not count as a correction.

The badge has the accessible label “Changed here: <zone>” and opens the same zone actions. It does not pause the watcher or place a guessed card. Resting uncertain prompts on confirmed occupied cells use this cue; the existing prompts remain for empty cells and evidence without a resting observation. A resting Best match cannot overwrite an occupied confirmed cell. Sure camera placements keep their existing path and timing gates.

Holds now cover an action's top ref, selected material refs, carried materials and cells together. A covered source track's removal cannot release the top's hold. The hold survives reload and blocks stale identity, removal and placement writes at the queue boundary. Undo adopts a restored field ref. Existing physical-departure / sustained-pose-change release remains; a hidden material has no independent visible departure proof, so its protection follows the stack's top until another manual action or physical release.

## Designer handoff

All paths below are under `packages/web/src/`.

| Screen / state to style | Component paths |
| --- | --- |
| Own field: occupied, empty, nameless Set, token, materials; one Changed here badge; badge keyboard focus; cue cleared / camera disabled | `components/remote/field-watcher-ui.tsx`, `components/remote/ui/holo-field.tsx`, `components/remote/ui/seat-panel.tsx` |
| Zone actions: occupied / empty, Set / Flip, token, material list with both destinations; saving and refusal text | `components/remote/ui/zone-actions.tsx`, mounted by `components/remote/ui/table.tsx` |
| Card selection: deck / recent / search, no results, physical-copy choice, forced face-up for top/Flip, stale target | `components/remote/ui/zone-card-picker.tsx` |
| Top-card decision: selected name, material checkboxes, Xyz carry vs materials to GY, summon unavailable, replace, saving, partial failure, changed zone, Back / Close | `components/remote/ui/zone-actions.tsx` |
| Tokens: generic stats / named token search, chosen art, zone / position, all zones full; existing token move / remove | `components/remote/ui/token-ui.tsx` |
| Flip: nameless/private Set to picker to public named card; privacy and unchanged ref | `components/remote/ui/zone-actions.tsx`, `components/remote/ui/zone-card-picker.tsx`, `components/remote/ui/holo-field.tsx` |
| Existing detail sheet, materials, targeted Undo and departures after replacing | `components/remote/ui/card-view.tsx`, `components/remote/ui/recent-departures.tsx`, `components/remote/ui/dock.tsx` |

Review these states on desktop and phone, with the software keyboard, tilted field, touch scrolling, focus return and long material names. No visual/device review is claimed for this extension. The paired camera-only phone page remains unchanged; these actions live on the full duel page.

## Verification and replay receipt

**Ran:** Node `v22.23.4`, the three requested Vitest files with `--maxWorkers=1`: **266/266 pass** (27 tap-backup, 123 vision-lab, 116 remote-recognition). Before edits, the same three files passed **255/255**. The new covered-card/removal/stale-name race fails against the original HEAD hold implementation and passes with the final implementation. Token tests exercise both generic and catalog choices, zone and position; watcher integration exercises cue-to-action routing, hold clearing, no Best-match overwrite and normal placement elsewhere. `git diff --check` passes.

**Ran, fails:** `npm run typecheck --workspace=packages/web`, with eight diagnostics reproduced on the untouched baseline before implementation. No new diagnostic remains. The file `table.tsx` is edited, but each failing expression is unchanged; `use-remote-room.ts` is entirely unchanged. Installed shared declarations omit the voice fields that shared source declares. Shared build output was not changed.

| Current file under `packages/web/src/components/remote/ui/` | Diagnostic | Baseline status |
| --- | --- | --- |
| `table.tsx:127:129` | TS2339: `RemoteRoom.voiceEnabled` missing | unchanged expression |
| `table.tsx:156:33` | TS2339: `RemoteRoom.voiceEnabled` missing | unchanged expression |
| `table.tsx:1028:68` | TS2339: `RemoteRoom.voiceDiagnosticsEnabled` missing | unchanged expression |
| `table.tsx:1110:18` | TS2339: `RemoteRoom.voiceDiagnosticsEnabled` missing | unchanged expression |
| `table.tsx:1561:152` | TS2339: `RemoteRoom.voiceDiagnosticsEnabled` missing | unchanged expression |
| `use-remote-room.ts:95:237` | TS2353: object member `voiceEnabled` unknown | unchanged file |
| `use-remote-room.ts:95:259` | TS2339: `RemoteRoom.voiceEnabled` missing | unchanged file |
| `use-remote-room.ts:95:306` | TS2339: `RemoteRoom.voiceDiagnosticsEnabled` missing | unchanged file |

The initial new popup test-ID errors and a missing timestamp in a test's camera stamp were fixed; they are absent from the final check. A cold targeted watcher test hit its five-second timeout on this loaded Mac; its integration timeout now includes cold module loading and the 1.2-second cue wait. The full final run passes.

**Reverted approaches:** broad occupied-zone prompt suppression hid existing questions without resting evidence, so routing is now limited to resting evidence (or an already shown cue). The initial name-then-flip sequence failed to name a nameless Set and was replaced by the server's existing atomic reveal. No vision candidate was tried or retained.

**Files changed:** this document; under `packages/web/src/components/remote/`, `field-watcher.tsx`, `field-watcher-ui.tsx`, `ui/table.tsx`, `ui/zone-card-picker.tsx`, `ui/zone-placement.ts`, new `ui/zone-actions.tsx`; under `packages/web/src/lib/remote/`, `manual-corrections.ts`, `manual-moves.ts`, new `changed-zones.ts`; under `packages/web/tests/`, `tap-backup.test.tsx`, `vision-lab.test.tsx`, `remote-recognition.test.ts`. No CSS file changed.

 Evidence and replay scripts stay only in ignored `data/replay/tap-stacks-20261115/`; clips and labels are read from the supplied local evaluation folders. The harness uses a `git archive` snapshot of **343e98570**, not this branch's older vision source. All eleven recorded source digests match the supplied `final2` build. At most two replay lanes and one inference thread per lane run.

**Ran:** all **15 baseline clips**, zero watcher errors. Inputs, frozen labels and all **55 placement payloads and times** (39 v2, 16 v3) exactly match the supplied `final2` run. The before column below is the requested **343e98570** snapshot. This branch's vision predates that snapshot; the table is not a measurement of this branch's camera behavior.

| Clip set | Before: original on time / late / missed (ran) | Before: corrected on time / late / missed (ran) | Questions | Placement median, original / corrected (s) | After this tap work |
| --- | --- | --- | --- | --- | --- |
| v2, 10 clips | 26 / 3 / 36 | 27 / 5 / 37 | 4 | 0.663 / 0.678 | Not measured by clip harness; manual behavior tested separately |
| v3, 5 clips | 2 / 2 / 35 | Same field/action score; no corrected variant | 5 | 3.157 / same | Not measured by clip harness; manual behavior tested separately |

Original v2 scores 71 labels; corrected v2 scores 70 after the censored exclusion. Original v2 has three wrong-name outcomes from old pile-top names; the corrected scorer has none. **Carried safety review, with exact placement parity verified now:** non-card phantoms 0 / 0, hand/search/Extra-preview placements 0 / 3, real wrong names 0 / 0 (v2 / v3). No fresh frame classification is claimed. **Ran:** v2 establishes eight of twelve labelled sources and clears all eight, leaving zero stale registered sources; the four unestablished sources are excluded. V3 source clearance remains unmeasured. V3's 15 held observations remain misses and do not authorize field placement.

The after-tap clip metrics are **not inferred to be unchanged**. The offline observer omits the changed React boundary, so replaying it as an “after” build would not prove these actions. Real-camera, network and phone outcomes remain unmeasured. The keep rule was conditional on editing `packages/vision`, which this task does not do.

Reproduction commands (all replay outputs are ignored):

```sh
export PATH=/Users/imranqureshi/.nvm/versions/node/v22.23.4/bin:$PATH
node data/replay/tap-stacks-20261115/scripts/sim-l-pair.mjs baseline
node data/replay/tap-stacks-20261115/scripts/fable-corrected-score.mjs data/replay/tap-stacks-20261115/baseline-v2
python3 data/replay/tap-stacks-20261115/scripts/tap-baseline-report.py
node node_modules/vitest/vitest.mjs run packages/web/tests/tap-backup.test.tsx packages/web/tests/vision-lab.test.tsx packages/web/tests/remote-recognition.test.ts -c packages/web/vitest.config.ts --maxWorkers=1
npm run typecheck --workspace=packages/web
```

Use a fresh stage name if replaying again; do not overwrite the retained receipt. Original and corrected scoring preserve the labels. Corrected v2 reserves exact matches before the greedy scorer, excludes the 0.4-second censored label and separates stale pile names from real wrong names. No corrected-v3 conflict variant was supplied.

The offline observer models watcher events and board glue. It does **not** run React, manual taps, `ZoneActions`, the Changed here lifecycle or this room queue. Its camera scores cannot measure success of these manual actions or certify their phantom/hand rates. `packages/vision` is untouched, so the task's replay keep gate is not invoked.

---

# Earlier tap-backup handoff (historical)

Task K, 14 November 2026. Worktree `yugioh-bot-vision-tap`, branch `feat/remote-tap-backup`, base `063cf7aa5`. Read `data/replay/recon-seamless.md` first.

## What changed

1. Manual place, name, move, flip, battle position and remove reserve one correction per ref before waiting for the room queue. Every automatic write checks it again before posting and on watcher retries. Removal keeps a tombstone, including against a new outline in the same cell. Successful placements adopt the server's canonical ref. Failed writes restore the prior hold.
2. Tap an empty own field cell to open My deck / Recent reads / Search. Selection targets that cell, with ownership, game state, occupancy, Trap Monster and shared Extra Monster checks inside the transaction. A Reading placeholder keeps its ref. Existing identical copies require an origin choice; another physical copy uses the existing server copy rules. Face-down choices keep the existing owner-only identity projection. Recent reads stay local to the owner.
3. The existing card sheet adds Field, Deck and Extra Deck destinations and an Xyz attach selector. Existing remove, face, battle-position and detach controls remain. Attach offers field monsters and eligible recent departures under the existing server contract. Arbitrary hand, pile and Spell materials are not added.
4. Recent departures lists six distinct refs from the room event history. Each has destination buttons and targeted Undo after the five-second toast. Conflicting Undo stays disabled with the server reason.
5. Watcher prompts also appear on their own zone, with Confirm / Wrong card / Not a card. Later collapses the dock prompt while keeping an unresolved badge and a reopenable list. Silence never confirms. Wrong card opens the same picker and preserves a Set's private face by default.
6. A watcher `reading` event publishes the local Reading cue before entering the mutation queue. Evidence changes clear it; correction holds suppress it in cleared cells. Existing detector, rest, positive-back and simultaneous-copy admission rules are unchanged.

The picker uses the existing popup/layer controls, tokens and buttons. Phone choices and card actions have 44 px touch targets. My field remains reachable from the bottom dock. No public page changed.

## Hold release

Session storage is scoped to guild, table, seated account, game and seat. Reload restores refs, cell reservations and the last physical pose; no card names or images are stored there. If storage is blocked, holds remain in memory.

A hold ends when a tracked physical departure is reported, or the physical cell/face/position changes and rests for two seconds. A later manual choice replaces that ref's hold and any old tombstone in the chosen cell. There is no time-based expiry. Camera off, hidden/occluded tracks, HTTP completion and reload do not release a hold. A hold made without a resting observation first adopts fresh resting evidence. Scan field also respects these holds.

This is browser-tab arbitration, not a server or cross-device lock. An object replaced off-camera in exactly the same pose cannot be distinguished by this layer; another manual action replaces the old choice.

## Files

Under `packages/web/src/components/remote/`:

- `field-watcher.tsx`, `field-watcher-ui.tsx`, `field-watcher-ui.module.css`: queue guards, physical evidence, local cues and zone prompts.
- `ui/table.tsx`, `ui/holo-field.tsx`, `ui/seat-panel.tsx`, `ui/use-layers.ts`: picker and field access.
- New `ui/zone-card-picker.tsx`, `ui/zone-placement.ts`, `ui/recent-departures.tsx`.
- `ui/card-view.tsx`, `ui/remote-ui.module.css`: actions and existing-token touch layout.

Under `packages/web/src/lib/remote/`: new `manual-corrections.ts`, `recent-reads.ts`; updated `manual-moves.ts`, `room-mutations.ts`.

Tests: new `packages/web/tests/tap-backup.test.tsx`, `tap-room-fixture.ts`; updated `vision-lab.test.tsx`, `remote-recognition.test.ts`. The old queue-only fixture now supplies a real room. No watcher or shared-package files changed.

## Verification

Node `v22.23.4`. Only the three affected web test files ran, with one Vitest worker.

```sh
export PATH=/Users/imranqureshi/.nvm/versions/node/v22.23.4/bin:$PATH
npx vitest run packages/web/tests/tap-backup.test.tsx packages/web/tests/vision-lab.test.tsx packages/web/tests/remote-recognition.test.ts -c packages/web/vitest.config.ts --maxWorkers=1
npm run typecheck --workspace=packages/web
```

The deterministic correction replay uses the real room queue and shared reducer: six correction kinds plus a queued-camera/manual-click race. With the original HEAD queue, **0/7** scenarios pass; with this change, **7/7** pass. The original queue lets the earlier removal delete the card before the manual move (Unknown twin card). It also posts old observations after manual edits. Temporary baseline source was restored before the final checks.

The focused tests cover reload/release, failed writes, replacement tombstones, two witnessed identical copies, canonical hand refs, exact cells, hidden identity, picker choices, actions, several departures, ignored uncertainty and Reading before HTTP / after manual removal.

Final results: **139/139** UI/watcher tests pass (17 tap-backup, 122 vision-lab). The combined three-file run has **254 passing / 1 failing** out of 255. The sole failure is the unchanged recognition/voice test `parses activation with a named source and activation after identifying a card`: the installed dependencies lack `double-metaphone`.

The requested web typecheck ran and fails with **9 existing diagnostics**, also reproduced with the original HEAD table source: eight missing `voiceEnabled` / `voiceDiagnosticsEnabled` members across `ui/table.tsx` and `ui/use-remote-room.ts`, plus the missing `double-metaphone` import in `ui/voice/speech-matcher.ts`. Shared source declares the voice fields but the installed `packages/shared/dist/remote/types.d.ts` does not. No new diagnostics remain. Shared build output and dependency installation were left outside this task's file boundary. `git diff --check` passes.

## Clip replay and limits

The supplied corrected clip baseline is **19 on time, 3 late, 36 missed, 42 placements, 7 presence prompts; median 1.06 s, p95 5.62 s**, over 64 labels. It is carried from the task handoff, not measured here.

**After: not measured.** The existing `sim-v2x-observer.mjs` models watcher events, departures and summons, but omits this React mutation queue, manual taps and UI. Its build sources also select other worktrees. Re-running it unchanged would not measure Task K. No replay process, inference run, download, training, clip copy or evaluation-data write was performed. No claim about a changed clip phantom rate is made. The new guards only suppress automatic writes; they add no automatic admission path.

All six web paths are built. Remaining work: designer review of density and zone-panel placement; real-camera and phone checks with the software keyboard, camera restart, several removals, stacks and two identical cards. The separate watcher work still owns contact stalls, inference misses and Best match policy. The paired camera-only phone page is unchanged; these controls are on the full duel page.

## Design pass

Visual and interaction polish only; no behaviour changed.

- **Zone card picker.** One flex column with `My deck`, `Recent reads` and `Search` tabs in the `.seg` look (arrow keys move between tabs). Rows are 40 px, 44 px on touch. On desktop it opens beside the tapped cell; under 900 px it is a bottom sheet (max 62% of the viewport height) with a Close button. The which-copy question reads "<name> is already on your side. Which copy?".
- **On-zone check prompt.** The in-cell panel was clipped by the seat and skewed by the table tilt, so it is now a small gold "?" badge on the cell (22 px with a larger hit area on touch) that opens a fixed panel under or over the cell: "Is this <name>?" with Confirm, Wrong card, Not a card. Escape or an outside tap closes it and returns focus to the badge. The docked prompt buttons (Wrong card, Not a card, Later) share one row and are 44 px on touch.
- **Recent departures.** Chevron summary, grouped rows, 44 px buttons on touch.
- **Card sheet on phones.** The art sits beside the name so Move to, Activate and the Attach control are reachable without scrolling past a large image.
- **Checked** at 1366x768 and 390x844 (touch): no horizontal scroll, touch targets 44 px. Screenshots are kept locally in `data/replay/design/` (gitignored).
- **Not checked.** Prompts on real tilted 25 px cells with a live camera, the Reading cue on a live feed, the phone software keyboard on the Search tab, and the card-sheet Attach selector in a live room.
