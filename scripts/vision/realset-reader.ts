import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import { duelSightModel, lightModel } from '../../packages/vision/src/hybrid-models';
import { loadHybridPipeline } from '../../packages/vision/src/hybrid-loader';
import { decodeIndex } from '../../packages/vision/src/index-format';
import { RecognitionPipeline } from '../../packages/vision/src/pipeline';
import { validateIndexProfile } from '../../packages/vision/src/profile';
import type { TensorCtor } from '../../packages/vision/src/embed';
import type { ModelSession } from '../../packages/vision/src/runtime';
import type { CardReader, IndexMeta } from '../../packages/vision/src/types';
import { sha256 } from './realset-schema';

/** Offline production pipelines with the shipped default thresholds and full catalog search. */
export async function openRealsetReader(reader: CardReader, data: string, threads: number) {
  const assets: Record<string, string> = {};
  const fileFor = (url: string) => url.replace(/^\/dev\/vision-assets\//, '');
  const read = async (asset: { url: string; sha256?: string }) => {
    const file = fileFor(asset.url);
    const bytes = await readFile(join(data, file));
    const hash = sha256(bytes);
    if (asset.sha256 && hash !== asset.sha256) throw new Error(`Invalid SHA-256 for ${file}`);
    assets[file] = hash;
    return Uint8Array.from(bytes).buffer;
  };
  const open = async (asset: { url: string; sha256: string }): Promise<ModelSession> => {
    const session = await ort.InferenceSession.create(await read(asset), {
      executionProviders: ['cpu'], intraOpNumThreads: threads, interOpNumThreads: 1,
    });
    return { backend: 'wasm', run: session.run.bind(session) as ModelSession['run'], release: () => session.release() };
  };
  const sessions: ModelSession[] = [];
  const release = () => Promise.all(sessions.map(s => s.release()));
  try {
    const meta: IndexMeta = JSON.parse(new TextDecoder().decode(await read({ url: yugioh.metaUrl })));
    validateIndexProfile(meta, yugioh);
    const index = decodeIndex(await read({ url: yugioh.indexUrl }), meta);
    const detector = await open(yugioh.detector);
    sessions.push(detector);
    const embedder = await open(yugioh.embedding);
    sessions.push(embedder);
    const args = [yugioh, index, detector, embedder, ort.Tensor as unknown as TensorCtor] as const;
    const current = new RecognitionPipeline(...args);
    let pipeline = current, entries = meta.entries;
    let fallbackNote: string | undefined;
    if (reader === 'hybrid') {
      const hybrid = await loadHybridPipeline([...args], current, read, open, note => { fallbackNote = note; });
      pipeline = hybrid.pipeline;
      entries = [...hybrid.entries, ...entries];
      sessions.push(...hybrid.sessions);
    }
    const names = new Map(entries.map(e => [e.cardId, e.name]));
    const modelIds = reader === 'current' ? [yugioh.embedding.id] : [duelSightModel.id, lightModel.id];
    return { pipeline, names, assets, modelIds, runtime: ort.env.versions.node, release,
      assertNoFallback() { if (fallbackNote) throw new Error(fallbackNote); } };
  } catch (error) {
    await release();
    throw error;
  }
}
