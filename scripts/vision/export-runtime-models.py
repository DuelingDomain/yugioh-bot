"""Offline fp16 exports from the pinned shipped graphs; no checkpoints/downloads.

python export-runtime-models.py --data data/vision [--qdq] [--simd]
Requires onnx==1.23.2, onnxruntime==1.31.1, numpy==2.4.6 (wasmtime for --simd).
First run: npx tsx scripts/vision/model-inputs.ts
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import onnx
import onnxruntime as ort
from onnx import helper, numpy_helper
from onnxruntime.transformers.float16 import convert_float_to_float16


def dequantize(model):
    """MatMulNBits uint8 block32 weights -> identical float32 MatMul weights.

    ORT contract: implicit symmetric uint8 zero point is 128, layout [N,K/block,block].
    Reject unfamiliar layouts instead of silently exporting incompatible weights.
    """
    initial = {v.name: numpy_helper.to_array(v) for v in model.graph.initializer}
    for node in model.graph.node:
        if node.op_type != 'MatMulNBits':
            continue
        attrs = {a.name: helper.get_attribute_value(a) for a in node.attribute}
        assert attrs['bits'] == 8 and len(node.input) == 3, 'Unsupported quantized graph'
        n, k, block = attrs['N'], attrs['K'], attrs['block_size']
        weights = initial[node.input[1]].reshape(n, -1, block).astype(np.float32)
        scales = initial[node.input[2]].reshape(n, -1, 1)
        weights = ((weights - 128) * scales).reshape(n, -1)[:, :k].T.copy()
        name = node.input[1] + '_float'
        model.graph.initializer.append(numpy_helper.from_array(weights, name))
        node.op_type = 'MatMul'
        node.domain = ''
        del node.attribute[:]
        del node.input[1:]
        node.input.append(name)
    used = {i for n in model.graph.node for i in n.input}
    keep = [i for i in model.graph.initializer if i.name in used]
    del model.graph.initializer[:]
    model.graph.initializer.extend(keep)
    return model


def fold_weight_casts(model):
    # The shipped detector stores fp16 weights behind float32 Casts. Fold only
    # constant casts so the QDQ exporter sees weights, not activation tensors.
    initial = {v.name: v for v in model.graph.initializer}
    nodes = []
    for node in model.graph.node:
        if node.op_type == 'Cast' and node.input[0] in initial:
            dtype = next(a.i for a in node.attribute if a.name == 'to')
            value = numpy_helper.to_array(initial[node.input[0]]).astype(helper.tensor_dtype_to_np_dtype(dtype))
            tensor = numpy_helper.from_array(value, node.output[0])
            model.graph.initializer.append(tensor)
            initial[tensor.name] = tensor
        else:
            nodes.append(node)
    del model.graph.node[:]
    model.graph.node.extend(nodes)
    used = {i for n in nodes for i in n.input}
    keep = [i for i in model.graph.initializer if i.name in used]
    del model.graph.initializer[:]
    model.graph.initializer.extend(keep)
    return model


def session(model):
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 2
    return ort.InferenceSession(model if isinstance(model, str) else model.SerializeToString(), opts, providers=['CPUExecutionProvider'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default='data/vision')
    parser.add_argument('--qdq', action='store_true')
    parser.add_argument('--simd', action='store_true')
    parser.add_argument('--export-only', action='store_true', help='Reproduce already-validated pinned artifacts without the benchmark corpus')
    args = parser.parse_args()
    if args.simd:
        import wasmtime
        root = Path(__file__).resolve().parents[2] / 'packages/vision/src'
        binary = wasmtime.wat2wasm((root / 'search-simd.wat').read_text())
        (root / 'search-simd-bytes.ts').write_text('// Generated from search-simd.wat by scripts/vision/export-runtime-models.py --simd.\nexport const searchSimdBytes=new Uint8Array([' + ','.join(map(str, binary)) + ']);\n')
        return
    data = Path(args.data)
    inputs = data / 'model-inputs'
    manifest = {'embed': [], 'detect': []} if args.export_only else json.loads((inputs / 'manifest.json').read_text())
    models = data / 'models'
    report = {'runtime': ort.__version__, 'provider': 'CPUExecutionProvider', 'note': 'Native CPU parity, not a WebGPU execution/performance claim.'}
    for name, corpus, input_name in [('dinov2-small-duel.q8', 'embed', 'pixel_values'), ('card-detector', 'detect', 'image')]:
        source = models / f'{name}.onnx'
        expected={'embed':'02d9720530ff488397ad7db66423199dbd7a406b264b866eb695cdc59c638bee','detect':'542a03b523cb1398a1b5437dae665908b3bdf61be9b30a2a52e7bcea25dce03c'}
        assert hashlib.sha256(source.read_bytes()).hexdigest()==expected[corpus], 'Source model checksum mismatch'
        original = fold_weight_casts(onnx.load(source))
        if corpus == 'embed':
            original = dequantize(original)
        converted = convert_float_to_float16(original, keep_io_types=True)
        # ORT's converter appends graph IO casts; order them before their consumers.
        available = {v.name for v in converted.graph.input} | {v.name for v in converted.graph.initializer} | {''}
        pending, ordered = list(converted.graph.node), []
        while pending:
            ready = [n for n in pending if all(i in available for i in n.input)]
            assert ready, 'Converted graph has unresolved dependencies'
            for node in ready:
                pending.remove(node)
                ordered.append(node)
                available.update(node.output)
        del converted.graph.node[:]
        converted.graph.node.extend(ordered)
        onnx.checker.check_model(converted)
        destination = models / ('dinov2-small-duel.fp16.onnx' if corpus == 'embed' else 'card-detector.fp16.onnx')
        onnx.save(converted, destination)
        if args.export_only:
            print(f'Exported {destination}; caller must verify its pinned SHA256.', flush=True)
            continue
        before, after = session(str(source)), session(str(destination))
        cosines, max_delta = [], 0.0
        for row in manifest[corpus]:
            x = np.fromfile(inputs / row['file'], np.float32).reshape(row['shape'])
            a, b = before.run(None, {input_name: x}), after.run(None, {input_name: x})
            for av, bv in zip(a, b):
                av, bv = av.ravel().astype(np.float64), bv.ravel().astype(np.float64)
                cosine = np.dot(av, bv) / max(1e-12, np.linalg.norm(av) * np.linalg.norm(bv))
                cosines.append(float(cosine))
                max_delta = max(max_delta, float(np.max(np.abs(av - bv))))
        assert min(cosines) >= .995, f'{name}: parity gate failed: {min(cosines)}'
        report[corpus] = {'file': destination.name, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'bytes': destination.stat().st_size, 'samples': len(manifest[corpus]), 'minimumCosine': min(cosines), 'maxAbsoluteDelta': max_delta}
        print(corpus, report[corpus], flush=True)
    if args.export_only:
        return
    (models / 'variants.json').write_text(json.dumps(report, indent=2) + '\n')
    if args.qdq:
        from onnxruntime.quantization import CalibrationDataReader, QuantType, QuantFormat, quantize_static
        class Reader(CalibrationDataReader):
            def __init__(self):
                self.rows = iter(manifest['detect'][::2])
            def get_next(self):
                row = next(self.rows, None)
                return {'image': np.fromfile(inputs / row['file'], np.float32).reshape(row['shape'])} if row else None
        folded = models / 'card-detector.folded.onnx'
        onnx.save(onnx.shape_inference.infer_shapes(fold_weight_casts(onnx.load(models / 'card-detector.onnx'))), folded)
        quantize_static(str(folded), str(models / 'card-detector.qdq.onnx'), Reader(), quant_format=QuantFormat.QDQ, activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=['Conv'])
        folded.unlink()
        print('QDQ exported; must pass held-out decoded recall AND browser WASM speed before use.', flush=True)


if __name__ == '__main__':
    main()
