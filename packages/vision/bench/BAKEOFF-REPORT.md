# Session benchmark + owner embedder bake-off — 2026-11-01

This is the updated report addendum to [REPORT.md](REPORT.md). It is a new file
to preserve the owner's **new files only** rule. Continue on
`feat/remote-vision-bench` in `.worktrees/remote-vision-bench`.

**Real accuracy and the bake-off winner remain unknown.** Inspection found four
local `.session.json` recordings; all explicitly say `source: synthetic`.
No real owner recordings were available. No candidate training, weight download,
GPU installation, paid job or actual bake-off was run. The empty example
manifest is rejected before ML imports/downloads/output creation.

The existing lifecycle fixture remains a plumbing result: with a deck,
baseline/efficient event recall and precision were 100% on four synthetic events;
automatic/zone recall was 75% because the unseen removal destination was UNKNOWN.
Without a deck, end-to-end top-1/top-5 was 25%. Both fail the real gate. The
30/30 clean-reference result also cannot establish physical-webcam accuracy.

## Owner: record and label a session

All commands below run from this worktree. Use Windows Chrome/Edge for the
directory picker and physical camera; footage stays on the owner's machine.

1. Use Node 22 and the existing prepared vision assets. If needed, prepare them
   using [the package runbook](../README.md). Start the isolated lab in a terminal:

   ```sh
   export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
   E2E_AUTH=1 E2E_AUTH_SECRET=vision-lab-local-only-633-not-a-real-key \
     npm run dev --workspace=@yugioh-discord-bot/web -- --hostname 127.0.0.1 --port 3437
   ```

   Reuse the lab only if it is this worktree's own process. Port 3417 belongs to
   another worker. Record the launched PID; stop with Ctrl-C or `kill <owned-PID>`.
   Never kill by name or stop another service to take its port.
2. In **Windows Chrome**, open `http://localhost:3437/dev/vision-lab`. Select
   **Record session → Choose DATA folder**, choosing e.g. `D:\VisionData`.
   Files go under `vision-sessions/`. Choose resolution, **Start recording**,
   allow camera, perform actions, use **Mark moment** if useful, **Stop & save**.
   Capture is video only, capped at five minutes/~150 MiB; recognition waits
   until prefill. Use a local folder rather than cloud synchronization.
3. The label editor opens. To resume: choose the same DATA folder, **Open local
   video**, **Open session JSON**, and select the matching video. Enter the
   deck's passcode/catalog IDs and format. **Calibrate mat**: click TL, TR, BR, BL
   on a paused frame.
4. Run **Prefill with current pipeline**. It replays locally at 1×. Suggestions
   are drafts. Review the entire recording: correct every ID/zone/time, remove
   false suggestions, add every missed event. A label's time is the first frame
   of physical action, rather than the later recognition decision.
5. For each action, scrub, draw the card rectangle, **Use current time**, select
   event/card/zone and **Confirm label**. Keep one physical instance ID through
   placement/move/disappearance/return; separate IDs for identical copies. Give
   moves/removals their actual destination, flips their face state and defense
   their ATK/DEF state. A removal uses the last visible source rectangle.
6. At steady frames, **Propose detector checkpoint at playhead**. Correct all
   outlines, add missed cards/backs, remove stale boxes, then check **All visible
   cards...**. Empty/hand-only checkpoints have zero card boxes. Mark hand-only
   start/end intervals. Check the final review declaration and **Export labelled
   session JSON**. Keep JSON beside its matching WebM/MP4; move a downloaded JSON
   there if no directory handle was available.
7. Collect multiple cameras/mats/light conditions. A gate session needs **50+
   events**, **10 complete detector checkpoints**, placement/move/removal/flip/DEF,
   Field activation, Extra→EMZ, removals to GY/deck/hand, and **5+ seconds hand-only**.
   Hold between actions. Freeze test sessions and at least one unseen condition
   before training; keep whole sessions/tracks in a single split.

The full [session runbook](README.md) defines the strict gate and label contract.

## Owner: benchmark command

```sh
npx tsx scripts/vision/benchmark-sessions.ts \
  --sessions /mnt/d/VisionData/vision-sessions \
  --out /mnt/d/VisionData/benchmark
```

Requires installed repo dependencies, Playwright Chromium and prepared assets
in `VISION_DATA_DIR` (default `data/vision`). Jobs run sequentially in the
foreground with an ephemeral loopback port. Output: `results.json` and
`summary.md`. Default exit 1 means the real gate failed. Add
`--compare /path/to/previous/results.json` for unchanged-data regression gates.
Budget approximately video duration × two deck modes × available backends,
plus warm-up (and × variants if explicitly enabling the efficiency experiment).

## Approved bake-off

The new `bakeoff.py` command validates real data, freezes hashes, extracts only
reviewed perspective-correct crops, invokes retained `train.py` through adapters,
exports models, then waits for Windows Chrome evaluation. It never edits or
installs models/indexes into the app.

| Candidate key | Backbone / source | Nominal size |
| --- | --- | --- |
| `dinov2-small` | `facebook/dinov2-small`, the current `dinov2-small-duel` architecture | 21M |
| `dinov3-small` | `facebook/dinov3-vits16-pretrain-lvd1689m`, distilled ViT-S/16 | 21M |
| `dinov3-small-plus` | `facebook/dinov3-vits16plus-pretrain-lvd1689m`, ViT-S+/16 | 29M |
| `dinov2-base` | `facebook/dinov2-base`, ViT-B/14 | 86M |
| `mobileclip2-s0` | `timm/MobileCLIP2-S0-OpenCLIP`, Apple MobileCLIP2-S0 vision tower | actual export count |
| `mobileclip2-s2` | `timm/MobileCLIP2-S2-OpenCLIP`, Apple MobileCLIP2-S2 vision tower | actual export count |

Meta's [S](https://huggingface.co/facebook/dinov3-vits16-pretrain-lvd1689m) and
[S+](https://huggingface.co/facebook/dinov3-vits16plus-pretrain-lvd1689m) model
cards identify the distilled family. MobileCLIP uses the
[canonical OpenCLIP conversion](https://huggingface.co/timm/MobileCLIP2-S0-OpenCLIP)
of Apple's weights; text towers are discarded. Exact parameter counts and
FP32/q8/fp16 file bytes/hashes are recorded, rather than inferred from names.

Every model uses the same 12,000 optimizer steps, seed 633, 16 synthetic anchors
× two degraded views, eight real tracks, four synthetic and two real negatives,
FP32 training, LR 3e-5, temperature .05, weight decay .05 and warm-up 150.
All backbones are trainable, with uniform LR and no per-image standardization,
so transformer-block freezing does not advantage the convolutional control.
The retained InfoNCE, real sampler, synthetic damage, negative loss, memory bank
and schedule are unchanged. The **last** checkpoint at the fixed step budget
is evaluated for every model; synthetic-selected best is retained for inspection.

Default initialization is each HF pretrained backbone. That is a controlled
same-budget adaptation comparison; it does **not** reproduce the shipped
synthetic-trained `dinov2-small-duel` checkpoint. If its original compatible
PyTorch checkpoint is available, set `initialCheckpoints.dinov2-small`; label
that provenance explicitly. A q8 ONNX file cannot initialize `train.py`. Do not
present pretrained versus owner-checkpoint runs as identical initialization.

All models consume the same 224px artwork crops. MobileCLIP converts back to
RGB [0,1] and bilinearly upsamples to its native 256px inside the graph; this
conversion is identical in training/export/browser and included in timing.
This is the controlled shared-crop recipe, not a native-resolution sweep.

### Real crop manifest and one-command run

1. Complete the ROCm/preparation steps below. Copy the configuration:

   ```sh
   cp packages/vision/bench/bakeoff.example.json /mnt/d/VisionData/bakeoff.json
   ```

2. Set `trainingDir` and a **new** `outputDir`. Fill `sessions` with absolute
   label paths (or paths relative to the manifest), split and condition. Example:

   ```json
   {"labels":"vision-sessions/room-a.session.json","split":"train","condition":"camA-felt-day"}
   ```

   Add separate `calibration` and `test` sessions. At least one test condition
   must be absent from both training and calibration. The validator rejects
   duplicate sessions, identical video content crossing splits, synthetic footage
   and unreviewed events. Include positive and hand/mat/back negatives in **each**
   split. Use many physical tracks/conditions; one crop per class is only a
   plumbing minimum and gives no credible accuracy estimate.
3. Add `crops`, selecting steady, human-reviewed times. Each needs four measured
   normalized corners in clockwise **portrait-card TL,TR,BR,BL** order, `sessionId`, `atMs`, physical
   `instanceId`, `cardId`, and exact catalog artwork `imageId`:

   ```json
   {"sessionId":"room-a","atMs":3500,"instanceId":"copy-1","cardId":"89631139","imageId":"89631139",
    "quad":[[0.20,0.18],[0.35,0.20],[0.34,0.58],[0.19,0.55]]}
   ```

   The **first quad edge must span the card's short side**, so the warp is
   portrait. For a landscape DEF card, cyclically reorder the screen corners:
   e.g. screen **TR,BR,BL,TL**, rather than stretching a landscape rectangle
   into portrait. Select the clockwise order that puts the training art upright.
   For upside-down training cards add `"rotation":180` (default 0); this orients
   the whole training card before the retained artwork sampler. Evaluation always
   makes both orientation hypotheses independently from the full card warp.
   Divide measured video corner pixels by video width/height. Check the resulting
   warp visually. The session editor's axis-aligned event box is **not** a
   perspective quad. For negatives use `cardId:null`, a unique `instanceId`,
   and a reviewed quad bounding the hand/mat/back patch; omit `imageId`.
   Positive identities must match reviewed events. Train anchors must belong
   to the prepared synthetic training split, protecting its held-out evaluation.
   Training crops are grouped by session/physical ID/artwork into retained real
   tracks; calibration/test pixels are never given to the training sampler.
4. Validate without torch, tokens, network or outputs:

   ```sh
   python3 scripts/vision/session/bakeoff.py validate --manifest /mnt/d/VisionData/bakeoff.json
   ```

5. Once ready, the **one-command bake-off** is:

   ```sh
   /mnt/d/VisionData/venv-rocm/bin/python scripts/vision/session/bakeoff.py run \
     --manifest /mnt/d/VisionData/bakeoff.json
   ```

   It trains/exports candidates sequentially, then prints its owned PID and
   `http://localhost:<ephemeral-port>/`. Open that address in **Windows Chrome**,
   enter the owner CPU model and click **Run all candidates**. Keep the tab visible
   and the terminal in the foreground. Browser results are saved locally as
   `browser-results.json` and `browser-summary.md`; the server exits automatically.
   A missing GPU/unsupported export/parity failure is explicit, and exit 2 means
   incomplete backend coverage or wrong sure predictions. No silent GPU fallback.
   Ctrl-C stops this process; if necessary kill only its printed PID.

For a throughput pilot use `bench` instead of `run`: the same recipe executes
25 real optimizer steps per candidate and prints seconds/step. It writes into
`outputDir-pilot`; use a fresh path for another pilot. No long training follows
a pilot. The full run and pilot both require real recordings/crops first.

To repeat only browser evaluation, with frozen inputs unchanged:

```sh
npx tsx scripts/vision/bakeoff-browser.ts --dir /mnt/d/VisionData/bakeoff-run-01
```

The [results table template](BAKEOFF-RESULTS.md) has all twelve model/backend rows.
The generated report includes separate deck modes, raw counts, per-session
scores, CPU/browser/GPU details, thread count, load time, search time and native
parity. The browser independently rebuilds the **full catalog gallery with each
precise export**, merges alternate art and 0/180 rotations by per-card maximum,
and measures top-1/top-5 with deck-restricted versus unrestricted candidate IDs.
Empty/missing decks yield no in-deck candidates; out-of-deck positives stay wrong.
This crop experiment's deck restriction is distinct from the app's deck-first
decision/tracker policy, which the existing lifecycle benchmark measures.

Sure thresholds are selected on **calibration only**, independently for each
candidate/backend/deck mode, maximizing correct acceptance with zero calibration
errors. Frozen-test top-k uses positive crops. Sure coverage uses all crops,
including negatives; positive-only sure coverage is also recorded. A test wrong
sure makes the zero-wrong rate unavailable/FAIL, never a threshold retune on test.
Zero errors on a finite test set is an observation, not a universal guarantee.
Warm crop p50/p95 includes two orientations, preprocessing, normalization and
GPU readback; excludes model load, gallery build, search and detector. WASM uses
up to four threads under cross-origin isolation. fp16 WebGPU requires hardware
`shader-f16`, successful native/browser parity and all-GPU graph capture.

### DINOv3 gated access and licence

The owner signs into Hugging Face and accepts the licence/access terms on both
Meta model pages. Wait for any access approval. Put a read token in the local
file **`~/.config/yugioh-vision/bakeoff.env`**, outside the repository:

```sh
mkdir -p ~/.config/yugioh-vision
touch ~/.config/yugioh-vision/bakeoff.env
chmod 600 ~/.config/yugioh-vision/bakeoff.env
# Edit this file locally with an editor; never paste its contents into chat.
```

The env file contains `HF_TOKEN=<owner read token>` and optionally `HF_HOME`,
`TORCH_HOME`, `TMPDIR`, `HSA_ENABLE_DXG_DETECTION`. `--env-file /other/local/path`
can override it. The loader reads assignments without executing shell code and
does not print values. Never commit this file or put a token in CLI arguments.

DINOv3 uses the **custom Meta DINOv3 License**, rather than Apache-2.0.
It permits modifications/derivatives. Distribution of weights or derivatives
must follow its terms and include the **full licence text**. Prohibited-use and
trade-control terms apply, including the agreement's military/ITAR and other
restricted end uses; privacy/data-protection obligations also apply. Research
publications must acknowledge use. The exporter saves `DINOv3-LICENSE.md` beside
each DINOv3 artifact; keep it with every distributed derivative. See the
[authoritative licence](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md).
MobileCLIP2 weights have their own
[Apple model licence](https://github.com/apple-aiml-research/ml-mobileclip/blob/main/LICENSE_MODELS);
include it when distributing those artifacts. DINOv2 is Apache-2.0.

## Owner: ROCm setup and time budget

Use the detailed, existing [LOCAL-TRAINING.md](LOCAL-TRAINING.md) commands for
the pinned working target: **Ubuntu 24.04 WSL2, Python 3.12, ROCm 7.2.1, PyTorch
2.9.1, compatible AMD Adrenalin 26.2.2 WSL driver**. AMD's
[WSL matrix](https://rocm.docs.amd.com/projects/radeon-ryzen/en/docs-7.2.1/docs/compatibility/compatibilityrad/wsl/wsl_compatibility.html)
lists RX 7900 XTX support and the framework combination. Keep an already-working
compatible stack. The versioned guide is reproducible; it is not a claim that
7.2.1 is today's latest release.

1. Install the Windows WSL-compatible AMD driver; `wsl --update`, use Ubuntu
   24.04, restart if requested. Follow
   [AMD's WSL guide](https://rocm.docs.amd.com/projects/radeon-ryzen/en/docs-7.2.1/docs/install/installrad/wsl/howto_wsl.html).
2. Install ROCm **userspace** and the compatible ROCDXG userspace release from
   [the quickstart](https://github.com/ROCm/librocdxg#quickstart). Do not install
   native-Linux DKMS/display drivers inside WSL. Set
   `HSA_ENABLE_DXG_DETECTION=1`; `/opt/rocm/bin/rocminfo` must list `gfx1100` / 7900 XTX.
3. Put the Python venv, HF/Torch caches, temporary directory and training/output
   on a roomy data drive. Follow the exact AMD wheel commands in LOCAL-TRAINING;
   install with `--no-cache-dir`, then:

   ```sh
   PY=/mnt/d/VisionData/venv-rocm/bin/python
   "$PY" -m pip install --no-cache-dir 'transformers==4.56.2' 'timm==1.0.22' \
     'open_clip_torch==3.2.0' 'onnxruntime==1.30.0' 'onnxconverter-common==1.16.0' \
     onnx onnxscript safetensors huggingface_hub pillow 'numpy<2' 'opencv-python-headless<4.12'
   "$PY" scripts/vision/session/check_gpu.py
   ```

   Keep AMD's ROCm torch/torchvision wheels; inspect pip's plan if it proposes
   replacing them. `check_gpu.py` must show HIP, the actual GPU, finite loss and
   optimizer throughput. Its tiny matmul is not an embedder training estimate.
   DINOv3 needs Transformers 4.56+, beyond the old runbook's lower minimum.
4. Prepare the existing catalog/artwork caches and synthetic evaluation sets:

   ```sh
   export VISION_TRAINING_DIR=/mnt/d/VisionData/training
   npx tsx scripts/vision/prepare-training.ts
   "$PY" scripts/vision/training/train/prepare.py all
   "$PY" scripts/vision/training/train/evalsuite.py build
   ```

   This reuses the artwork cache; synthetic training streams on demand. The
   bake-off streams the art mmap instead of duplicating a full catalog pixel
   corpus and retains last/best checkpoints. Allow **20–35 GB total** for venv,
   model caches and six exports/checkpoint pairs, depending on existing caches;
   the command also requires at least 5 GiB free for run outputs. Inspect real
   available space first. No giant pre-rendered synthetic corpus is needed.
5. Complete the real manifest, run `bench`, then the full command above. If the
   full recipe OOMs, reduce the **shared** batch settings for every candidate
   and name a new run; do not silently give a model a different recipe.

If WSL ROCm cannot work, use the separate native-Windows ROCm venv/AMD wheel
instructions in LOCAL-TRAINING, prepare native paths and run `check_gpu.py`
again. The model adapters are spawn-safe. DirectML is only the existing
arithmetic diagnostic; these retained trainers require ROCm.

Planning estimates, **not measured on this owner's card**: setup **30–90 minutes**
with downloads/restarts; careful labeling often **30–90 minutes per five-minute
session**, plus quad review. Earlier partial-freeze DINOv2-S planning was 4–12h;
this full-backbone recipe may cost more. Budget **4–16h each** for small DINO/
MobileCLIP controls and **8–24h** for DINOv2-B, roughly **28–104h sequentially**
for six models, plus browser gallery construction/evaluation. Full fresh-HF
adaptation may require more steps to converge; equal steps is an experimental
control, not evidence of convergence. Replace these guesses with the pilot:
`hours = seconds_per_step × 12000 / 3600`, plus 20–40% evaluation/I/O. Detector
fine-tune remains a separate **6–16h** estimate. Local GPU rental cost is $0 plus
electricity; no rented 4090 is required.

## WebGPU finding and recommendation

The prior **headless WSL Chromium found no hardware WebGPU adapter** and used
four-thread SIMD WASM. This says nothing about Windows Chrome on the RX 7900
XTX. On the owner PC, use **Record session → Check WebGPU**, then prefill and
inspect **Actual backend**. Adapter availability and successful ONNX GPU
execution are separate checks. ROCm training and browser WebGPU use independent
stacks. ONNX Runtime documents graph capture only when
[all compute kernels run on WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html).
The new harness enforces this and records missing/unsupported GPU rows.

Keep **Duel Lens detector + DINOv2-S + onnxruntime-web** until real evidence
justifies a change. Prioritize real recording/labels and the current worker's
gallery/tracker/deck-first fixes. Run the approved bake-off when its real-data
gate passes; choose the smallest/fastest model that improves held-out accuracy
and sure coverage while preserving zero observed wrong sure in both deck modes.
DINOv3-S is a plausible first challenger; its licence and export compatibility
are real adoption work. DINOv3-S+, DINOv2-B and MobileCLIP controls are experiments,
not established upgrades. A larger nominal backbone alone is no recommendation.

After selecting a candidate, rebuild the app model/index spec and thresholds,
verify native/WASM/WebGPU parity, and replay the frozen **whole sessions** using
the lifecycle benchmark. Require the existing >90% identity/event/zone/detector
gate, zero wrong sure/repeated prompts/hand events and latency/regression gates.
Crop classification cannot approve lifecycle deployment. No detector replacement
is justified by the available evidence.

## Validation and limits

Two lean scenarios pass: real-data/split rejection and confidence calibration
with negative false accepts. Python syntax, JavaScript syntax and vision
TypeScript checks pass. Chromium browser plumbing passes with a tiny dummy
WASM graph (expected `[1,1,1]`), zero page errors, local report saving and the
expected incomplete-run exit code. No candidate bake-off was run. Review caught
and corrected capture input/output binding and whole-card orientation handling.
PyTorch/ROCm and real owner data are unavailable in this
environment, so full train/export and Windows hardware execution remain owner-run
validation. The results template intentionally contains no invented measurements.
