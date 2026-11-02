# Local training on the owner's RX 7900 XTX (24 GB)

Use the existing **Duel Lens CenterNet/MobileNetV3 detector + DINOv2-S**. Training
is optional and local. Nothing here installs packages/drivers, starts training,
downloads a model or rents a GPU unless the owner runs the listed commands.
The check script imports only PyTorch; generator verification needs NumPy/OpenCV.
No Radeon training throughput or accuracy gain has been measured in this branch.

## Owner setup: WSL2 preferred

These owner-run steps use AMD's documented **ROCm 7.2.1 / PyTorch 2.9.1 / Python
3.12 / Ubuntu 24.04** combination. AMD now documents ROCDXG user-mode WSL support;
use that path rather than installing a Linux display/kernel driver inside WSL.
The exact compatibility/install sources are linked below; keep an existing
working ROCm installation instead of replacing it just for this task.

1. In Windows install AMD's compatible **Adrenalin 26.2.2 for WSL2** driver from
   the [AMD WSL guide](https://rocm.docs.amd.com/projects/radeon-ryzen/en/docs-7.2.1/docs/install/installrad/wsl/howto_wsl.html).
   Update WSL with `wsl --update` in Windows Terminal. Use Ubuntu 24.04 (`wsl
   --install -d Ubuntu-24.04` only if an appropriate distro is absent). Restart
   Windows/WSL when the installer requests it.
2. Install ROCm userspace and **ROCDXG** following AMD's
   [ROCDXG quickstart](https://github.com/ROCm/librocdxg#quickstart).
   Choose its prebuilt `rocdxg-roct_<version>_amd64.deb` release, run
   `sudo dpkg -i /path/to/rocdxg-roct_<version>_amd64.deb`, then `rocminfo`.
   It must list `gfx1100` / Radeon RX 7900 XTX. On the pinned 7.2.1 stack set
   `export HSA_ENABLE_DXG_DETECTION=1` in the training shell. The ROCDXG repository
   now points to rocm-systems for newer code; follow its current release guidance
   if the old prebuilt release is unavailable. Do not copy native-Linux DKMS
   instructions into WSL. This is the only system setup step; scripts don't run it.
   For a fresh Ubuntu 24.04 WSL distro, register the pinned userspace package
   repository and install ROCm only (owner commands, **no DKMS/graphics install**):

   ```sh
   wget https://repo.radeon.com/amdgpu-install/7.2.1/ubuntu/noble/amdgpu-install_7.2.1.70201-1_all.deb
   sudo apt install ./amdgpu-install_7.2.1.70201-1_all.deb
   sudo apt update
   sudo apt install rocm
   # Then install the ROCDXG release .deb from step 2 and validate:
   export HSA_ENABLE_DXG_DETECTION=1
   /opt/rocm/bin/rocminfo
   ```

3. Choose disk paths **before** preparing datasets or creating the environment.
   Example paths below assume a D: drive; substitute an existing drive/folder.
   Check available space (`df -h /mnt/d`). Allow roughly 15–25 GB for environment,
   model caches and derived training assets; on-the-fly scenes avoid storing a
   20k–50k image corpus. Keep each checkpoint run modest, and retain best/last.

   ```sh
   export VISION_TRAINING_DIR=/mnt/d/VisionData/training
   export VISION_WEBCAM_CARDS=/path/to/existing/full-card-jpeg-cache
   export HF_HOME=/mnt/d/VisionData/hf-cache
   export TORCH_HOME=/mnt/d/VisionData/torch-cache
   export TMPDIR=/mnt/d/VisionData/tmp
   mkdir -p "$VISION_TRAINING_DIR" "$HF_HOME" "$TORCH_HOME" "$TMPDIR"
   python3.12 -m venv /mnt/d/VisionData/venv-rocm
   PY=/mnt/d/VisionData/venv-rocm/bin/python
   "$PY" -m pip install --no-cache-dir --upgrade pip wheel
   "$PY" -m pip install --no-cache-dir \
     'https://repo.radeon.com/rocm/manylinux/rocm-rel-7.2.1/torch-2.9.1%2Brocm7.2.1.lw.gitff65f5bc-cp312-cp312-linux_x86_64.whl' \
     'https://repo.radeon.com/rocm/manylinux/rocm-rel-7.2.1/torchvision-0.24.0%2Brocm7.2.1.gitb919bd0c-cp312-cp312-linux_x86_64.whl' \
     'https://repo.radeon.com/rocm/manylinux/rocm-rel-7.2.1/triton-3.5.1%2Brocm7.2.1.gita272dfa8-cp312-cp312-linux_x86_64.whl'
   "$PY" -m pip install --no-cache-dir 'transformers>=4.50,<5' timm safetensors \
     huggingface_hub onnx onnxruntime onnxscript pillow 'numpy<2' 'opencv-python-headless<4.12'
   "$PY" scripts/vision/session/check_gpu.py
   ```

   Wheel commands follow [AMD's PyTorch installation](https://rocm.docs.amd.com/projects/radeon-ryzen/en/docs-7.2.1/docs/install/installrad/native_linux/install-pytorch.html).
   `check_gpu.py` prints GPU, HIP/torch versions, VRAM, matmul milliseconds, finite
   train loss and optimizer iterations/second, exiting 2 on missing/nonworking
   ROCm. AMD is correctly exposed through `torch.cuda`; it is not NVIDIA-only.
   A tiny linear step is a setup check, not a model-training speed prediction.

4. From the repo worktree (Node 22), prepare trainer inputs. This retained adapter
   expects an index/build report/catalog cache from the normal `build-index.ts`
   preparation. If using a shared prepared asset cache, set `VISION_DATA_DIR` to
   that root as documented by `packages/vision/README.md`.

   ```sh
   npx tsx scripts/vision/prepare-training.ts
   "$PY" scripts/vision/training/train/prepare.py all
   "$PY" scripts/vision/training/train/evalsuite.py build
   ```

   The adapter symlinks existing artwork rather than copying it. `prepare.py`
   builds the art mmap/templates and can fetch template images. Full-card images
   for the webcam detector are separate: `VISION_WEBCAM_CARDS` must contain full
   portrait JPEGs named `imageId.jpg` or `imageId-small.jpg` (268px small cards
   are fine). **`data/vision/thumbnails` is square artwork and is rejected.**
   You can point at the prepared `train/templates` pool for a small pilot, but
   meaningful training requires a representative full-card pool.

Windows-drive symlinks can be awkward when later read from native Windows:
prepare a separate native training root if switching OS. Do not delete an input
cache still used by a training symlink. Slow NTFS small-file I/O can limit scene
workers; measure with two workers before increasing. Avoid filling the WSL disk
with pip wheel caches or duplicate datasets; `--no-cache-dir` is intentional.

## Synthetic webcam data and detector training

`webcam_scenes.py` **extends** the retained `training/train-detector/scene.py`.
It composites full-card references onto black pads, felt, wood and printed-art
playmat negatives; uses existing sleeves, specular glare, blur, noise, compression,
projective tilt, rotation, piles/Xyz overlaps and procedural hands/arms. It keeps
native face-up/face-down/ignore classes and **14-column oriented-box/corner
labels**, rather than throwing away corner information for a new YOLO model.
Empty scenes are intentional negatives. These stylized hands do not replace
real negative clips. Alternate artworks of a card stay in the same synthetic
split (SHA256 of identity); real splits remain by session/camera.

```sh
# Small inspectable preview; no huge dataset required.
"$PY" scripts/vision/session/webcam_scenes.py \
  --out /mnt/d/VisionData/preview --count 32 --size 640 --seed 633
"$PY" scripts/vision/session/test_training.py
# Real throughput (30 steps); start with FP32, 2 frames × 4 windows/step.
"$PY" scripts/vision/session/train_webcam.py --training-dir "$VISION_TRAINING_DIR" \
  --run webcam-bench --bench --frames 2 --workers 2 --corner-act leaky
# Local fine-tune if a compatible original PyTorch checkpoint is available:
"$PY" scripts/vision/session/train_webcam.py --training-dir "$VISION_TRAINING_DIR" \
  --run webcam-detector --init /path/to/detector-last.pt --corner-act leaky \
  --steps 20000 --frames 2 --workers 2 --ckpt-min 15 --eval-min 60
```

`--init` is a **PyTorch state_dict checkpoint**, not the shipped ONNX file. The
repo does not include private upstream PyTorch checkpoints. Without one, omit
`--init` to train the same detector architecture from its ImageNet backbone;
that is retraining, not continuing the exact shipped weights, and likely needs
more steps. The launcher rejects missing ROCm instead of silently training on
CPU. Scene generation streams in loader workers; no 50k JPEG export is needed.
Native Windows spawning installs compositor hooks independently in each worker.
Do not set `--workers 0`: retained trainers require persistent workers.
`--amp` on the detector enables retained bf16 autocast; try only after a finite
loss/gradient check on this ROCm build. FP32 is the correctness baseline.

## DINOv2-S real-domain fine-tune

First collect and review the sessions and the existing explicit opt-in feedback
crops. Freeze a **test-session list before training**. Keep all frames of a
session/card track in one split; also hold out a camera/mat/light condition.
Export only admin-approved feedback with the existing command:

```sh
npx tsx scripts/vision/feedback.ts export --out /mnt/d/VisionData/approved-train-crops
```

That exports all approved samples; select a training-only source/database or
create and audit a filtered trainer `list.json` against the frozen session list
before using it. Never automatically train on the frozen test set. For session
crops, use the detector's perspective-correct card quad at reviewed times; audit
the warp before adding it to the same trainer list. An axis-aligned event box is
for evaluation/selection, not automatically a rectified training crop. Use known
card/alternate-art anchors, negatives (hands/pads/backs), and hard negatives
(same-art/lookalike archetypes), and balanced real/synthetic views. The retained
`synth.py` already generates sleeve/glare/foil/webcam damage on the fly.

```sh
"$PY" scripts/vision/session/train_embedder.py --training-dir "$VISION_TRAINING_DIR" \
  --run embedder-bench --bench --arch small --bs 16 --k 2 --workers 2 --amp none
"$PY" scripts/vision/session/train_embedder.py --training-dir "$VISION_TRAINING_DIR" \
  --run real-webcam --arch small --init /path/to/dinov2-synthetic-best.pt \
  --real /mnt/d/VisionData/approved-train-crops/list.json \
  --bs 16 --k 2 --real-bs 8 --real-neg 2 --workers 2 --amp none --steps 12000
```

With no compatible synthetic-duel `.pt`, omit `--init` and train from
`facebook/dinov2-small`; obtaining that pretrained base is a normal HF download
when the owner starts training. Do not describe this as continuation of the q8
ONNX weights. Distillation (`--kd-view/--kd-clean`) requires a compatible teacher
checkpoint. Start with frozen early blocks (retained default first trainable
block 4), low LR, and finite FP32 loss. Compare bf16 separately; avoid assuming
an unsupported fp16 path works on this card.

Export using existing detector/export.py and train/export.py tools described in
`scripts/vision/training/README.md`. Keep exports under the chosen training path.
For DINO, rebuild the catalog index with the same model/preprocessing, verify
native/WASM/WebGPU ranking parity, then recalibrate thresholds on validation
sessions. Only the frozen test benchmark can approve adoption. Models never
install themselves into the app.

## Time budget on this 24 GB card — estimates, not measurements

| Job | Proposed pilot | Planning range including evaluation |
| --- | --- | --- |
| Detector fine-tune | 20k steps, 2 frames × 4 640px windows, 2 workers | **6–16 hours** |
| DINOv2-S fine-tune | 12k steps, 16 synthetic anchors plus 8 real tracks, 224px views | **4–12 hours** |

Ranges assume an existing compatible checkpoint, working ROCm, enough data and
no competing GPU workload. They are estimates inferred from workload size, not
benchmarks of the 7900 XTX. Derive a local estimate from each trainer's `--bench`:
`hours = measured seconds/step × target steps / 3600`, plus 20–40% evaluation/I/O.
A new-from-ImageNet/HF run may need several times the steps. Keep batches modest;
24 GB is enough for the pilot but allocator fragmentation/driver versions matter.
Stop at the budget and compare held-out quality; hours alone prove nothing.
Local rental cost is **$0**, plus electricity. A rented 4090 would add hourly
rental charges; no rental or paid action is needed or included.

## Fallback: native Windows ROCm, then DirectML diagnostic

AMD lists RX 7900 XTX in its Windows matrix. Install Python 3.12 and the compatible
Windows driver, create a **separate venv** on D:, then use the exact ROCm SDK and
PyTorch wheels in [AMD's Windows pip instructions](https://rocm.docs.amd.com/projects/radeon-ryzen/en/docs-7.2.1/docs/install/installrad/windows/install-pytorch.html).
Run `python scripts/vision/session/check_gpu.py`; both training launchers use the
same HIP/cuda API and spawn-safe loader path. Use Windows paths for all data,
rerun training preparation in that environment, and run `--bench` before long
jobs. These native Windows full-model runs have not been validated here.

If ROCm cannot run, test GPU arithmetic in an independent DirectML environment:
`py -3.12 -m venv D:\VisionData\venv-dml`, activate it, then
`python -m pip install --no-cache-dir torch-directml`, followed by
`python scripts/vision/session/check_gpu.py --device directml`.
See [Microsoft's DirectML guide](https://learn.microsoft.com/en-us/windows/ai/directml/pytorch-windows).
This is a **setup diagnostic**, not a claim that the full retained trainers run
on DirectML: they use CUDA device selection and some DINO/AMP operations may need
porting. Prefer native Windows ROCm to make full local training practical.
