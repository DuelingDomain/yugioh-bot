#!/usr/bin/env python3
"""Acquire a frozen DINOv3 ViT-S/16 q8 graph. No training; private token required.

Dependencies (only needed after access is configured):
  pip install huggingface-hub onnx onnxruntime numpy
Fallback export also needs: pip install torch transformers
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

SOURCE = 'facebook/dinov3-vits16-pretrain-lvd1689m'
ONNX_SOURCE = 'onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX'
OWNER_ACTION = (f'Accept the licence at https://huggingface.co/{SOURCE}, then put '
                'HF_TOKEN=... in ~/.config/yugioh-vision/bakeoff.env '
                '(a read token with access to the gated model; chmod 600).')


def token_from_file(path):
    if not path.is_file():
        raise RuntimeError('HF_TOKEN file is missing. ' + OWNER_ACTION)
    for line in path.read_text().splitlines():
        key, sep, value = line.strip().removeprefix('export ').partition('=')
        if key.strip() == 'HF_TOKEN' and sep:
            value = value.strip().strip('\"\'')
            if value and not value.startswith('#'):
                return value
    raise RuntimeError('HF_TOKEN is missing or empty. ' + OWNER_ACTION)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--data', type=Path, default=Path(os.environ.get('VISION_DATA_DIR', 'data/vision')))
    ap.add_argument('--env-file', type=Path, default=Path.home()/'.config/yugioh-vision/bakeoff.env')
    ap.add_argument('--keep-fp32', action='store_true', help='Also retain an optional WebGPU fp32 graph')
    args = ap.parse_args()
    token = token_from_file(args.env_file)  # Before imports, downloads, or caches; never print token.
    print('HF_TOKEN: present (value hidden)', flush=True)
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
    import numpy as np
    import onnx
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download, model_info
    from huggingface_hub.errors import HfHubHTTPError

    out = args.data.resolve()/'models'
    out.mkdir(parents=True, exist_ok=True)
    # All HF snapshots and external tensor files disappear when this command exits.
    with tempfile.TemporaryDirectory(prefix='dinov3-', dir=out) as tmp:
        cache = Path(tmp)

        def get(repo, name, revision):
            try:
                return Path(hf_hub_download(repo, name, revision=revision, token=token, cache_dir=cache))
            except HfHubHTTPError as e:
                if e.response is not None and e.response.status_code in (401, 403):
                    raise PermissionError('Hugging Face access denied. ' + OWNER_ACTION) from None
                raise

        def info_for(repo):
            try:
                return model_info(repo, token=token)
            except HfHubHTTPError as e:
                if e.response is not None and e.response.status_code in (401, 403):
                    raise PermissionError('Hugging Face access denied. ' + OWNER_ACTION) from None
                raise

        # Access verification never asks for, logs or stores the token in the repo.
        upstream = info_for(SOURCE)
        get(SOURCE, 'config.json', upstream.sha)
        revision = None
        try:
            info = info_for(ONNX_SOURCE)
            revision = info.sha
            config = json.loads(get(ONNX_SOURCE, 'config.json', revision).read_text())
            if config.get('hidden_size') != 384 or config.get('patch_size') != 16:
                raise ValueError('Unexpected ONNX community architecture')
            graph_path = get(ONNX_SOURCE, 'onnx/model_quantized.onnx', revision)
            names = {s.rfilename for s in info.siblings}
            if 'onnx/model_quantized.onnx_data' in names:
                get(ONNX_SOURCE, 'onnx/model_quantized.onnx_data', revision)
            graph = onnx.load(str(graph_path))
            onnx.save_model(graph, str(cache/'q8.onnx'), save_as_external_data=False)
            if args.keep_fp32:
                fp = get(ONNX_SOURCE, 'onnx/model.onnx', revision)
                if 'onnx/model.onnx_data' in names:
                    get(ONNX_SOURCE, 'onnx/model.onnx_data', revision)
                onnx.save_model(onnx.load(str(fp)), str(cache/'fp32.onnx'), save_as_external_data=False)
            origin = ONNX_SOURCE
        except PermissionError:
            raise
        except Exception as e:
            # No secret-bearing exception text; fall back only for export/availability issues.
            print(f'Community ONNX unavailable ({type(e).__name__}); exporting pretrained Meta weights on CPU.', flush=True)
            import torch
            from transformers import AutoModel
            from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
            torch.set_num_threads(len(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else os.cpu_count())
            # Force the same temporary cache; no fine-tuning or remote code execution.
            model = AutoModel.from_pretrained(SOURCE, revision=upstream.sha, token=token,
                                             cache_dir=cache, attn_implementation='eager').eval().cpu()

            class Pooled(torch.nn.Module):
                def __init__(self, backbone):
                    super().__init__()
                    self.backbone = backbone

                def forward(self, pixel_values):
                    return self.backbone(pixel_values=pixel_values).pooler_output

            wrapper = Pooled(model).eval()
            probe = torch.zeros(1, 3, 224, 224)
            with torch.inference_mode():
                expected = wrapper(probe).numpy()
                torch.onnx.export(wrapper, (probe,), str(cache/'fp32.onnx'),
                                  input_names=['pixel_values'], output_names=['embedding'],
                                  opset_version=17, dynamo=False, do_constant_folding=True)
            quantizer = MatMulNBitsQuantizer(onnx.load(str(cache/'fp32.onnx')),
                                           bits=8, block_size=32, is_symmetric=True)
            quantizer.process()
            quantizer.model.save_model_to_file(str(cache/'q8.onnx'), use_external_data_format=False)
            revision, origin = upstream.sha, SOURCE
            del model, wrapper

        graph = onnx.load(str(cache/'q8.onnx'))
        onnx.checker.check_model(graph)
        if any(t.data_location == onnx.TensorProto.EXTERNAL for t in graph.graph.initializer):
            raise RuntimeError('q8 graph still requires external data')
        if not any(n.op_type in ('MatMulNBits', 'MatMulInteger', 'QLinearMatMul', 'DynamicQuantizeLinear') for n in graph.graph.node):
            raise RuntimeError('Downloaded graph is not a quantized model')
        outputs = {o.name: len(o.type.tensor_type.shape.dim) for o in graph.graph.output}
        output = next((n for n in ('embedding', 'pooler_output', 'last_hidden_state') if n in outputs), None)
        if output is None:
            raise RuntimeError('No supported embedding output in ONNX graph')
        session = ort.InferenceSession(str(cache/'q8.onnx'), providers=['CPUExecutionProvider'])
        probe = np.zeros((1, 3, 224, 224), dtype=np.float32)
        actual = session.run([output], {'pixel_values': probe})[0]
        if outputs[output] == 3:
            actual = actual[:, 0, :]
        if actual.shape != (1, 384) or not np.isfinite(actual).all() or np.linalg.norm(actual) == 0:
            raise RuntimeError('q8 graph smoke failed')
        if 'expected' in locals():
            cosine = float(np.sum(actual * expected) / (np.linalg.norm(actual)*np.linalg.norm(expected)))
            if cosine < .98:
                raise RuntimeError(f'q8 export parity failed: {cosine:.6f}')
        del session
        # Retained verbatim from facebookresearch/dinov3/LICENSE.md, beside the weights.
        licence = Path(__file__).resolve().parents[2]/'packages/vision/src/licenses/dinov3.LICENSE.md'
        shutil.copyfile(licence, out/'DINOv3-LICENSE.md')
        model_path = out/'dinov3-small.q8.onnx'
        shutil.copyfile(cache/'q8.onnx', model_path.with_suffix('.onnx.part'))
        model_path.with_suffix('.onnx.part').replace(model_path)
        spec = dict(id='dinov3-small', url='/dev/vision-assets/models/dinov3-small.q8.onnx',
                    sha256=hashlib.sha256(model_path.read_bytes()).hexdigest(), inputSize=224, dim=384,
                    inputName='pixel_values', outputName=output, pooling='cls' if outputs[output] == 3 else 'none',
                    maxBatch=1, mean=[.485, .456, .406], std=[.229, .224, .225],
                    thresholds=dict(score=.8, margin=.02, floor=.74, cardBackMargin=.1))
        if args.keep_fp32 and (cache/'fp32.onnx').exists():
            shutil.copyfile(cache/'fp32.onnx', out/'dinov3-small.fp32.onnx')
        (out/'dinov3-small.source.json').write_text(json.dumps(dict(source=origin, revision=revision,
            pretrained=True, fineTuned=False, licence='DINOv3-LICENSE.md', wasmSmoke='pending browser comparison'), indent=2)+'\n')
        manifest = out/'dinov3-small.json'
        manifest.with_suffix('.json.part').write_text(json.dumps(spec, indent=2)+'\n')
        manifest.with_suffix('.json.part').replace(manifest)
        print(f'DINOv3 q8 prepared: {model_path.stat().st_size/1e6:.1f} MB; licence included. Build the v3 index next.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, PermissionError) as e:
        print(str(e), file=sys.stderr)
        sys.exit(2)
    except ImportError:
        print('Install the dependencies listed in prepare-dinov3.py into a Python virtualenv.', file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        # HF exceptions may contain request details; never dump credentials or tracebacks.
        status = getattr(getattr(e, 'response', None), 'status_code', None)
        print(('Hugging Face access denied. '+OWNER_ACTION) if status in (401, 403) else
              f'DINOv3 preparation failed ({type(e).__name__}); no model is ready.', file=sys.stderr)
        sys.exit(2 if status in (401, 403) else 1)
