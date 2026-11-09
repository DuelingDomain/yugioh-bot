/** Shared Node helpers for the clip tools: read a .ddclip, decode JPEG frames with sharp, load the real models when present. */
import { readFile, access } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { join, resolve, basename } from 'node:path';
import { parseClip, type ClipBundle } from '../../packages/vision/src/clip-format';
import type { FieldWatcherOptions } from '../../packages/vision/src/field-watcher';
import type { RGBAImage } from '../../packages/vision/src/pixels';
import type { IndexMeta, LoadedIndex } from '../../packages/vision/src/types';
import type { ModelSession } from '../../packages/vision/src/runtime';
import type { TensorCtor } from '../../packages/vision/src/embed';
import { yugioh } from '../../packages/vision/src/games/yugioh';

export const root = resolve(import.meta.dirname, '../..');
export const defaultDataDir = () => resolve(process.env.VISION_DATA_DIR ?? join(root, 'data/vision'));
export const evalDir = () => resolve(process.env.VISION_EVAL_DIR ?? join(root, 'data/vision-eval'));

export async function readClip(file: string): Promise<ClipBundle> {
  const bytes = await readFile(file);
  return parseClip(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), data => new Uint8Array(inflateRawSync(data)));
}
export const clipName = (file: string) => basename(file).replace(/\.ddclip$/, '');

export async function jpegDecoder() {
  const sharp = (await import('sharp')).default;
  return async (bytes: Uint8Array): Promise<RGBAImage> => { const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }; };
}

export interface NodeRecognizer { recognizer: FieldWatcherOptions['recognizer']; release(): Promise<void>; threads: number }

/** The real detector + embedder + index through onnxruntime-node, or null when the data directory has no models. */
export async function loadNodeRecognizer(data = defaultDataDir(), threads = 2): Promise<NodeRecognizer | null> {
  const files = { meta: join(data, 'yugioh-index.meta.json'), bin: join(data, 'yugioh-index.bin'), detector: join(data, 'models', basename(yugioh.detector.url)), embedder: join(data, 'models', basename(yugioh.embedding.url)) };
  for (const file of Object.values(files)) { try { await access(file); } catch { return null; } }
  const ort = await import('onnxruntime-node');
  const { RecognitionPipeline } = await import('../../packages/vision/src/pipeline');
  const { decodeIndex } = await import('../../packages/vision/src/index-format');
  const { validateIndexProfile } = await import('../../packages/vision/src/profile');
  const meta = JSON.parse(await readFile(files.meta, 'utf8')) as IndexMeta; validateIndexProfile(meta, yugioh);
  const binary = await readFile(files.bin);
  const index: LoadedIndex = decodeIndex(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength), meta);
  const options = { executionProviders: ['cpu'], intraOpNumThreads: threads, interOpNumThreads: 1 } as const;
  const detector = await ort.InferenceSession.create(files.detector, options), embedder = await ort.InferenceSession.create(files.embedder, options);
  const adapt = (session: { run: (...args: never[]) => unknown }) => ({ backend: 'wasm', run: session.run.bind(session) }) as unknown as ModelSession;
  const pipeline = new RecognitionPipeline(yugioh, index, adapt(detector), adapt(embedder), ort.Tensor as unknown as TensorCtor);
  return {
    threads,
    recognizer: {
      detectorBackend: 'wasm', separateDetector: true,
      detectCards: frame => pipeline.detectCards(frame as unknown as RGBAImage),
      recognize: (frames, opts) => pipeline.recognize(frames as unknown as RGBAImage[], opts),
    },
    release: async () => { await detector.release(); await embedder.release(); },
  };
}
