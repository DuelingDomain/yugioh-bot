"""Local DINOv2-S InfoNCE fine-tune with the retained Duel Lens trainer on ROCm.

Arguments after --training-dir go to train.py, e.g. --run real-webcam --init
/path/to/synthetic-best.pt --real /path/to/train-only/list.json --bs 16 --k 2
--real-bs 8 --workers 2 --amp none --minutes 360. --bench measures real step time.
Native Windows ROCm is supported; DirectML is a diagnostic fallback only.
"""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import sys


def main():
    p = argparse.ArgumentParser(description=__doc__, add_help=False)
    p.add_argument('--help', action='store_true')
    p.add_argument('--training-dir', type=Path, default=os.environ.get('VISION_TRAINING_DIR'))
    own, forwarded = p.parse_known_args()
    if own.help:
        p.print_help()
        return
    if not own.training_dir:
        p.error('Choose --training-dir; prefer a Windows drive with enough space')
    os.environ['VISION_TRAINING_DIR'] = str(own.training_dir.resolve())
    import torch
    if not torch.version.hip or not torch.cuda.is_available():
        raise RuntimeError('A working PyTorch ROCm GPU is required. Run check_gpu.py first.')
    if not hasattr(os, 'nice'):
        os.nice = lambda _: 0  # Unix niceness is optional on native Windows.
    if '--amp' not in forwarded:
        forwarded += ['--amp', 'none']  # Correctness baseline; enable bf16 only after a finite-loss bench.
    if '--workers' not in forwarded:
        forwarded += ['--workers', '2']
    trainer = Path(__file__).resolve().parents[1] / 'training/train'
    sys.path.insert(0, str(trainer))
    import train
    sys.argv = [str(trainer / 'train.py'), *forwarded]
    print(f'GPU: {torch.cuda.get_device_name(0)}; HIP {torch.version.hip}; outputs: {own.training_dir}', flush=True)
    train.main()


if __name__ == '__main__':
    main()
