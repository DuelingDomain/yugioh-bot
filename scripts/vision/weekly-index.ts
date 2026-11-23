import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import { decodeIndex } from '../../packages/vision/src/index-format';
import { filterPhysicalIndex } from '../../packages/vision/src/physical-index';
import { validateIndexProfile } from '../../packages/vision/src/profile';
import type { IndexMeta } from '../../packages/vision/src/types';
import { assetNames, assetUrl, readManifest, sha256 } from './index-release.mjs';

// Documented full production index after applying the runtime physical-card filter.
const bootstrapCards = 14_487;
const allowedLoss = 10;

export function inspectCandidate(meta: IndexMeta, binary: ArrayBuffer, currentCards: number) {
  validateIndexProfile(meta, yugioh);
  const index = filterPhysicalIndex(decodeIndex(binary, meta));
  if (!index.meta.entries.some(entry => entry.cardId === yugioh.cardBack.cardId)) {
    throw new Error('Index is missing its card-back reference');
  }
  const cards = new Set(index.meta.entries.map(entry => entry.cardId)).size - 1;
  if (!cards || cards < currentCards - allowedLoss) {
    throw new Error(`Vision index coverage fell from ${currentCards} to ${cards} cards (maximum loss ${allowedLoss})`);
  }
  const entriesHash = sha256(JSON.stringify(index.meta.entries.map(entry => JSON.stringify(entry)).sort()));
  return { cards, entriesHash };
}

async function prepareCandidate(directory: string, output: string, release: string) {
  const current = await readManifest();
  const binary = Uint8Array.from(await readFile(join(directory, 'yugioh-index.bin'))).buffer;
  const metaPath = join(directory, 'yugioh-index.meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8')) as IndexMeta;
  const { cards, entriesHash } = inspectCandidate(meta, binary, Math.max(bootstrapCards, current?.cards ?? 0));
  const report = JSON.parse(await readFile(join(directory, 'yugioh-index.build.json'), 'utf8'));
  if (report.selection !== 'full' || report.limit !== null || report.failures.length > allowedLoss) {
    throw new Error(`Expected a full index with at most ${allowedLoss} unavailable artworks`);
  }
  const related = await readFile(join(directory, 'related-cards.json'));
  const fingerprint = sha256(JSON.stringify([meta.layoutKey, entriesHash, report.artworkSourcesSha256, sha256(related)]));
  const changed = current?.fingerprint !== fingerprint;
  console.log(`Vision index: ${current?.cards ?? bootstrapCards} -> ${cards} cards, changed=${changed}`);
  if (changed) {
    await writeFile(metaPath, `${JSON.stringify({ ...meta, indexSha256: sha256(new Uint8Array(binary)) })}\n`);
    const files = Object.fromEntries(await Promise.all(assetNames.map(async (name: string) => {
      const bytes = await readFile(join(directory, name));
      return [name, { url: assetUrl(release, name), sha256: sha256(bytes), bytes: bytes.length }];
    })));
    await writeFile(output, `${JSON.stringify({ version: 1, release, cards, fingerprint, files }, null, 2)}\n`);
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, output, release] = process.argv.slice(2);
  if (!directory || !output || !/^vision-index-\d+-\d+$/.test(release ?? '')) {
    throw new Error('Usage: node --import tsx weekly-index.ts <candidate directory> <output manifest> <release tag>');
  }
  await prepareCandidate(directory, output, release);
}
