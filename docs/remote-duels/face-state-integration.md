# Face-state integration

`packages/vision/src/face-state.ts` is independent of the watcher, DOM, detector and embedding runtime. Public exports: `classifyFaceState(crop, options)`, `isLikelyFaceDown(crop)` and `createFaceStateHysteresis()`. Crops use the existing `RGBAImage` contract. Confidence is evidence strength, not a posterior probability. Neither classification nor a similarity drop identifies a hidden card.

## Watcher worker: 20 lines

Split the following additions between the imports, `createFieldWatcher` locals (the two Maps), and the matched-track loop **after `publicIdentity` reconciliation and before `changedKind`/`changedLook`**. `crop` is a fresh, same-frame, native-source card warp, preferably 96×140 or larger; do not use the existing 8×12 appearance patch or art-only thumbnails. Expose this warp from the analyzer, or draw an ImageBitmap once to a shared native-resolution canvas and reuse `warpQuad`. `faceClean` must require confidence ≥ .7, no motion/partial/covered/overlap, and consistent quad geometry. Do not classify an old crop while recognition is in flight.

```ts
import {classifyFaceState,createFaceStateHysteresis,type FaceStateOptions} from './face-state';
const faceGates=new Map<string,ReturnType<typeof createFaceStateHysteresis>>();
const faceRefs=new Map<string,NonNullable<FaceStateOptions['reference']>&{privateCardId?:string}>();
const gate=faceGates.get(t.view.id)??createFaceStateHysteresis();
faceGates.set(t.view.id,gate);
const face=gate.update(faceClean&&crop?classifyFaceState(crop,{reference:faceRefs.get(t.view.id),detectorFaceDownScore:c.kind==='face-down'?c.confidence:undefined}):{state:'unknown',confidence:0},sample.at);
if(face.state==='unknown'){t.view.visible=false;invalidateRead(t);t.best=undefined;continue;}
c.kind=face.state==='down'?'face-down':'face-up';
if(face.state==='down'){
  t.view.cardId=undefined;t.read=undefined;t.best=undefined;t.identityCheck=undefined;
  if(t.resolvedAt===undefined&&!t.binding){
    t.view.faceDown=true;t.view.position=position;t.view.state='identified';t.view.visible=true;t.resolvedAt=sample.at;
    t.needsRead=false;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=t.view.position;
    emit('placed',t);continue;
  }
}
if(face.state==='up'&&t.view.faceDown){
  t.view.cardId=undefined;t.view.faceDown=false;t.view.state='candidate';t.read=undefined;t.best=undefined;
  t.needsRead=true;t.identityAppearance=undefined;t.binding=options.getKnownCards?.().find(k=>k.id===t.view.id);
}
```

Retain a reference only when a clean face-up read is accepted by the existing same-frame geometry/appearance checks, or the owner confirms it: `faceRefs.set(t.view.id,{crop:{...crop,data:Uint8ClampedArray.from(crop.data)},embedding:result.identityEmbedding,privateCardId:t.view.cardId})`. Keep this Map owner-local; never include it in events, snapshots, logs or the feed cache. Clone a bounded crop once and never replace a verified front reference with a back. The classifier can also reuse a **current same-frame** embedding through `options.embedding`; do not pass the last face-up embedding as though it were current. Only compare matching embedding spaces/dimensions.

The 20-line block sends a new confirmed back directly through the existing `placed` event, bypassing the current face-down identity prompt. Existing identified tracks use the normal settled `wasFaceDown` → `flipped` path. Add `!t.view.faceDown` to the `publicIdentity` refresh guard so a delayed face-down acknowledgement cannot restore a public ID. Invalidate pending recognition and increment the track revision when a face transition is accepted. Rebind/rekey the Maps if physical refs merge. Reset gates on misses, hand coverage, movement, hidden/busy pauses, calibration changes and stop; delete them with their tracks and clear both Maps on disposal. Unknown observations reset sustain, and gaps over 650 ms cannot count toward the default 300 ms window. At slower polling rates, request a short clean verification burst.

## Owner adapter and privacy

The requested **`twin.set` face-down** operation maps to existing wire actions on this base; there is no `twin.set` action in its schema:

- Existing twin: the sustained `flipped` event calls `act({type:'twin.flip',actorSeat:seat,seat,cardRef:ref,faceUp:false})`. Keep the original identity in owner-private state. Public projections must strip face-down `cardId`, `passcode`, `name`, `race`, and private candidates; remove that ref from public feed caches immediately. Revalidate the live track/revision before executing a queued mutation.
- Reverse flip: the block marks the track as a candidate and forces a new read. Only a fresh accepted face-up result may send `card.identified` and `twin.flip` with `faceUp:true` through the existing `apply` path. Do not reveal `privateCardId` just because pixels changed.
- New Set: `placed` with `faceDown:true` and no `cardId` goes through `fieldPlacementProposals`, producing `twin.place` with `faceUp:false`, ref, slot and position only. Skip `offer`/the identity picker and all recognition/AI for that back. In the effect-context branch, let this same placement bind the active Set effect to the physical ref and populate its private `effectTracking.origins[].candidates`; these are possibilities, never a chosen identity. No active context means an unnamed back. A candidate choice must remain optional and private.

The watcher integration includes the privacy/effect-origin prerequisite from `origin/feat/remote-facedown`. The reducer passes the duplicate guard’s adopted placement ref into effect tracking, so candidates attach to the saved twin. Public projections also omit owner-only duplicate confirmations; hidden transitions clear inherited public-identity flags. Do not broadcast the private Maps to compensate. Previously public knowledge cannot be erased from another player's memory, but the current face-down twin and hover UI must hide its identity.

## Calibration and verification

The deterministic offline script reads existing fixtures; it makes no downloads, opens no ports, writes only a small JSON report, and retains no generated images. Run from this worktree with Node 22:

```sh
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
./packages/vision/node_modules/.bin/tsx scripts/vision/calibrate-face-state.ts \
  --data /home/sulman633/repos/yugioh-bot/.worktrees/remote-vision/data/vision \
  --feedback /home/sulman633/repos/yugioh-bot/.worktrees/remote-vision-feedback/data/vision-feedback-smoke/vision-feedback \
  --fronts /home/sulman633/repos/yugioh-bot/data/card-images \
  --diagnostics /home/sulman633/repos/yugioh-bot/.worktrees/remote-autodetect/data/vision/diagnostics/nibiru-investigation
./packages/vision/node_modules/.bin/tsx --test packages/vision/src/face-state.test.ts
npm run typecheck --workspace=@yugidraft/vision
```

Sources: 30 full-card warps from the vision benchmark's synthetic camera frames, 22 existing full-card files, five retained feedback smoke fixtures, and three retained Nibiru screenshot captures (not live original camera frames). Art-only catalog thumbnails supply all-over artwork sleeve designs, never face-up labels. Each front has four camera transforms plus darkening ×0.1 and defocus σ10. Backs cover six plain colours (including white and black), checker/wave patterns, all-over catalog art and the official back, with exposure, lighting gradients, local glossy glare, noise, blur and quarter/half turns. There are no real sleeve-back crops in the available feedback directory.

Front identities are split consistently, including duplicate thumbnail sizes and feedback fixtures. Sleeve sources are reused across the calibration/evaluation **camera conditions**; these numbers do not measure unseen sleeve-design generalization. Unknown counts as a missed face-down in recall and never as a false flip. Arbitrary art sleeves that reproduce a card frame, fully saturated glare and an entirely defocused monochrome front can be visually indistinguishable from other states. Filter motion/occlusion, retain the reference, use detector evidence when available, and abstain on ambiguity. A finite synthetic set cannot establish universal sleeve accuracy.

Evaluation camera conditions, positive class = face-down; 156 backs and 252 face-up negatives:

| Input | Precision | Recall | TP / FP / FN |
|---|---:|---:|---:|
| crop only | 100.0% | 95.5% | 149 / 0 / 7 |
| bound reference | 100.0% | 98.1% | 153 / 0 / 3 |

Evaluation back detection by sleeve group (crop only / bound reference): plain sleeve 75/78 / 75/78, pattern sleeve 52/52 / 52/52, official back 9/13 / 13/13, art sleeve 13/13 / 13/13.

Hot CPU-only Node 22 timings over 1,000 calls after warmup (144×210 and rotated 210×144 crops; sampling cost is independent of source resolution):

| Input | Mean thread CPU | Wall p95 | Wall maximum |
|---|---:|---:|---:|
| crop only | 0.117 ms | 0.165 ms | 0.500 ms |
| bound reference | 0.273 ms | 0.364 ms | 4.284 ms |

The hot mean CPU and p95 meet the 3 ms budget. JavaScript scheduling/GC can exceed it on an individual call; these are measurements, not a hard realtime bound. Warping, detector and optional embedding inference are outside this module timing. No benchmark uses mocked detector probabilities.

## Integrated watcher verification (2026-11-02)

The analyzer lazily warps fresh native frames to portrait-ordered 96×140 crops using a reusable canvas. Gate/reference evidence stays on the private internal track, follows ref adoption, and is discarded with that track. Movement, misses, interrupted reads and hidden/busy pauses reset sustain. Settled backs bypass recognition and prompts while respecting Undo suppression. Reverse flips require a safe fresh read. The web adapter normalizes monster Sets to Defense Position and checks current face/revision before mutations.

Node 22.23.3 local native replay used the real ONNX detector/embedder and production watcher, proposal builder, reducer, duplicate guard and privacy projector. Triple Tactics Talent was rendered in S3 on a 1280×720 synthetic mat, then replaced with plain sleeve pixels. These are synthetic camera measurements, not live-webcam or network latency claims.

| Case | Result |
|---|---|
| Bound front → back, white / blue / red | Pass; 626 / 607 / 561 ms; owner retains identity, opponent/spectator identity fields removed |
| Back → front | Pass; 713 / 824 / 766 ms; one fresh read each, same adopted ref |
| New white back in M3 / S3 | Pass; 720 / 737 ms; monster DEF / Spell-Trap Set; zero reads or prompts; effect candidates owner-only |
| Duplicate guard / Undo | Pass; returned server ref adopted; one twin throughout flips; Undo does not recreate Sets; duplicate confirmation stays private |

`benchmark-field-watcher.ts` also passed a native-frame Chromium/WASM trial: placement, slide, rotation, graveyard return, removal, brightness stability, and 6-second hand-motion/occlusion runs; no false placements/removals, no extra follow reads, no browser errors. Calibration retained 153/156 bound backs with zero false flips among 252 front negatives.

Shared build and vision, web and WS typechecks passed. No tests were authored or added to the existing suites for this integration; verification used local harness/benchmark scripts only. Local small reports: `data/vision/benchmark/field-watcher/face-integration-native.json`, `data/vision/benchmark/field-watcher/face-integration.json`, and `data/face-state/report.json`.
