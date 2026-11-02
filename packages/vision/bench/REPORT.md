# Session benchmark delivery — 2026-11-01

Real physical-webcam accuracy is **unknown**: no owner-labelled recording was
provided. The existing clean-reference synthetic regression is 30/30 top-1 and
30/30 top-5 (`packages/vision/REPORT.md`), with no basis for a >90% real claim.
This branch makes that claim testable. The real gate intentionally remains FAIL
until exhaustive real labels, complete detector checkpoints and lifecycle coverage
exist. No tracker/gallery or alternative detector was implemented.

## What shipped

- **Record session** tab in `/dev/vision-lab`: video-only WebM streamed locally
  into owner-selected `DATA/vision-sessions/`, selectable resolution, 5-minute /
  ~150 MiB cap, marker/event log, video scrubber and human-reviewed event labels.
- Current-pipeline offline prefill, physical copy IDs, placement/move/removal
  destinations, flips/ATK/DEF, format/mat calibration, complete detector
  checkpoints and hand-only intervals. Revised JSON import and cancellation were
  browser checked. Exported JSON lives beside the video; there is no upload API.
- One-command app-watcher/headless Chromium replay, paired with/without deck,
  WASM and available hardware WebGPU, event/identity/zone/detector metrics,
  p50/p95 latency, prompt counts across track changes, wrong sure/hand events,
  CPU s/s, actual backend/threads, raw evidence/hashes, JSON + Markdown and strict
  failing exit code. `--compare` adds unchanged-data regression gates.
- Bench-only motion/ROI/640px experiment; full-size identity input is retained.
- Native CenterNet synthetic webcam scenes extending existing Duel Lens code;
  stream-to-trainer ROCm detector and DINO launchers; tiny GPU setup check;
  exact owner setup/run commands and native-Windows ROCm fallback instructions.

## Reproduced synthetic lifecycle smoke

An 18-second **synthetic** canvas/VP8 clip contains one Blue-Eyes reference card:
place M2, slide M4, rotate DEF, remove off camera. It includes four event labels,
three positive + one empty detector checkpoint and an approximate drawn hand.
It is a plumbing/logic check, not an unbiased accuracy dataset. One observation
per action is not a latency distribution. Raw results remain local under
`data/vision-session-fixture/benchmark-final/`.

| Variant / deck | Event recall / precision | End-to-end ID top-1 / top-5 | Placement / move / removal ms | CPU s/s | Prompts |
| --- | --- | --- | --- | --- | --- |
| baseline / with | 100% / 100% | 100% / 100% | 1735 / 520 / 2695 | 1.167 | 0 |
| baseline / without | 25% / 50% | 25% / 25% | — / — / — | 0.815 | 2 |
| efficient / with | 100% / 100% | 100% / 100% | 1955 / 420 / 2740 | 0.321 | 0 |
| efficient / without | 25% / 33% | 25% / 25% | — / — / — | 0.301 | 3 |

Detector checkpoint precision/recall: 3/3 positive boxes, 100% each, all four
checkpoints observed. Wrong sure and hand false events: zero in this tiny clip.


In-deck removal was observed but the destination was UNKNOWN: zone accuracy and
automatic recall are 75%. A camera cannot identify an unseen destination from
absence alone; the bench does not substitute the label. The unassisted no-deck
run emitted repeated prompts and missed subsequent lifecycle events, so its
end-to-end top-1/top-5 is only 25% even though its placement suggestion included
the correct ID. This is deliberately different from crop-only classification.
Both variants fail the real gate. Keep efficiency experimental: CPU saving on
one simple clip does not justify any placement latency regression.

Headless WSL Chromium reported **no hardware WebGPU adapter**. It used isolated
WASM SIMD with four threads. This does **not** establish Windows Chrome's result
on the owner's RX 7900 XTX. Open Windows Chrome → Record session → **Check
WebGPU**, then run a prefill with WebGPU and read **Actual backend**; adapter
availability and ONNX fallback are reported separately. ROCm and WebGPU are
independent stacks.

## Recommendation and work order

1. Record/review real sessions first; freeze test sessions by camera/mat/light.
   Use the exact recording/labeling steps and command in [README.md](README.md).
   The >90% gate includes 50+ events per session, ten complete detector frames,
   lifecycle/field/Extra→EMZ coverage, destinations and hand negatives.
2. Keep **Duel Lens detector + DINOv2-S + onnxruntime-web**. Replay the autodetect
   worker's gallery, tracker, deck-first top-five and homography fixes against
   those sessions. Their target is correct in-deck events >90%, zero repeated
   prompts/wrong sure, then placement <1s and moves <0.5s; these are goals, not
   measured gains. The initial hard latency ceilings are 2/1/4.5s p95 for
   placement/move/removal, plus ≤20% regression against prior data.
3. Check actual Windows Chrome hardware acceleration before assuming WASM is
   the fastest option. Test fp16 GPU versus q8 WASM with model/index parity;
   don't adopt a new precision/backend solely because an adapter exists.
4. Fine-tune DINOv2-S on reviewed, rectified real crops + synthetic damage if
   identity is the measured limit. Retrain the existing detector on webcam
   scenes only if recall/corners prove limiting. No evidence here justifies a
   different detector. Adopt the efficiency experiment only on a real gate pass.
5. Use the local **7900 XTX, 24 GB**, not rental. Planning estimate: detector
   fine-tune **6–16h**, DINOv2-S **4–12h**, each including evaluation; derive a
   revised ETA from the real trainer `--bench` output. Setup check prints a tiny
   matmul and optimizer it/s. Costs are $0 rental plus electricity. A rented
   4090 would add hourly charges and is unnecessary. No packages/drivers were
   installed or paid jobs run. Full GPU training was not executed: torch is
   absent in this environment, and the setup check correctly reports failure.

[LOCAL-TRAINING.md](LOCAL-TRAINING.md) contains owner-run ROCm/WSL setup, native
Windows fallback, disk path choices, scripts, checkpoint prerequisites, frozen
split rules and export/index/parity steps. Real-domain training is expected to
improve robust auto-acceptance; the +5–10 percentage-point expectation in the
stack brief remains a hypothesis until the frozen real test set measures it.

## Validation and limitations

Two lean TypeScript feature scenarios pass; both package typechecks pass; one
lean generator scenario passes with deterministic full-card scenes/native
corner labels; small preview export and Python AST checks pass. The retained
Python common module emits an existing ResourceWarning for its profile file.
An actual Chromium fake-camera scenario verifies WebM/marker/label/checkpoint
export, revised JSON import, prefill and cancellation: **zero HTTP writes and
zero browser errors**. Independent review found no remaining important issue.
The synthetic runner writes both reports and exits 1 on its intentionally failing
gate. Physical camera permission/picker, the owner's Windows Chrome GPU, and full
ROCm training still require owner execution. Replay measures watcher decisions,
not remote socket/reducer/render latency or human prompt-answering behavior.
