import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openModelSession, type WebOrt, type WebRuntimeDeps } from './web-runtime';
import { gpuModelPaths } from './runtime';
import { checkImage, checkOutput, embeddingGpuCheck, type GpuCheck } from './gpu-check';
import { duelLensModel } from './models';
import { dinov2SmallDuelCheck } from './gpu-check-reference';
import { yugioh } from './games/yugioh';

const FP16 = 'models/m.fp16.onnx', FP32 = 'models/m.fp32.onnx', WASM = 'models/m.q8.onnx';
class Tensor { constructor(public type: string, public data: Float32Array, public dims: number[]) {} }
type Graph = 'fp16' | 'fp32' | 'wasm';

/** Fake ORT builds and a fake adapter. The bytes a graph is fetched as name it, and each graph answers with its own output vector. */
function rig(outputs: Partial<Record<Graph, number[]>>, { f16 = true, check = 'ok' as 'ok' | 'throws' | 'hangs' | 'none', paths = { gpuModelPath: FP16, gpuFp32ModelPath: FP32 } as Pick<WebRuntimeDeps, 'gpuModelPath' | 'gpuFp32ModelPath'> } = {}) {
  const log = { created: [] as Graph[], released: [] as Graph[], fetched: [] as string[], checks: 0, runs: [] as Graph[], hung: undefined as undefined | (() => void) };
  const ort = () => ({ env: { wasm: {} }, Tensor, InferenceSession: { create: async (bytes: Uint8Array) => {
    const graph: Graph = bytes[0] === 16 ? 'fp16' : bytes[0] === 32 ? 'fp32' : 'wasm';
    log.created.push(graph);
    return {
      release: async () => { log.released.push(graph); },
      run: async () => {
        log.runs.push(graph);
        if (graph === 'fp16' && check === 'hangs' && log.checks > 0 && !log.hung) await new Promise<void>(resolve => { log.hung = resolve; });
        return { vector: { data: new Float32Array(outputs[graph] ?? [1, 0]), dims: [1, 2] } };
      },
    };
  } } } as unknown as WebOrt);
  const gpuCheck: GpuCheck | undefined = check === 'none' ? undefined : {
    reference: [1, 0], minCosine: .99,
    output: async (session, T) => {
      log.checks++;
      if (check === 'throws') throw new Error('shader exploded');
      return (await session.run({ input: new T('float32', new Float32Array([1]), [1]) })).vector!.data;
    },
  };
  const deps: WebRuntimeDeps = {
    ort: ort(), ortWebGpu: async () => gpuOrt, ...paths, gpuCheck, getURL: path => path, webgpuTimeouts: { firstRunMs: 50 },
    gpu: { requestAdapter: async () => ({ info: { vendor: 'test-gpu' }, features: new Set(f16 ? ['shader-f16'] : []) }) },
    fetch: async input => { const url = String(input); log.fetched.push(url); return new Response(new Uint8Array([url.includes('fp16') ? 16 : url.includes('fp32') ? 32 : 0])); },
  };
  const gpuOrt = ort();
  const open = () => openModelSession(WASM, 'test-model', deps);
  return { log, open };
}
const quiet = (t: TestContext) => { t.mock.method(console, 'debug', () => {}); t.mock.method(console, 'warn', () => {}); };

test('the card detector offers one WebGPU graph, float32, and it runs on adapters with or without shader-f16', async t => {
  quiet(t);
  const { detector, embedding } = yugioh;
  assert.deepEqual(detector.webgpu, { url: '/dev/vision-assets/models/card-detector.fp32.onnx', sha256: '5948f408853496a5ab5697506e76fd05feef10ec6cf8c19432f0936972fa87ca', precision: 'fp32' });
  assert.ok(!JSON.stringify(detector).includes('fp16'), 'no fp16 detector graph anywhere in the spec');
  assert.deepEqual(gpuModelPaths(detector.webgpu), { gpuFp32ModelPath: detector.webgpu!.url });
  // The embedder keeps its fp16 graph (now output-checked) with the fp32 alternative.
  assert.deepEqual(gpuModelPaths(embedding.webgpu), { gpuModelPath: embedding.webgpu!.url, gpuFp32ModelPath: embedding.webgpu!.fp32!.url });
  for (const f16 of [true, false]) {
    const { log, open } = rig({}, { f16, check: 'none', paths: gpuModelPaths(detector.webgpu) });
    const { session } = await open();
    assert.equal(session.ep, 'webgpu', `shader-f16 ${f16}`);
    assert.deepEqual(log.fetched, [detector.webgpu!.url]);
    assert.equal(session.gpuDiagnostics?.modelPath, detector.webgpu!.url);
  }
});

test('an fp16 session whose check output disagrees is replaced by the fp32 graph, and the attempt says why', async t => {
  quiet(t);
  const { log, open } = rig({ fp16: [0.1, 0.99], fp32: [0, 1] });
  const { session } = await open();
  assert.equal(session.ep, 'webgpu');
  assert.deepEqual(log.created, ['fp16', 'fp32']);
  assert.deepEqual(log.released, ['fp16']);
  assert.equal(log.checks, 1);
  assert.equal(session.gpuDiagnostics?.modelPath, FP32);
  assert.ok(session.gpuDiagnostics!.attempts.some(a => a.startsWith(`${FP16}: output check failed: cosine 0.1005 with the float32 reference`) && a.endsWith('use float32 WebGPU')), session.gpuDiagnostics!.attempts.join(' | '));
  assert.ok(session.gpuDiagnostics!.attempts.includes(`${FP32}: WebGPU session created`));
  // Real requests go to the fp32 session and are not checked again.
  const out = await session.run({ input: new Tensor('float32', new Float32Array([1]), [1]) });
  assert.deepEqual(Array.from(out.vector!.data), [0, 1]);
  assert.deepEqual(log.runs, ['fp16', 'fp32']);
  assert.equal(log.checks, 1);
});

test('an fp16 session whose check output agrees stays on fp16, and the check runs once per open, not per request', async t => {
  quiet(t);
  const { log, open } = rig({ fp16: [0.999, 0.04472] });
  const { session } = await open();
  assert.equal(session.ep, 'webgpu');
  assert.deepEqual(log.created, ['fp16']);
  assert.equal(session.gpuDiagnostics?.modelPath, FP16);
  assert.ok(session.gpuDiagnostics!.attempts.some(a => a.startsWith(`${FP16}: output check passed (cosine 0.99`)), session.gpuDiagnostics!.attempts.join(' | '));
  assert.deepEqual(log.fetched, [FP16]);
  const feeds = { input: new Tensor('float32', new Float32Array([1]), [1]) };
  await session.run(feeds); await session.run(feeds);
  assert.equal(log.checks, 1);
  assert.deepEqual(log.runs, ['fp16', 'fp16', 'fp16']);
  assert.deepEqual(log.released, []);
});

test('a check that throws, returns a non-finite value or has the wrong length falls back to fp32', async t => {
  quiet(t);
  const thrown = rig({ fp32: [1, 0] }, { check: 'throws' });
  const { session } = await thrown.open();
  assert.equal(session.ep, 'webgpu');
  assert.deepEqual(thrown.log.created, ['fp16', 'fp32']);
  assert.deepEqual(thrown.log.released, ['fp16']);
  assert.equal(session.gpuDiagnostics?.modelPath, FP32);
  assert.ok(session.gpuDiagnostics!.attempts.some(a => a.includes('output check failed: the check run failed with shader exploded; use float32 WebGPU')), session.gpuDiagnostics!.attempts.join(' | '));
  for (const [bad, why] of [[[NaN, 1], 'a value that is not finite'], [[1, Infinity], 'a value that is not finite'], [[1], '1 values, expected 2']] as const) {
    const { log, open } = rig({ fp16: [...bad], fp32: [1, 0] });
    const { session: s } = await open();
    assert.equal(s.gpuDiagnostics?.modelPath, FP32, why);
    assert.deepEqual(log.released, ['fp16']);
    assert.ok(s.gpuDiagnostics!.attempts.some(a => a.includes(why)), s.gpuDiagnostics!.attempts.join(' | '));
  }
});

test('with no float32 alternative to fall back to, a failed check sends the model to WASM', async t => {
  quiet(t);
  const { log, open } = rig({ fp16: [0, 1] }, { paths: { gpuModelPath: FP16 } });
  const { session } = await open();
  assert.equal(session.ep, 'wasm');
  assert.deepEqual(log.released, ['fp16']);
  assert.match(session.fallbackReason ?? '', /output check failed/);
});

test('a check run that never returns drops WebGPU for WASM and keeps the fp16 session until that run does', async t => {
  quiet(t);
  const { log, open } = rig({ fp32: [1, 0] }, { check: 'hangs' });
  const { session } = await open();
  assert.equal(session.ep, 'wasm');
  assert.deepEqual(log.created, ['fp16', 'wasm'], 'a stuck runtime creates no float32 session');
  assert.deepEqual(log.released, [], 'released only once its run comes back');
  assert.ok(session.gpuDiagnostics!.attempts.some(a => a.includes(`checking ${FP16} took over 50 ms`)), session.gpuDiagnostics!.attempts.join(' | '));
  log.hung!();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(log.released, ['fp16']);
});

test('neither the fp32 graph nor an adapter without shader-f16 is checked', async t => {
  quiet(t);
  const { log, open } = rig({ fp32: [0, 1] }, { f16: false });
  const { session } = await open();
  assert.equal(session.ep, 'webgpu');
  assert.deepEqual(log.created, ['fp32']);
  assert.equal(log.checks, 0);
});

test('checkOutput: cosine against the reference, any scale, finite values only', () => {
  const reference = [0.6, 0.8];
  assert.equal(checkOutput([3, 4], { reference, minCosine: .99 }).ok, true);
  assert.equal(checkOutput([0.8, 0.6], { reference, minCosine: .99 }).ok, false);
  assert.equal(checkOutput([-0.6, -0.8], { reference, minCosine: .99 }).ok, false);
  assert.equal(checkOutput([0, 0], { reference, minCosine: .99 }).ok, false);
  assert.equal(checkOutput([0.6, NaN], { reference, minCosine: .99 }).ok, false);
  assert.match(checkOutput([0.8, 0.6], { reference, minCosine: .99 }).note, /cosine 0\.9600 with the float32 reference/);
});

test('the embedder check feeds the production input for a fixed picture and compares the vector it gets', async () => {
  const check = embeddingGpuCheck(duelLensModel)!;
  assert.ok(check);
  const fed: { name: string; data: Float32Array; dims: number[] }[] = [];
  const respond = (vector: Float32Array) => ({ run: async (feeds: Record<string, unknown>) => {
    const [name, tensor] = Object.entries(feeds)[0] as [string, Tensor];
    fed.push({ name, data: tensor.data, dims: tensor.dims });
    return { [duelLensModel.outputName]: { data: vector, dims: [1, vector.length] } };
  } });
  const reference = Float32Array.from(duelLensModel.gpuCheck!.reference);
  const good = await check.output(respond(reference), Tensor as never);
  assert.equal(checkOutput(good, check).ok, true);
  const flipped = await check.output(respond(reference.map(v => -v)), Tensor as never);
  assert.equal(checkOutput(flipped, check).ok, false);
  assert.equal(fed.length, 2);
  assert.equal(fed[0].name, 'pixel_values');
  assert.deepEqual(fed[0].dims, [1, 3, 224, 224]);
  assert.ok(fed[0].data.every(Number.isFinite));
  assert.deepEqual(fed[1].data, fed[0].data, 'the same input every time');
  assert.equal(embeddingGpuCheck({ ...duelLensModel, gpuCheck: undefined }), undefined);
});

test('the check picture is fixed, and a different seed gives a different one', () => {
  const sha = (seed?: number) => createHash('sha256').update(checkImage(224, seed).data).digest('hex');
  assert.equal(sha(), sha());
  assert.notEqual(sha(), sha(1));
  // Pinned: a change here means the stored reference must be made again (scripts/vision/gpu-check-reference.ts).
  assert.equal(sha(), '8a4aa9878db1d24b66c6e4a0e8ed91499e36224fc86b5cd8c27140b8b8dc5976');
});

test('the stored reference belongs to the pinned float32 embedder and is a unit vector of the right size', () => {
  const { reference, minCosine } = duelLensModel.gpuCheck!;
  assert.equal(dinov2SmallDuelCheck.fp32Sha256, duelLensModel.webgpu!.fp32!.sha256);
  assert.equal(reference.length, duelLensModel.dim);
  assert.ok(Math.abs(Math.hypot(...reference) - 1) < 1e-5);
  assert.ok(reference.every(Number.isFinite));
  assert.ok(minCosine >= .95 && minCosine < 1);
});
