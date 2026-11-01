// Ported from mathulbrich/duel-lens at f6968f3682d53a79c4a9fef591300615eda61c11 (Apache-2.0).
// Modified for game profiles and a browser worker. See ../../packages/vision/src/licenses/duel-lens.LICENSE.
/**
 * Build our artwork index from the same YGOPRODeck catalog used by card-catalog.ts.
 * CPU-only, resumable, at most four HTTP requests per second (one in flight).
 *
 *   npx tsx scripts/vision/build-index.ts --limit 20
 *   npx tsx scripts/vision/build-index.ts --selection subset
 *   npx tsx scripts/vision/build-index.ts --selection full
 *
 * The default auto selection chooses the full catalog only when its conservative
 * download estimate is under 60 minutes; otherwise 2,000 popular/recent cards.
 * Cached vectors and 224px JPEG artwork are independent of selection/limit.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { embedImages, type SessionLike, type TensorCtor } from '../../packages/vision/src/embed';
import { decodeIndex } from '../../packages/vision/src/index-format';
import { dropPlaceholders } from '../../packages/vision/src/placeholder-art';
import { buildIndexArtefacts } from '../../packages/vision/src/index-builder';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import { layoutKey, validateIndexProfile } from '../../packages/vision/src/profile';
import type { IndexEntry, IndexMeta } from '../../packages/vision/src/types';

const API = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes';
const CACHE_VERSION = 'art224-jpeg90-v1';
type CatalogCard = {
  id: number; name: string; frameType: string; type: string;
  views: number; date: string; sets: string[];
  images: { id: number; cropped: string; full: string }[];
};
type Catalog = { source: string; sha256: string; fetchedAt: string; cards: CatalogCard[] };
type Artwork = { entry: IndexEntry; cropped: string; full: string };
type StapleArtifact = { version: string; formats: Record<string, {
  cards: { passcode: number; playShare: number }[];
  genericUsage: { passcode: number; decks: number }[]; deckCount: number;
}> };
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)}m`;
async function atomic(path: string, bytes: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, bytes);
  await rename(`${path}.tmp`, path);
}

// Serial fetches enforce both a request-start rate limit and a single connection.
let nextRequest = 0;
let requestCount = 0;
async function download(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['db.ygoprodeck.com', 'images.ygoprodeck.com'].includes(parsed.hostname)) {
    throw new Error(`Unsupported catalog/image origin: ${parsed.origin}`);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(Math.max(0, nextRequest - Date.now()));
    nextRequest = Date.now() + 255;
    requestCount++;
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(45_000), headers: { 'User-Agent': 'YugiDraft-offline-artwork-index/1.0' } });
    } catch (error) {
      if (attempt === 4) throw error;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) {
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > 40_000_000) throw new Error(`Oversized response for ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 40_000_000) throw new Error(`Oversized response for ${url}`);
      return bytes;
    }
    await response.body?.cancel();
    if (response.status !== 429 && response.status < 500) throw new Error(`HTTP ${response.status}: ${url}`);
    if (attempt === 4) throw new Error(`HTTP ${response.status} after five attempts: ${url}`);
    const retry = response.headers.get('retry-after');
    const retryMs = retry ? (/^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
    const wait = Math.max(1000 * 2 ** attempt, Number.isFinite(retryMs) ? retryMs : 0);
    console.warn(`HTTP ${response.status}; retrying in ${(wait / 1000).toFixed(1)}s`);
    nextRequest = Math.max(nextRequest, Date.now() + wait);
  }
  throw new Error('Unreachable fetch state');
}

async function catalogAt(cache: string, explicit?: string, refresh = false): Promise<Catalog> {
  if (!explicit && !refresh && existsSync(cache)) return JSON.parse(await readFile(cache, 'utf8'));
  const raw = explicit ? await readFile(resolve(explicit)) : await download(API);
  const parsed = JSON.parse(raw.toString());
  const rows = Array.isArray(parsed) ? parsed : parsed.data;
  if (!Array.isArray(rows) || !rows.length) throw new Error('Catalog has no cards');
  const cards: CatalogCard[] = rows.flatMap((row: any) => {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || typeof row.name !== 'string' || !Array.isArray(row.card_images)) return [];
    // Placeholder, token and Skill cards are outside normal physical Yu-Gi-Oh play.
    if (row.name === '???' || /token|skill/i.test(row.type ?? '')) return [];
    const images = row.card_images.filter((im: any) => Number.isSafeInteger(im.id ?? row.id) && im.image_url)
      .map((im: any) => ({ id: im.id ?? row.id, full: im.image_url,
        cropped: im.image_url_cropped ?? `https://images.ygoprodeck.com/images/cards_cropped/${im.id ?? row.id}.jpg` }));
    if (!images.length) return [];
    const misc = row.misc_info?.[0] ?? {};
    const dates = [misc.tcg_date, misc.ocg_date].filter((date: unknown) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date));
    return [{ id: row.id, name: row.name, frameType: row.frameType ?? '', type: row.type ?? '',
      views: Number(misc.views ?? 0), date: dates.sort()[0] ?? '0000-00-00',
      sets: (row.card_sets ?? []).map((set: any) => set.set_name).filter((name: unknown) => typeof name === 'string'), images }];
  });
  const catalog = { source: explicit ? `file:${resolve(explicit)} (YGOPRODeck cardinfo snapshot)` : API,
    sha256: sha(raw), fetchedAt: new Date().toISOString(), cards };
  await atomic(cache, JSON.stringify(catalog));
  return catalog;
}

function frameClass(card: CatalogCard): string | undefined {
  const frame = card.frameType.toLowerCase();
  const names: [string, string][] = [['pendulum', 'Pendulum'], ['fusion', 'Fusion'], ['synchro', 'Synchro'], ['xyz', 'Xyz'], ['link', 'Link'], ['ritual', 'Ritual'], ['normal', 'Normal'], ['effect', 'Effect'], ['spell', 'Spell'], ['trap', 'Trap']];
  return names.find(([key]) => frame.includes(key))?.[1];
}
function artworks(cards: CatalogCard[]): Artwork[] {
  const seen = new Set<number>();
  return cards.flatMap(card => card.images.flatMap(image => {
    if (seen.has(image.id)) return [];
    seen.add(image.id);
    return [{ entry: { cardId: String(card.id), passcode: card.id <= 99_999_999 ? card.id : card.images.find(i => i.id <= 99_999_999)?.id ?? 0, name: card.name, imageId: image.id,
      frameClass: frameClass(card), imageUrl: image.full }, cropped: image.cropped, full: image.full }];
  }));
}
function subset(cards: CatalogCard[], root: string, size = 2000) {
  const staplePath = join(root, 'packages/shared/data/staples/usage.json');
  const staple: StapleArtifact | undefined = existsSync(staplePath) ? JSON.parse(readFileSync(staplePath, 'utf8')) : undefined;
  const usage = new Map<number, number>();
  for (const format of Object.values(staple?.formats ?? {})) {
    for (const card of format.genericUsage ?? []) usage.set(card.passcode, (usage.get(card.passcode) ?? 0) + card.decks / format.deckCount);
    for (const card of format.cards ?? []) usage.set(card.passcode, (usage.get(card.passcode) ?? 0) + 10 + card.playShare);
  }
  const popular = [...cards].sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || b.views - a.views || a.id - b.id);
  const selected = new Map(popular.slice(0, Math.ceil(size / 2)).map(card => [card.id, card]));
  const recent = cards.filter(c => c.date <= new Date().toISOString().slice(0, 10)).sort((a, b) => b.date.localeCompare(a.date) || b.views - a.views || a.id - b.id);
  for (const card of recent) {
    if (selected.size >= size) break;
    selected.set(card.id, card);
  }
  return { cards: [...selected.values()], stapleVersion: staple?.version,
    description: `${size} cards: first ${Math.ceil(size / 2)} ranked by repository format staple/generic deck usage, then catalog views; fill remaining slots by newest first-release date (earliest TCG/OCG date), then views. Includes every alternate artwork. Excludes placeholders, Tokens and Skills.` };
}
function diskBytes(path: string): number {
  return readdirSync(path, { withFileTypes: true }).reduce((sum, item) => {
    const child = join(path, item.name);
    return sum + (item.isDirectory() ? diskBytes(child) : statSync(child).size);
  }, 0);
}

async function main() {
  const { values } = parseArgs({ options: {
    selection: { type: 'string', default: 'auto' }, limit: { type: 'string' },
    output: { type: 'string', default: 'data/vision' }, cache: { type: 'string', default: 'data/vision/cache' },
    'image-cache': { type: 'string' }, catalog: { type: 'string' }, 'refresh-catalog': { type: 'boolean', default: false },
    threads: { type: 'string', default: '4' }, help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Usage: npx tsx scripts/vision/build-index.ts [--selection auto|subset|full] [--limit ARTWORKS] [--threads 4] [--image-cache PATH] [--catalog cardinfo.json] [--refresh-catalog] [--cache PATH] [--output data/vision]');
    return;
  }
  if (!['auto', 'subset', 'full'].includes(values.selection!)) throw new Error('selection must be auto, subset or full');
  const limit = values.limit ? Number(values.limit) : Infinity;
  const threads = Number(values.threads);
  if ((!Number.isSafeInteger(limit) && limit !== Infinity) || limit < 1) throw new Error('limit must be a positive integer');
  if (!Number.isSafeInteger(threads) || threads < 1 || threads > availableParallelism()) throw new Error('Invalid threads');
  const started = Date.now();
  const root = process.cwd(), output = resolve(values.output!), cache = resolve(values.cache!);
  const modelPath = join(root, 'data/vision/models/dinov2-small-duel.q8.onnx');
  const modelHash = sha(await readFile(modelPath));
  if (modelHash !== yugioh.embedding.sha256) throw new Error('Embedding model SHA256 does not match the game profile');
  const identity = sha(JSON.stringify({ layout: layoutKey(yugioh), modelHash, cache: CACHE_VERSION })).slice(0, 24);
  const derived = join(cache, identity), imageDir = join(derived, 'artwork'), vectorDir = join(derived, 'vectors');
  await mkdir(imageDir, { recursive: true }); await mkdir(vectorDir, { recursive: true });
  const localImages = values['image-cache'] ? resolve(values['image-cache'])
    : [join(root, 'data/card-images'), resolve(root, '../../data/card-images')].find(existsSync);
  const catalog = await catalogAt(join(cache, 'catalog.json'), values.catalog, values['refresh-catalog']);
  const full = artworks(catalog.cards);
  const reusableImages = full.filter(art => existsSync(join(imageDir, `${art.entry.imageId}.jpg`)) ||
    (localImages && existsSync(join(localImages, `${art.entry.imageId}.jpg`)))).length;
  // At 4 requests/sec, 14k+ artwork already exceeds one hour before inference.
  const downloadFloor = Math.max(0, full.length - reusableImages) * 255;
  const auto = downloadFloor + full.length * 75 < 60 * 60_000 ? 'full' : 'subset';
  const selection = values.selection === 'auto' ? auto : values.selection!;
  const selected = subset(catalog.cards, root);
  const chosen = selection === 'full' ? catalog.cards : selected.cards;
  const work = artworks(chosen).slice(0, limit);
  const chosenIds = new Set(chosen.map(c => c.id));
  const reserve = selection === 'subset' && !Number.isFinite(limit) ? artworks(catalog.cards
    .filter(c => !chosenIds.has(c.id) && c.date <= new Date().toISOString().slice(0, 10))
    .sort((a,b) => b.date.localeCompare(a.date) || b.views-a.views)) : [];
  let reserveAt = 0;
  const indexedIds = new Set<string>();
  const selectionDescription = selection === 'full' ? 'All catalog cards with all alternate artwork; excludes placeholders, Tokens and Skills.' : selected.description;
  console.log(JSON.stringify({ catalogCards: catalog.cards.length, catalogArtworks: full.length, selection,
    selectedCards: chosen.length, selectedArtworks: work.length, downloadFloorMinutes: +(downloadFloor / 60_000).toFixed(1),
    profile: yugioh.id, model: yugioh.embedding.id, cacheIdentity: identity, localImages, threads }));
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'], intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: 'all' });
  let entries: IndexEntry[] = [], vectors: Float32Array[] = [];
  const failures: { imageId: number; name: string; error: string }[] = [];
  let resumed = 0, localCount = 0, downloaded = 0, inferred = 0, inferenceMs = 0;
  const processingStarted = Date.now();
  for (let i = 0; i < work.length; i++) {
    const art = work[i], imageId = art.entry.imageId!;
    const vectorPath = join(vectorDir, `${imageId}.f32`), imagePath = join(imageDir, `${imageId}.jpg`);
    try {
      let vector: Float32Array;
      if (existsSync(vectorPath)) {
        const bytes = await readFile(vectorPath);
        vector = Float32Array.from({ length: bytes.length / 4 }, (_, n) => bytes.readFloatLE(n * 4));
        const norm = vector.reduce((sum, value) => sum + value * value, 0);
        if (vector.length !== yugioh.embedding.dim || !Number.isFinite(norm) || Math.abs(norm - 1) > 0.01) throw new Error('Invalid cached vector; remove its .f32 file and resume');
        resumed++;
      } else {
        if (!existsSync(imagePath)) {
          const local = localImages && join(localImages, `${imageId}.jpg`);
          let image: ReturnType<typeof sharp>;
          if (local && existsSync(local)) {
            const input = await readFile(local);
            const metadata = await sharp(input).metadata();
            const { width, height } = metadata;
            if (!width || !height) throw new Error('Local image has no dimensions');
            const box = yugioh.artWindow;
            const left = Math.floor(width * box.x), top = Math.floor(height * box.y);
            image = sharp(input).extract({ left, top, width: Math.floor(width * (box.x + box.w)) - left, height: Math.floor(height * (box.y + box.h)) - top });
            localCount++;
          } else {
            try { image = sharp(await download(art.cropped)); }
            catch (error) {
              if (!(error instanceof Error) || !error.message.startsWith('HTTP 404:')) throw error;
              // Some recent cards have full renders before cards_cropped becomes available.
              const fullImage = await download(art.full);
              const dimensions = await sharp(fullImage).metadata();
              const w = dimensions.width!, h = dimensions.height!, box = yugioh.artWindow;
              image = sharp(fullImage).extract({ left: Math.floor(w * box.x), top: Math.floor(h * box.y), width: Math.floor(w * box.w), height: Math.floor(h * box.h) });
            }
            downloaded++;
          }
          const jpg = await image.resize(224, 224, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 90 }).toBuffer();
          await atomic(imagePath, jpg);
        }
        const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const inferenceStarted = Date.now();
        [vector] = await embedImages(session as unknown as SessionLike, ort.Tensor as unknown as TensorCtor, yugioh.embedding, [{ data, width: info.width, height: info.height }]);
        inferenceMs += Date.now() - inferenceStarted;
        inferred++;
        if (vector.length !== yugioh.embedding.dim || vector.some(value => !Number.isFinite(value))) throw new Error('Invalid model embedding');
        const bytes = Buffer.alloc(vector.length * 4);
        vector.forEach((value, n) => bytes.writeFloatLE(value, n * 4));
        await atomic(vectorPath, bytes);
      }
      entries.push(art.entry); vectors.push(vector); indexedIds.add(art.entry.cardId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ imageId, name: art.entry.name, error: message });
      console.warn(`Failed ${imageId} ${art.entry.name}: ${message}`);
    }
    if (i + 1 === work.length && indexedIds.size < chosen.length && reserveAt < reserve.length) {
      const nextId = reserve[reserveAt].entry.cardId;
      do { work.push(reserve[reserveAt++]); } while (reserveAt < reserve.length && reserve[reserveAt].entry.cardId === nextId);
    }
    if ((i + 1) % 100 === 0 || i + 1 === work.length) {
      const elapsed = Date.now() - processingStarted;
      console.log(`${i + 1}/${work.length} artwork; ${entries.length} indexed, ${failures.length} failed, ${resumed} resumed; elapsed ${minutes(elapsed)}, ETA ${minutes(elapsed / (i + 1) * (work.length - i - 1))}; inference ${inferred ? (inferenceMs / inferred).toFixed(1) : '0'}ms/art`);
    }
  }
  // The back competes with real artwork in embedding space, as in Duel Lens.
  const backPath = join(root, 'packages/web/public', yugioh.cardBack.imageUrl);
  const back = await sharp(backPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [backVector] = await embedImages(session as unknown as SessionLike, ort.Tensor as unknown as TensorCtor, yugioh.embedding,
    [{ data: back.data, width: back.info.width, height: back.info.height }]);
  entries.push({ cardId: yugioh.cardBack.cardId, passcode: 0, imageId: -1, name: 'Card back' });
  vectors.push(backVector);
  const kept = dropPlaceholders(entries, vectors, yugioh.cardBack.cardId);
  entries = kept.entries; vectors = kept.vectors;
  if (kept.dropped.length) console.warn(`Excluded ${kept.dropped.length} card-back placeholders: ${kept.dropped.map(e => e.name).join(', ')}`);
  await session.release();
  if (!entries.length) throw new Error('No artwork vectors were built');
  const artefacts = buildIndexArtefacts(entries, vectors, { version: 1, gameId: yugioh.id, layoutKey: layoutKey(yugioh), modelId: yugioh.embedding.id,
    modelSha256: modelHash, generatedAt: new Date().toISOString(), catalog: `${catalog.source}; sha256=${catalog.sha256}; selection=${selection}; ${selectionDescription}` });
  const meta = JSON.parse(artefacts.metaJson) as IndexMeta;
  const binary = artefacts.bin.buffer as ArrayBuffer;
  validateIndexProfile(meta, yugioh); decodeIndex(binary, meta);
  await atomic(join(output, 'yugioh-index.bin'), new Uint8Array(binary));
  await atomic(join(output, 'yugioh-index.meta.json'), `${JSON.stringify(meta)}\n`);
  const report = { generatedAt: meta.generatedAt, source: catalog.source, sourceSha256: catalog.sha256, catalogFetchedAt: catalog.fetchedAt,
    catalogCards: catalog.cards.length, catalogArtworks: full.length, selection, selectionDescription, stapleVersion: selected.stapleVersion,
    limit: Number.isFinite(limit) ? limit : null, selectedCards: chosen.length, attemptedArtworks: work.length,
    indexedCards: new Set(entries.map(entry => entry.cardId)).size, indexedArtworks: entries.length,
    modelId: meta.modelId, modelSha256: modelHash, layoutKey: meta.layoutKey, cacheIdentity: identity,
    droppedPlaceholders: kept.dropped, requestCount, downloaded, localImagesUsed: localCount, resumedVectors: resumed, inferenceCount: inferred,
    meanInferenceMs: inferred ? inferenceMs / inferred : null, elapsedSeconds: (Date.now() - started) / 1000,
    downloadFloorMinutes: downloadFloor / 60_000, binaryBytes: binary.byteLength, cacheBytes: diskBytes(cache), failures,
    fullCommand: 'npx tsx scripts/vision/build-index.ts --selection full',
    rebuildCommand: 'npx tsx scripts/vision/build-index.ts --selection subset',
    notes: ['No upstream vectors/index used.', 'Images downloaded serially with >=255ms between request starts; Retry-After honored.', 'Only derived 224px JPEG artwork is retained; local card-images cache is read-only.', 'Unavailable artworks are recorded; subset mode fills missing cards from the next recent releases.', 'Int8 vectors use round(127 * normalized_embedding); search must normalize the stored vector.', 'Re-running resumes vectors; remove a specific artwork .f32 to retry its embedding.'] };
  await atomic(join(output, 'yugioh-index.build.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (indexedIds.size < Math.min(chosen.length, Number.isFinite(limit) ? 1 : chosen.length)) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
