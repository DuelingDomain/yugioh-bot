import { fetchModelChecked } from './model-cache';
import { createModelSession, type ModelSession } from './runtime';
import { RecognitionPipeline } from './pipeline';
import { HybridPipeline } from './hybrid';
import { HYBRID_ASSETS, hybridProfiles } from './hybrid-models';
import { parseBankBinary } from './duelsight/bank';
import { decodeIndex } from './index-format';
import { validateIndexProfile, layoutKey } from './profile';
import type { IndexEntry, IndexMeta, LoadedIndex } from './types';

type CheckedAsset = { url: string; sha256: string };

/** Assemble the released Hybrid reader after the caller supplies its verified assets and runtime. */
export async function loadHybridPipeline(
  args: ConstructorParameters<typeof RecognitionPipeline>,
  current: RecognitionPipeline,
  readAsset: (asset: CheckedAsset) => Promise<ArrayBuffer>,
  openSession: (asset: CheckedAsset) => Promise<ModelSession>,
  notify: (note: string) => void,
) {
  const [profile, , detector, , Tensor] = args;
  const profiles = hybridProfiles(profile);
  const json = async <T>(asset: CheckedAsset): Promise<T> =>
    JSON.parse(new TextDecoder().decode(await readAsset(asset)));
  const catalog = await json<{ entries: IndexEntry[]; bankEntries: Record<string, IndexEntry> }>(HYBRID_ASSETS.catalog);
  const meta = await json<IndexMeta>(HYBRID_ASSETS.meta);
  validateIndexProfile(meta, profiles.second);
  const light = decodeIndex(await readAsset(HYBRID_ASSETS.index), meta);
  const bank = parseBankBinary(await readAsset(HYBRID_ASSETS.bank));
  if (!bank || bank.dim !== profiles.first.embedding.dim) throw new Error('Invalid DuelSight bank');
  const entries = bank.ids.map(id => {
    const entry = catalog.bankEntries[id];
    if (!entry) throw new Error('Unknown DuelSight bank name');
    return entry;
  });
  const firstIndex: LoadedIndex = {
    meta: {
      version: 1, gameId: profile.id, layoutKey: layoutKey(profiles.first), modelId: profiles.first.embedding.id,
      modelSha256: profiles.first.embedding.sha256, dim: bank.dim, count: entries.length, dtype: 'float32', entries,
    },
    vectors: bank.matrix,
  };
  const sessions: ModelSession[] = [];
  try {
    for (const spec of [profiles.first.embedding, profiles.second.embedding]) sessions.push(await openSession(spec));
    const first = new RecognitionPipeline(profiles.first, firstIndex, detector, sessions[0], Tensor);
    const second = new RecognitionPipeline(profiles.second, light, detector, sessions[1], Tensor);
    return { pipeline: new HybridPipeline(args, current, first, second, catalog.entries, notify), sessions, entries: catalog.entries };
  } catch (error) {
    await Promise.all(sessions.map(s => s.release().catch(() => {})));
    throw error;
  }
}

export async function openHybrid(args: ConstructorParameters<typeof RecognitionPipeline>, current: RecognitionPipeline, runtimeBase: string,
  threads: number | undefined, notify: (note: string) => void, onSessions: (sessions: ModelSession[]) => void) {
  const { pipeline, sessions } = await loadHybridPipeline(args, current, async asset => {
    const response = await fetchModelChecked(asset.url, asset.sha256, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Hybrid asset HTTP ${response.status}`);
    return response.arrayBuffer();
  // New graphs have no checked WebGPU output reference yet.
  }, asset => createModelSession(asset.url, asset.sha256, 'wasm', runtimeBase, undefined, { threads }), notify);
  onSessions(sessions);
  return pipeline;
}
