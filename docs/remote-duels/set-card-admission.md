# Set card admission

Field Sets now require positive back evidence before the watcher publishes a placement. This applies to M1–M5, S1–S5, EMZ and FIELD, including a new face-down flip. Deck/Extra stack observations and public piles keep their existing rules. The detector and identity reader are unchanged.

## Evidence and timing

The existing 600 ms back timeout used to promote **unknown** pixels to **down**. That bypassed identity recognition and placed a Set. The timeout now asks **Card here?** with **Set card** and **Not a card**. Nothing is placed by that question, including the provisional Reading placeholder for an unsupported back. A click uses the normal placement/flip, zone, occupancy and stale-evidence checks. The camera's front identification path remains available.

A clean back is positive when one of these holds:

- `classifyFaceState(crop)` **without detector hints** says down with confidence at least .8, and inner-crop RGB RMS variation is at most **40/255**; or
- the interior is nearly uniform (**RMS ≤8/255**), its median colour differs from the surrounding mat ring by at least **.08** mean RGB, and the pixel verdict is not up; or
- its crop matches a back already accepted in this duel: distance at most **.035**.

The tighter uniform rule admits the retained real red-sleeve crop (about 1.8/255 variation) where the classifier abstains. Eight is a conservative near-uniform proxy (about 3% RGB variation), not an operating point validated on unseen cameras. Its mat-boundary requirement rejects the same crop evidence with no contrast against the mat.

The colour signature samples 12×16 RGB points from the inner 80% of the existing portrait-ordered crop. Distance is the smaller mean absolute difference of centred RGB values at 0°/180°, plus half the mean channel-colour difference. A known back wins over the variation cap, allowing printed/patterned sleeves. Only an automatically admitted positive back or a successfully saved **Set card** choice teaches the session's back references (at most 32). Detector confidence alone never supplies positive evidence. No extra detector or identity-recognizer passes are made; the added work is fixed-size crop sampling and pixel classification.

Positive backs retain the existing two clean samples over 60 ms at detector confidence ≥ .7, or three over 120 ms otherwise, **plus the existing rest/plane checks**. No new wait is added. The deterministic 50 ms sample test commits at 100 ms after first sight with checks on and off. This is watcher timing, not camera-to-browser latency.

An unsupported back asks after **600 ms of clean, resting observations** (700 ms after first sight in the 100 ms sample test). Motion, occlusion, misses and pauses reset that waiting window. With no answer it remains a question, even through detector misses; it does not create a twin, reserve a public slot or produce a second question for the same spot.

## Rejection and setup

**Not a card** remembers the quad in mat coordinates. A region matches at IoU ≥ **.45**, or centre distance ≤ **.02** mat units, tolerating small shake. Scan field does not erase this choice. The controlled face-down field card's existing correction popup also offers **Not a card**, removing the twin and remembering the same region. The watcher can fall back to the saved physical zone when no live quad exists.

A rejected region is released only after full detector scans show no overlapping object for at least **500 ms**, with no hand, moving shadow or blur, and a different positively evidenced back or front arrives. Different means signature distance **> .08**. The same object returning stays ignored. Scan field also applies positive evidence before exposing a back as a flip witness; it cannot bypass admission. The regions and sleeve signatures survive watcher/backend restarts and reloads in owner-local `sessionStorage`, scoped to seat, duel and camera; another duel/camera has its own memory. Signatures are never sent to other players or the recording diagnostics.

The first full scan retains its decoded boxes, including weak boxes. A box from that setup scan which reaches the resting decision without positive back evidence is ignored without a prompt. Positive backs and identified fronts still bootstrap. A successfully admitted card is no longer considered a setup object on a later flip. This is evidence-gated setup handling, not a mask of every startup card.

## Tester switches

Own camera **Settings → Set card checks** contains four saved browser switches, all ON by default. They apply to the running watcher:

| Layer | Setting | Query override | Build env override |
| --- | --- | --- | --- |
| A | Require back evidence | `setPositiveBack=0` | `NEXT_PUBLIC_FIELD_SET_POSITIVE_BACK=0` |
| B | Ask about uncertain Sets | `setPrompt=0` | `NEXT_PUBLIC_FIELD_SET_PROMPT=0` |
| C | Remember Not a card | `setIgnore=0` | `NEXT_PUBLIC_FIELD_SET_IGNORE=0` |
| D | Ignore setup objects | `setStartup=0` | `NEXT_PUBLIC_FIELD_SET_STARTUP=0` |

Use `1` to force ON. Query overrides take precedence over env and saved settings. A controls admission; B and D operate while A holds an unsupported Set. B OFF holds it without asking. C OFF disables region suppression. D OFF makes setup objects eligible for the question, including a previously ignored setup sleeve; explicit player rejections remain. All four OFF restore the previous admission behavior, including both reproduced phantom commits and their 600 ms timeout. These are comparison controls, not game rules.

## Evidence and limits

The supplied evaluation used ten one-minute YouTube clips, **two confirmed phantom episodes**, and agent-made labels. It used an adapted reference bank and an offline board sink, not the owner's camera or live app. The phone scored .824 in M3 (cell share .182873); the calculator scored .536 in FIELD. Both had unknown pixel, face-gate and Set-gate evidence. The retained fixture crops and original geometry reproduce both failures on the original watcher, and neither commits with the new checks. A third retained crop covers that near-uniform real red sleeve.

The offline axis-aligned colour veto at 40 removed 2/2 phantoms and lost 0/23 reviewed real commits; thresholds chosen on other clips removed only 1/2. Only **four** of those real commits were backs. The production test uses a different, perspective-warped sampling grid: the retained phone/calc crop deviations are **41.09 / 53.11**. These observations motivate a conservative prompt fallback; they do not validate a general-purpose object classifier or unseen sleeves.

A uniform card-shaped object can still pass these heuristics. Glare, a new patterned sleeve, exposure changes or an ambiguous border can withhold a real Set. In play that costs one confirmation; at setup it can be ignored until the tester disables **Ignore setup objects** and scans again, or identifies/places it manually. A rejected spot requires observed clearance and a different positive look, so an occluded replacement or a replacement with the same sleeve can remain ignored. Recalibration that moves mat coordinates substantially can invalidate the spatial tolerance. These limits need owner-camera tests.

The three temporary hand cards were real resting sleeves mapped into ordinary S2/S3 cells. Score, size, cell-share and prior-motion vetoes either lost genuine commits or did not establish intent. No hand-row or additional dwell rule is added; it would delay legitimate Sets without safe evidence.

## Diagnostics

`FieldTrack.setEvidence`, Debug reasons and `FieldTiming.notes` retain detector confidence, pixel verdict/confidence, inner deviation, closest accepted-back distance, positive/basis and admission decision. Decisions are `committed`, `prompted`, `ignored` and `not-a-card` (or `waiting` while collecting evidence). The first clean resting observation is recorded too, so a prompt-OFF comparison still has candidate evidence. The decision describes watcher admission, not successful HTTP persistence; the existing mutation receipts establish the latter.

Saved board actions carry the evidence in **`cam.set`**, alongside `cam.seenAt/namedAt/sentAt/by/ui`. Presence confirmation is stamped `by:player`, `ui:set-card`; the popup removal uses `ui:not-a-card`. Decisions that create no action also enter the local clip ring and `remote-set-candidate` event. For allowlisted test recordings they ride the existing clock/end requests into sidecar **`setCandidates`**, with client epoch time, mat quad and the four switches. No frame pixels, signature, identity, deck or new model data enters that record. Batches are bounded to eight, the local queue to 512 and a recording sidecar to 5,000 decisions; excess evidence can be lost under sustained overload. Recording and storage failure never interrupts play.

## Local verification (2026-11-14)

Node **22.23.4**. No real browser, camera or deployed test was run in this sandbox. Changes are left uncommitted; nothing was pushed or deployed. The recognizer models, pipeline read logic, worker model loading and voice code are unchanged.

- `npm run build --workspace=packages/shared`: passed.
- Final watcher suite (`node --import tsx --test packages/vision/src/board.test.ts`): **137 passed**. Both phantom crops first failed on the original admission path by producing a Set. The final regressions also use their original quads, calibration, detector scores, cell shares and motion. Contact is minimized to the released/resting state; these are not full trace replays.
- Full vision suite (`node --import tsx --test --test-concurrency=1 src/*.test.ts`, from `packages/vision`): **313/315 passed**, before the final watcher follow-ups. Its two failures are outside the edited watcher: `mat-fit.test.ts:78` measured **1738.289 ms CPU**, above its 1500 ms limit; `pipeline.test.ts:214` received priors `[1,3,4]` instead of `[1,3]`. The latter reproduces alone. `mat-fit.ts` and `recognition-priors.ts` match HEAD byte-for-byte. Neither test nor their owners was weakened or edited. The final watcher suite above covers the subsequent watcher changes.
- Touched web suites (`vision-lab.test.tsx`, `remote-recognition.test.ts`, `remote-test-recording-route.test.ts`): **239 passed**, using `--maxWorkers=1 --testTimeout=20000` on the busy host. An earlier concurrent run had two five-second timeouts; the tests themselves were not changed to remove those assertions. Coverage includes no mutation before the presence choice, face-down placement on a player click, Not a card (including removal of an existing twin), Escape preserving the question, saved comparison settings and sidecar serialization.
- Vision and web typechecks passed. `git diff --check` passed.

The evidence helper was measured separately over five hot batches of 500 calls each, with outputs consumed and every calculator fixture rejected. Median process CPU per call was **0.126 ms** with no accepted-back references, **0.125 ms** with one, and **0.296 ms** with 32 (ranges .118–.146, .123–.139 and .288–.308 ms). This excludes the existing warp, original face classification, surrounding-mat median calculation, detector, recognizer, UI and I/O. It is a small-helper CPU measurement, not an application latency bound. Host load was about **264 on 10 cores**; wall timings are unsuitable for an end-to-end latency claim.

## Native replay receipt and limits

Read-only copies of the evaluation's `sim-build.mjs`, `sim-native.mjs`, `sim-model.mjs` and `sim-core.ts` ran against this worktree's changed watcher. Outputs, copied harness and source hashes are under ignored `data/vision-phantom/`; the source evaluation worktree was not edited. The pipeline source hash matches that evaluation worktree. The original adapted 14,894-row asset bank and ten clips were reused. The harness retains its original substitutions: FFmpeg/native CPU inference, latest-frame sampling, RGBA analyzer and an offline proposal sink, without React/HTTP/reducer orchestration.

All ten clips completed. At the two previously confirmed phantom spots, **2 → 0 Set episodes**, and **zero Reading placeholders**. No new no-card object was found among the five unmatched new placements when their saved event frames were reviewed by this agent. This does not establish accuracy on other objects or cameras.

Physical episode retention is less reassuring: **19/23** original reviewed real commits matched the new run, using one-to-one nearest matching within .065 image units and ±15 seconds. There were 24 new placement commits in total: 19 matched baseline real episodes, four other agent-reviewed physical-card/pile observations, and one temporary hand card. The additional observations must not be used to claim 23/23 episode recall. Pile role, wrong names, wrong faces and repeats remain separate errors.

| Unmatched baseline real commit | Observation |
| --- | --- |
| `solemn-tenpai-snake:9` | Red Set in S3. Unknown face pixels and hand/rest holds in this run; its near-uniform crop motivated the final ≤8 + mat-boundary fallback, which now passes the crop/watcher regression. |
| `cardmarket-meme:0` | Face-up GY observation; this run emitted no placement in that clip. |
| `lostzone-yubel-ryzeal:10` | Face-up S3 observation. |
| `sim-remote-29hZVYmE3tc:6` | Repeated face-down BANISHED bootstrap/pile observation; field-Set admission does not govern that zone. |

The native run used an earlier guard snapshot, **before the final red-sleeve fallback, Scan field witness check and prompt/rejection lifecycle follow-ups**. Those follow-ups have local watcher/web proof; the final source was not rerun through all ten native clips. Model startup and reads were heavily constrained on the shared host, and native cache warnings were logged. No all-OFF interleaved native control was run, so the four unmatched episodes cannot all be attributed to this guard. The source receipt, complete run JSON, matching script, reviewed extra-frame labels and test logs remain in `data/vision-phantom/`. These are agent-made YouTube labels and native replays, not the owner's camera or a production acceptance result.

## Changed files

- Vision: `packages/vision/src/{field-watcher.ts,set-card-evidence.ts,index.ts,board.test.ts}` and the three crop receipts under `packages/vision/src/fixtures/`.
- Owner UI and settings: `packages/web/src/components/remote/{field-watcher.tsx,field-watcher-ui.tsx}`, `ui/{camera-lock-control.tsx,card-view.tsx,recognition-setting.tsx,table.tsx}`, and `packages/web/src/lib/remote/{use-field-watcher.ts,set-card-settings.ts}`.
- Evidence and recording: `packages/shared/src/remote/{action-meta.ts,actions.ts}`, `packages/web/src/lib/remote/{set-card-diagnostics.ts,recordings-server.ts}`, `packages/web/src/components/remote/ui/use-test-recording.ts`, and `packages/web/app/api/remote/[slug]/recording/route.ts`.
- Web proof: `packages/web/tests/{vision-lab.test.tsx,remote-recognition.test.ts,remote-test-recording-route.test.ts}`.
- Docs: this page, `face-state-integration.md` and `contract.md`.

