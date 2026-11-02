"""Fine-tune the existing CenterNet/MobileNetV3 on local webcam scenes, ROCm.

PyTorch ROCm exposes AMD through torch.cuda (including native Windows ROCm).
No drivers/packages installed, no paid services, no scene JPEG corpus required.
Use --bench before a full run. Arguments after this launcher's flags go to the
existing trainer: --run NAME --minutes 480 --frames 2 --workers 2 --init FILE.
"""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import sys

from webcam_scenes import DETECTOR, assets, load_scene, render_frame


class WebcamWindows:
    """Spawn-safe scene dataset; hooks are installed in EACH loader worker."""
    def __init__(self, seed, split='train', per_frame=4, spreads=True, close_p=0.):
        self.seed, self.split, self.per_frame = seed, split, per_frame
        self.spreads, self.A = spreads, None

    def __len__(self):
        return 1 << 30

    def __getitem__(self, i):
        import numpy as np
        import torch
        from targets import build
        scene = load_scene()
        if self.A is None:
            self.A = assets(self.split)
        rng = np.random.default_rng([self.seed, i])
        image, objects, _ = render_frame(self.A, rng, spreads=self.spreads)
        cards = [o for o in objects if o.cls != scene.IGNORE and o.visible > .6]
        xs, ts = [], []
        for _ in range(self.per_frame):
            u = rng.random()
            focus = cards[int(rng.integers(len(cards)))] if cards and u < .75 else None
            win, rows = scene.drag_crop(image, objects, rng, focus, 640) if focus is not None and u < .25 else scene.window(image, objects, rng, 640, focus)
            heat, reg, regw, ign = build(rows, (640, 640))
            xs.append(win)
            ts.append(np.concatenate([heat, reg, regw[None], ign[None]], 0))
        return torch.from_numpy(np.stack(xs)), torch.from_numpy(np.stack(ts).astype(np.float16))


def main():
    p = argparse.ArgumentParser(description=__doc__, add_help=False)
    p.add_argument('--help', action='store_true')
    p.add_argument('--training-dir', type=Path, default=os.environ.get('VISION_TRAINING_DIR'))
    own, forwarded = p.parse_known_args()
    if own.help:
        p.print_help()
        return
    if '--close-p' in forwarded or '--no-spreads' in forwarded:
        p.error('--close-p/--no-spreads are broadcast-scene controls; webcam scenes do not implement them')
    if not own.training_dir:
        p.error('Choose --training-dir (prefer /mnt/d/vision-training); no checkpoints on the default WSL disk')
    os.environ['VISION_TRAINING_DIR'] = str(own.training_dir.resolve())
    import torch
    if not torch.version.hip or not torch.cuda.is_available():
        raise RuntimeError('A working PyTorch ROCm GPU is required. Run check_gpu.py first.')
    if not (own.training_dir / 'profile.json').exists():
        raise RuntimeError('Run prepare-training.ts with VISION_TRAINING_DIR set to this path first')
    if '--workers' not in forwarded:
        forwarded += ['--workers', '2']
    scene = load_scene()
    scene.Assets, scene.render_frame = assets, render_frame
    sys.path.insert(0, str(DETECTOR))
    import train
    train.Windows = WebcamWindows
    sys.argv = [str(DETECTOR / 'train.py'), *forwarded]
    print(f'GPU: {torch.cuda.get_device_name(0)}; HIP {torch.version.hip}; checkpoints: {own.training_dir}', flush=True)
    train.main()


if __name__ == '__main__':
    main()
