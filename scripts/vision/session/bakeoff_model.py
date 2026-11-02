"""Backbone adapters/export for bakeoff.py; never changes the retained loss.

Optional dependencies load only after the orchestrator has checked real data.
"""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys

from bakeoff import CANDIDATES, HERE, read_json, sha, write_json


def create_model(candidate):
    import torch
    from torch import nn
    from common import MEAN, STD

    class Adapter(nn.Module):
        def __init__(self):
            super().__init__()
            self.mobile = candidate.startswith('mobileclip')
            if self.mobile:
                import open_clip
                # Canonical OpenCLIP conversion of Apple's MobileCLIP2 weights.
                clip = open_clip.create_model('hf-hub:' + CANDIDATES[candidate])
                self.vit = clip.visual
                self.dim = int(clip.text_projection.shape[-1]) if hasattr(clip, 'text_projection') else 512
                del clip
                self.register_buffer('mean', torch.tensor(MEAN).view(1,3,1,1))
                self.register_buffer('std', torch.tensor(STD).view(1,3,1,1))
                self.revision = None
            else:
                from transformers import AutoModel
                self.vit = AutoModel.from_pretrained(CANDIDATES[candidate], attn_implementation='eager')
                self.dim = self.vit.config.hidden_size
                self.revision = getattr(self.vit.config, '_commit_hash', None)
                if candidate.startswith('dinov2'):
                    # Same fixed-position baking used by retained model.py.
                    emb = self.vit.embeddings
                    dummy = torch.zeros(1, 257, self.dim)
                    with torch.no_grad():
                        pos = emb.interpolate_pos_encoding(dummy, 224, 224)
                    emb.position_embeddings = nn.Parameter(pos.clone())
                    self.vit.config.image_size = 224

        def forward(self, x):
            if self.mobile:
                # Shared trainer input is ImageNet-normalized 224px. Apple uses
                # RGB [0,1] at 256px; put conversion in the export, too.
                x = x * self.std + self.mean
                x = torch.nn.functional.interpolate(x, size=(256,256), mode='bilinear', align_corners=False)
                return self.vit(x)
            return self.vit(pixel_values=x).pooler_output

    return Adapter()


def train_candidate(args):
    import torch
    import train

    if not torch.version.hip or not torch.cuda.is_available():
        raise RuntimeError('ROCm required')
    recipe = json.loads(args.recipe)
    if recipe['first'] != 0 or recipe['std'] != 0 or recipe['decay'] != 1:
        raise ValueError('Bake-off uses full backbone, no image standardization, uniform LR for all architectures')
    train.Embedder = lambda **_: create_model(args.candidate)
    train.freeze_until = lambda model, first: model.requires_grad_(True)

    def groups(model, lr, decay, wd):
        return [{'params': [p for p in model.parameters() if p.requires_grad and (p.ndim > 1) == matrix],
                 'lr': lr, 'base_lr': lr, 'weight_decay': wd if matrix else 0.0}
                for matrix in (True, False)]

    train.param_groups = groups
    dest = args.out / args.candidate
    dest.mkdir(parents=True, exist_ok=True)
    train.CKPT_DIR = dest
    train.LOGS = dest / 'logs'
    train.LOGS.mkdir(exist_ok=True)
    # Preserve only last/best, rather than filling disk with epoch snapshots.
    original_save = torch.save

    def save(state, file, *a, **kw):
        if any(not torch.isfinite(p).all() for p in state.values() if p.is_floating_point()):
            raise RuntimeError('Non-finite training checkpoint; stopping candidate')
        file = Path(file)
        if file.name.startswith('epoch'):
            file = file.with_name('last.pt')
        return original_save(state, file, *a, **kw)

    torch.save = save
    if not hasattr(os, 'nice'):
        os.nice = lambda _: 0
    argv = ['train.py', '--run', 'checkpoints', '--real', str(args.out/'real-train.json')]
    for key, value in recipe.items():
        argv += ['--'+key, str(value)]
    if args.init:
        argv += ['--init', str(args.init), '--arch', 'small']  # adapter owns architecture
    if args.bench:
        argv += ['--bench']
    sys.argv = argv
    train.main()  # Retained InfoNCE, real sampler, synthetic views, bank, schedule.


def export_candidate(args):
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from onnxconverter_common import float16
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
    from common import load_art_cache
    from model import to_input

    dest = args.out / args.candidate
    model = create_model(args.candidate).eval()
    checkpoint = dest / 'checkpoints/last.pt'  # Same exact step budget for every candidate.
    model.load_state_dict(torch.load(checkpoint, map_location='cpu', weights_only=True))
    probe = np.asarray(load_art_cache()[:8])
    x = to_input(probe[:1], 'cpu')
    fp32 = dest / 'model.fp32.onnx'
    with torch.no_grad():
        torch.onnx.export(model, (x,), str(fp32), input_names=['pixel_values'], output_names=['embedding'],
                          opset_version=17, dynamo=False, do_constant_folding=True)
    onnx.checker.check_model(str(fp32))
    quantizer = MatMulNBitsQuantizer(onnx.load(str(fp32)), bits=8, block_size=32, is_symmetric=True)
    quantizer.process()
    quantizer.model.save_model_to_file(str(dest/'model.q8.onnx'), use_external_data_format=False)
    graph = float16.convert_float_to_float16(onnx.load(str(fp32)), keep_io_types=True)
    onnx.save(graph, str(dest/'model.fp16.onnx'))
    # CPU ORT parity for FP32/q8; actual fp16 parity/rankings run in WebGPU.
    with torch.no_grad():
        expected = model(to_input(probe, 'cpu')).numpy()
    expected /= np.linalg.norm(expected, axis=1, keepdims=True)
    parity = {}
    for suffix, minimum in [('fp32', .999), ('q8', .98)]:
        session = ort.InferenceSession(str(dest/f'model.{suffix}.onnx'), providers=['CPUExecutionProvider'])
        actual = np.concatenate([session.run(None, {'pixel_values': to_input(p[None], 'cpu').numpy()})[0] for p in probe])
        actual /= np.linalg.norm(actual, axis=1, keepdims=True)
        cosine = float(np.min(np.sum(actual * expected, axis=1)))
        if not np.isfinite(actual).all() or cosine < minimum:
            raise RuntimeError(f'{suffix} export parity failed: min cosine {cosine}')
        parity[suffix] = cosine
    # Retain a tiny native probe for independent browser fp16/q8 parity.
    (dest/'probe.f32').write_bytes(expected.astype('<f4').tobytes())
    (dest/'probe.u8').write_bytes(probe.tobytes())
    licences = []
    if args.candidate.startswith('dinov3'):
        import urllib.request
        licence = dest / 'DINOv3-LICENSE.md'
        licence.write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/facebookresearch/dinov3/main/LICENSE.md', timeout=30).read())
        licences.append(licence.name)
    elif args.candidate.startswith('mobileclip'):
        import urllib.request
        licence = dest / 'MobileCLIP-LICENSE_MODELS'
        licence.write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/apple-aiml-research/ml-mobileclip/main/LICENSE_MODELS', timeout=30).read())
        licences.append(licence.name)
    info = {'id': args.candidate, 'source': CANDIDATES[args.candidate],
            'revision': model.revision, 'checkpointSha256': sha(checkpoint),
            'initialCheckpointSha256': sha(args.init) if args.init else None,
            'initialization': 'owner checkpoint' if args.init else 'HF pretrained (not shipped duel weights)',
            'parameters': sum(p.numel() for p in model.parameters()), 'dim': model.dim,
            'recipe': json.loads(args.recipe), 'parity': parity, 'licences': licences,
            'versions': {name: importlib.metadata.version(name) for name in
                         ['torch', 'torchvision', 'transformers', 'timm', 'open_clip_torch', 'onnx', 'onnxruntime', 'onnxconverter-common']},
            'exports': {s: {'file': f'{args.candidate}/model.{s}.onnx',
                            'bytes': (dest/f'model.{s}.onnx').stat().st_size,
                            'sha256': sha(dest/f'model.{s}.onnx')}
                        for s in ('fp32', 'q8', 'fp16')}}
    write_json(dest / 'model.json', info)
    print(json.dumps({'candidate': args.candidate, 'parameters': info['parameters'], 'parity': parity}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', choices=CANDIDATES, required=True)
    parser.add_argument('--training-dir', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--recipe', required=True)
    parser.add_argument('--init', type=Path)
    parser.add_argument('--bench', action='store_true')
    parser.add_argument('--train', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    os.environ['VISION_TRAINING_DIR'] = str(args.training_dir)
    sys.path.insert(0, str(HERE.parent / 'training/train'))
    if args.train:
        train_candidate(args)
    else:
        subprocess.run([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], '--train'], check=True)
        if not args.bench:
            export_candidate(args)


if __name__ == '__main__':
    main()
