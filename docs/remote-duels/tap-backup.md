# Tap backup

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
