/** Picks the card reader for the recording tools (replay-recording.ts, harvest-labels.ts). Offline use only: nothing here is wired into the app.
 *  --recognizer current          the reader the app ships (default): data/vision models + yugioh-index.
 *  --recognizer <name>           data/vision/recognizers/<name>.json
 *  --recognizer path/spec.json   a spec file (paths inside it are relative to the spec file)
 *  Spec, kind "ddindex" (our detector + RecognitionPipeline with another embedder and index built for it; input size, mean/std, dim, pooling
 *  and tensor names come from the index meta's layoutKey unless "input" overrides them):
 *    { "name": "light", "embedder": "m.onnx", "index": "idx.bin", "meta": "idx.meta.json", "detector": "optional.onnx", "input": { "size": 224 }, "thresholds": { "score": .8, "margin": .02, "floor": .74 } }
 *  Spec, kind "whole-card-bank" (whole-card warp, one fp16 vector bank, margin against the best OTHER card name; the DuelSight layout):
 *    { "name": "duelsight", "kind": "whole-card-bank", "embedder": "recognizer.onnx", "bank": "bank.json", "catalog": "catalog.json",
 *      "input": { "size": 128, "inputName": "crops", "outputName": "embeddings", "mean": [.5,.5,.5], "std": [.5,.5,.5] }, "thresholds": { "score": .68, "margin": .06 } }
 *  bank.json = { dim, entries: [{ cardId, vec: <base64 fp16 little endian> }] }, catalog.json = { cards: [{ id, name }] }. */
import { access, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import { detectScene } from '../../packages/vision/src/detect-scene';
import { warpQuadMasked } from '../../packages/vision/src/truncation';
import type { FieldWatcherOptions } from '../../packages/vision/src/field-watcher';
import type { RGBAImage } from '../../packages/vision/src/pixels';
import type { ModelSession } from '../../packages/vision/src/runtime';
import type { TensorCtor } from '../../packages/vision/src/embed';
import type { Candidate, ConfidenceThresholds, EmbeddingModelSpec, GameProfile, IndexMeta, LoadedIndex, RecognitionResult } from '../../packages/vision/src/types';
import { defaultDataDir, loadNodeRecognizer } from './clip-node';

export interface RecognizerInput { size?: number; mean?: [number, number, number]; std?: [number, number, number]; dim?: number; inputName?: string; outputName?: string; pooling?: 'none' | 'cls' }
export interface RecognizerSpec {
  name: string; kind: 'ddindex' | 'whole-card-bank'; embedder: string; detector?: string; index?: string; meta?: string; bank?: string; catalog?: string;
  input?: RecognizerInput; thresholds?: Partial<ConfidenceThresholds>;
}
export type ReadReader = NonNullable<FieldWatcherOptions['recognizer']>;
export interface LoadedRecognizer { name: string; spec: RecognizerSpec; recognizer: ReadReader; nameOf(cardId?: string): string; release(): Promise<void>; threads: number; settings: Record<string, unknown> }

/** The app's own reader as a spec; its files are checked when it loads. */
export const currentSpec = (data = defaultDataDir()): RecognizerSpec => ({
  name: 'current', kind: 'ddindex', embedder: join(data, 'models', basename(yugioh.embedding.url)), detector: join(data, 'models', basename(yugioh.detector.url)),
  index: join(data, 'yugioh-index.bin'), meta: join(data, 'yugioh-index.meta.json'),
});
const exists = (file: string) => access(file).then(() => true, () => false);
const asArray3 = (v: unknown, what: string): [number, number, number] | undefined => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error(`Recognizer spec: ${what} must be three numbers`);
  return v as [number, number, number];
};

/** `current`, a name in <data>/recognizers, or a spec file path. Throws a plain message when the spec is wrong or a file is missing. */
export async function resolveRecognizerSpec(arg: string | undefined, data = defaultDataDir()): Promise<RecognizerSpec> {
  if (!arg || arg === 'current') return currentSpec(data);
  const file = (await exists(resolve(arg))) ? resolve(arg) : join(data, 'recognizers', `${arg}.json`);
  if (!(await exists(file))) throw new Error(`Recognizer "${arg}" not found: it is not "current", a spec file path, or ${join(data, 'recognizers', `${arg}.json`)}`);
  const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>, dir = dirname(file);
  const path = (key: string, required: boolean) => {
    const v = raw[key]; if (v === undefined) { if (required) throw new Error(`Recognizer spec ${file}: "${key}" is required`); return undefined; }
    if (typeof v !== 'string' || !v) throw new Error(`Recognizer spec ${file}: "${key}" must be a path`);
    return isAbsolute(v) ? v : resolve(dir, v);
  };
  const kind = (raw.kind ?? 'ddindex') as RecognizerSpec['kind'];
  if (kind !== 'ddindex' && kind !== 'whole-card-bank') throw new Error(`Recognizer spec ${file}: unknown kind "${String(raw.kind)}"`);
  const input = (raw.input ?? {}) as Record<string, unknown>;
  const spec: RecognizerSpec = {
    name: typeof raw.name === 'string' && raw.name ? raw.name : basename(file).replace(/\.json$/, ''), kind, embedder: path('embedder', true)!, detector: path('detector', false) ?? currentSpec(data).detector,
    ...(kind === 'ddindex' ? { index: path('index', true), meta: path('meta', true) } : { bank: path('bank', true), catalog: path('catalog', true) }),
    input: { size: input.size as number | undefined, dim: input.dim as number | undefined, inputName: input.inputName as string | undefined, outputName: input.outputName as string | undefined, pooling: input.pooling as 'none' | 'cls' | undefined, mean: asArray3(input.mean, 'input.mean'), std: asArray3(input.std, 'input.std') },
    thresholds: raw.thresholds as RecognizerSpec['thresholds'],
  };
  if (kind === 'whole-card-bank' && (!spec.input?.inputName || !spec.input.outputName || !spec.input.size)) throw new Error(`Recognizer spec ${file}: kind "whole-card-bank" needs input.size, input.inputName and input.outputName`);
  return spec;
}

export const normName = (s: string) => s.toLowerCase().replace(/["'\s]/g, '');
const adapt = (session: { run: (...args: never[]) => unknown }) => ({ backend: 'wasm', run: session.run.bind(session) }) as unknown as ModelSession;
const sessionOptions = (threads: number) => ({ executionProviders: ['cpu'], intraOpNumThreads: threads, interOpNumThreads: 1 }) as const;

export async function loadRecognizer(spec: RecognizerSpec, threads = 2, data = defaultDataDir()): Promise<LoadedRecognizer> {
  const files = spec.kind === 'ddindex' ? [spec.embedder, spec.detector, spec.index, spec.meta] : [spec.embedder, spec.detector, spec.bank, spec.catalog];
  for (const f of files) if (!f || !(await exists(f))) throw new Error(`Recognizer "${spec.name}": missing file ${f ?? '(unset)'}`);
  return spec.kind === 'ddindex' ? loadIndexed(spec, threads, data) : loadBank(spec, threads);
}

async function loadIndexed(spec: RecognizerSpec, threads: number, data: string): Promise<LoadedRecognizer> {
  const meta = JSON.parse(await readFile(spec.meta!, 'utf8')) as IndexMeta;
  const nameOf = (id?: string) => id ? meta.entries.find(e => e.cardId === id)?.name ?? id : '(none)';
  const base = currentSpec(data), isCurrent = spec.name === 'current' && spec.embedder === base.embedder && spec.index === base.index;
  if (isCurrent) {
    // The app's own path, unchanged: the same loader the other clip tools use.
    const loaded = await loadNodeRecognizer(data, threads);
    if (!loaded) throw new Error(`No models in ${data}: run scripts/vision/prepare.ts and build-index.ts first.`);
    return { name: spec.name, spec, recognizer: loaded.recognizer!, nameOf, release: loaded.release, threads, settings: { kind: spec.kind, embedder: spec.embedder, index: spec.index, modelId: meta.modelId, dim: meta.dim, inputSize: yugioh.embedding.inputSize } };
  }
  const ort = await import('onnxruntime-node');
  const { RecognitionPipeline } = await import('../../packages/vision/src/pipeline');
  const { decodeIndex } = await import('../../packages/vision/src/index-format');
  // Input settings follow the index: its layoutKey records the embedder block it was built with.
  let built: Partial<EmbeddingModelSpec> = {};
  try { built = (JSON.parse(meta.layoutKey ?? '{}') as { embedding?: Partial<EmbeddingModelSpec> }).embedding ?? {}; } catch { /* use the app defaults */ }
  const o = spec.input ?? {};
  const { webgpu: _w, gpuCheck: _g, ...appEmbedding } = yugioh.embedding;
  const embedding: EmbeddingModelSpec = {
    ...appEmbedding, ...built, ...(o.size ? { inputSize: o.size } : {}), ...(o.mean ? { mean: o.mean } : {}), ...(o.std ? { std: o.std } : {}), ...(o.inputName ? { inputName: o.inputName } : {}),
    ...(o.outputName ? { outputName: o.outputName } : {}), ...(o.pooling ? { pooling: o.pooling } : {}), id: meta.modelId, sha256: meta.modelSha256, dim: o.dim ?? meta.dim,
    thresholds: { ...appEmbedding.thresholds, ...spec.thresholds },
  };
  if (embedding.dim !== meta.dim) throw new Error(`Recognizer "${spec.name}": dim ${embedding.dim} differs from the index's ${meta.dim}`);
  const profile: GameProfile = { ...yugioh, embedding };
  const binary = await readFile(spec.index!);
  const index: LoadedIndex = decodeIndex(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength), meta);
  const detector = await ort.InferenceSession.create(spec.detector!, sessionOptions(threads)), embedder = await ort.InferenceSession.create(spec.embedder, sessionOptions(threads));
  const pipeline = new RecognitionPipeline(profile, index, adapt(detector), adapt(embedder), ort.Tensor as unknown as TensorCtor);
  return {
    name: spec.name, spec, nameOf, threads,
    recognizer: { detectorBackend: 'wasm', separateDetector: true, detectCards: frame => pipeline.detectCards(frame as unknown as RGBAImage), recognize: (frames, opts) => pipeline.recognize(frames as unknown as RGBAImage[], opts) },
    release: async () => { await detector.release(); await embedder.release(); },
    settings: { kind: spec.kind, embedder: spec.embedder, index: spec.index, modelId: meta.modelId, dim: embedding.dim, inputSize: embedding.inputSize, mean: embedding.mean, std: embedding.std, pooling: embedding.pooling, inputName: embedding.inputName, outputName: embedding.outputName, thresholds: embedding.thresholds },
  };
}

/** Half precision (IEEE 754 binary16) to number. */
export const halfToFloat = (h: number) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? NaN : s * 2 ** (e - 15) * (1 + f / 1024); };
/** Box-average an image down to n x n and normalise to CHW floats with (v / 255 - mean) / std. Smaller sides are stretched, as the source reader does. */
export function boxTensor(img: RGBAImage, n: number, mean: readonly number[], std: readonly number[]): Float32Array {
  const sum = new Float64Array(n * n * 3), count = new Uint32Array(n * n);
  for (let y = 0; y < img.height; y++) {
    const oy = Math.min(n - 1, Math.floor(y * n / img.height));
    for (let x = 0; x < img.width; x++) { const o = oy * n + Math.min(n - 1, Math.floor(x * n / img.width)), p = (y * img.width + x) * 4; sum[o * 3] += img.data[p]; sum[o * 3 + 1] += img.data[p + 1]; sum[o * 3 + 2] += img.data[p + 2]; count[o]++; }
  }
  const out = new Float32Array(3 * n * n);
  for (let i = 0; i < n * n; i++) for (let c = 0; c < 3; c++) out[c * n * n + i] = ((count[i] ? sum[i * 3 + c] / count[i] : 0) / 255 - mean[c]) / std[c];
  return out;
}
export interface Bank { dim: number; vectors: Float32Array; names: string[]; ids: string[] }
export function decodeBank(raw: { dim: number; entries: { cardId: string; vec: string }[] }, nameOfId: (id: string) => string): Bank {
  const { dim, entries } = raw, vectors = new Float32Array(entries.length * dim), names: string[] = [], ids: string[] = [];
  entries.forEach((e, i) => { const b = Buffer.from(e.vec, 'base64'); if (b.length !== dim * 2) throw new Error(`Bank row ${i} has ${b.length} bytes, expected ${dim * 2}`); for (let d = 0; d < dim; d++) vectors[i * dim + d] = halfToFloat(b.readUInt16LE(d * 2)); ids.push(e.cardId); names.push(nameOfId(e.cardId)); });
  return { dim, vectors, names, ids };
}
/** Best row per card NAME (alternate arts of one card do not compete), best first. */
export function searchBank(bank: Bank, query: Float32Array, k = 5): Candidate[] {
  const { dim, vectors, names, ids } = bank, best = new Map<string, { id: string; score: number }>();
  for (let r = 0; r < names.length; r++) { let d = 0; for (let i = 0; i < dim; i++) d += query[i] * vectors[r * dim + i]; const key = normName(names[r]), cur = best.get(key); if (!cur || d > cur.score) best.set(key, { id: ids[r], score: d }); }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k).map(c => ({ cardId: c.id, score: c.score }));
}

async function loadBank(spec: RecognizerSpec, threads: number): Promise<LoadedRecognizer> {
  const ort = await import('onnxruntime-node');
  const catalog = JSON.parse(await readFile(spec.catalog!, 'utf8')) as { cards: { id: string; name: string }[] };
  const byId = new Map(catalog.cards.map(c => [c.id, c.name])), nameOf = (id?: string) => id ? byId.get(id) ?? id : '(none)';
  const bank = decodeBank(JSON.parse(await readFile(spec.bank!, 'utf8')), id => byId.get(id) ?? id);
  const input = spec.input!, size = input.size!, mean = input.mean ?? [.5, .5, .5], std = input.std ?? [.5, .5, .5], tau = spec.thresholds?.score ?? .68, delta = spec.thresholds?.margin ?? .06;
  if (input.dim !== undefined && input.dim !== bank.dim) throw new Error(`Recognizer "${spec.name}": input.dim ${input.dim} differs from the bank's ${bank.dim}`);
  const detector = await ort.InferenceSession.create(spec.detector!, sessionOptions(threads)), embedder = await ort.InferenceSession.create(spec.embedder, sessionOptions(threads));
  const detectorSession = adapt(detector), Tensor = ort.Tensor as unknown as TensorCtor;
  const recognize: ReadReader['recognize'] = async (frames, opts) => {
    const start = performance.now(), img = frames[0] as unknown as RGBAImage;
    // No outline (a warm-up patch): the whole image counts as the card.
    const quad = opts?.card ? opts.card.quad.map(p => ({ x: p.x * img.width, y: p.y * img.height })) : [{ x: 0, y: 0 }, { x: img.width, y: 0 }, { x: img.width, y: img.height }, { x: 0, y: img.height }];
    const warp = warpQuadMasked(img, quad as never, yugioh.card.warpWidth, yugioh.card.warpHeight);
    if (!warp) throw new Error('Card outline cannot be warped');
    const t1 = performance.now(), tensor = boxTensor(warp.image, size, mean, std);
    const out = await embedder.run({ [input.inputName!]: new ort.Tensor('float32', tensor, [1, 3, size, size]) });
    const raw = out[input.outputName!]?.data as Float32Array | undefined; if (!raw) throw new Error(`Embedder has no output "${input.outputName}"`);
    const norm = Math.hypot(...raw) || 1, q = Float32Array.from(raw, v => v / norm), t2 = performance.now();
    const candidates = searchBank(bank, q, opts?.k ?? 5), lead = (candidates[0]?.score ?? -1) - (candidates[1]?.score ?? 0), t3 = performance.now();
    const tier = candidates[0] && candidates[0].score >= tau && lead >= delta ? 'sure' : candidates[0] && candidates[0].score >= (spec.thresholds?.floor ?? .4) ? 'not sure' : 'low match';
    const result: RecognitionResult = {
      candidates, tier, backend: 'wasm', detectedCard: opts?.card, warpedCard: warp.image,
      quality: { sharpness: 0, detected: !!opts?.card, cornersFound: !!opts?.card, framesUsed: 1, selectedFrameIndices: [0], fallback: !opts?.card, searchSource: 'catalog' },
      timingsMs: { sharpness: 0, detect: 0, warp: t1 - start, embed: t2 - t1, search: t3 - t2, total: t3 - start, embedCount: 1 },
    };
    return result;
  };
  return {
    name: spec.name, spec, nameOf, threads,
    recognizer: { detectorBackend: 'wasm', separateDetector: true, detectCards: frame => detectScene(frame as unknown as RGBAImage, yugioh as GameProfile, detectorSession, Tensor), recognize },
    release: async () => { await detector.release(); await embedder.release(); },
    settings: { kind: spec.kind, embedder: spec.embedder, bank: spec.bank, rows: bank.names.length, dim: bank.dim, inputSize: size, mean, std, inputName: input.inputName, outputName: input.outputName, thresholds: { score: tau, margin: delta } },
  };
}
