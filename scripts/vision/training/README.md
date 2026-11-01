# Duel Lens training tools

Core training code ported from `mathulbrich/duel-lens` at
`f6968f3682d53a79c4a9fef591300615eda61c11`, Apache-2.0. Headers identify changes;
licence/notices are in `packages/vision/src/licenses/` and root `NOTICE`.
No upstream install script is executed. These tools are optional: the recognition
package uses the original downloadable synthetic-only weights.

Retained: DINOv2 model, InfoNCE/memory-bank training, synthetic sleeve/glare/foil/
camera/misframing generator, held-out split, per-epoch evaluation, ONNX export
and MatMulNBits quantization; detector MobileNetV3/FPN/heads, synthetic scenes,
corner targets/decoder, training, synthetic evaluation, ONNX/fp16-weight export.

Adapted: paths under ignored `data/vision/training`, profile-driven card aspect,
warp/art geometry, template class quotas, CPU/CUDA/MPS device selection, optional
private real-photo evaluation, actual cache-size export probes. Detector scenes
retain upstream's tournament mat/pile/spread drawing styles as synthetic
backgrounds. Pendulum and overframe effects remain optional Yu-Gi-Oh training
recipes; inference for a new game only needs its own profile and index. New-game
retraining may benefit from replacing those themed scene assets.

Excluded: video harvesters, public-broadcast ingestion, private realset labels,
GPU checkpoints, release/install scripts and experiment reports that upstream did
not publish. No training was run on this CPU-only machine. Python source syntax
and the input adapter were checked; a complete retrain/export still needs the
optional environment below and adequate compute.

## Prepare

From the repository/worktree root:

```sh
npx tsx scripts/vision/prepare-training.ts
python3 -m venv data/vision/venv-train
# Install the PyTorch wheel appropriate to your CPU/CUDA platform first.
data/vision/venv-train/bin/pip install torch torchvision transformers timm \
  safetensors huggingface_hub onnx onnxruntime onnxscript pillow numpy opencv-python-headless
PY=data/vision/venv-train/bin/python
$PY scripts/vision/training/train/prepare.py all
$PY scripts/vision/training/train/evalsuite.py build
```

The TS adapter uses the local built index/catalog and symlinks its artwork cache
instead of copying it. It writes upstream-compatible integer training IDs, a
card catalog, card back and `profile.json`. The Yu-Gi-Oh adapter uses passcode-style
numeric IDs; an adapter for a game with nonnumeric IDs must map those to local
integer training IDs (the browser API already accepts arbitrary string IDs).
`VISION_TRAINING_DIR` overrides the Python input root. Editing profile data and
using another catalog/images changes geometry/templates without changing the
trainer model or matching engine.

Preparation makes a ~300 MB uint8 memory-mapped art cache for 2,000 cards and
fetches a small pool of full-card frame templates (serial, ≥255 ms apart). The
full-card detector pool falls back to those templates when no separate
`cards-small` pool is provided. No real/video data is required: missing real
frame labels are skipped while synthetic evaluation remains active. Keep seen
and unseen groups sufficiently populated before training; tiny smoke indexes
are not a training dataset. The original new-release cutoff is 2026-01-01 plus
a seeded 5% of older cards; update the split for a later/new game dataset.

## Train and export

Use a GPU for a meaningful retrain; CPU commands are functional but slow. Device
selection is CUDA, then MPS, then CPU. Lower batches/workers on small machines.

```sh
PY=data/vision/venv-train/bin/python
$PY scripts/vision/training/train/train.py --run synthetic --minutes 100 --bs 16 --workers 2 --amp none
$PY scripts/vision/training/train/export.py export \
  --ckpt data/vision/training/train/ckpt/synthetic/best.pt --name dinov2-small-local --only q8
$PY scripts/vision/training/train/export.py check \
  --ckpt data/vision/training/train/ckpt/synthetic/best.pt --name dinov2-small-local --only q8

$PY scripts/vision/training/train-detector/train.py --run local --minutes 120 --frames 2 --workers 2
$PY scripts/vision/training/train-detector/export.py \
  --ckpt data/vision/training/train-detector/ckpt/local/last.pt \
  --out-dir data/vision/training/train-detector/onnx
```

The detector's optional export parity against private fullview frames requires
labelled local frames under `data/vision/training/eval/fullview`; synthetic training
itself does not. Exports stay in data and never install themselves into the web
app. Before adopting new weights, update the game model spec/hash, rebuild the
artwork index, benchmark the real worker, and recalibrate confidence on held-out
physical webcam images. Existing model/index caches are intentionally separate
from training outputs.
