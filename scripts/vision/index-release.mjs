import { createHash } from 'node:crypto';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const assetNames = ['yugioh-index.bin', 'yugioh-index.meta.json', 'yugioh-index.build.json', 'related-cards.json'];
export const manifestPath = 'packages/vision/index-manifest.json';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const releasePattern = /^vision-index-\d+-\d+$/;
const sizeLimit = 32 * 1024 * 1024;
export const assetUrl = (release, name) => `https://github.com/DuelingDomain/yugioh-bot/releases/download/${release}/${name}`;

/** @typedef {{ url: string, sha256: string, bytes: number }} Asset */
/** @typedef {{ version: 1, release: string, cards: number, fingerprint: string, files: Record<string, Asset> }} Manifest */

/** @returns {Promise<Manifest | null>} */
export async function readManifest(path = manifestPath) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest === null) return null;
  if (manifest.version !== 1 || !releasePattern.test(manifest.release) ||
      !Number.isSafeInteger(manifest.cards) || manifest.cards < 1 || !hashPattern.test(manifest.fingerprint) ||
      !manifest.files || Object.keys(manifest.files).length !== assetNames.length) {
    throw new Error('Invalid vision index manifest');
  }
  for (const name of assetNames) {
    const asset = manifest.files[name];
    if (!asset || asset.url !== assetUrl(manifest.release, name) || !hashPattern.test(asset.sha256) ||
        !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > sizeLimit) {
      throw new Error(`Invalid vision index pin for ${name}`);
    }
  }
  return manifest;
}

export async function verifyAssets(manifest, directory) {
  for (const name of assetNames) {
    const bytes = await readFile(join(directory, name));
    if (bytes.length !== manifest.files[name].bytes || sha256(bytes) !== manifest.files[name].sha256) {
      throw new Error(`Vision index checksum mismatch: ${name}`);
    }
  }
}

export async function downloadIndex(path, directory, request = fetch) {
  const manifest = await readManifest(path);
  await mkdir(directory, { recursive: true });
  if (!manifest) {
    await utimes(directory, 0, 0);
    return;
  }
  for (const name of assetNames) {
    const asset = manifest.files[name];
    const response = await request(asset.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`Cannot download ${name}: HTTP ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > asset.bytes) throw new Error(`Oversized vision index asset: ${name}`);
      chunks.push(chunk);
    }
    await writeFile(join(directory, name), Buffer.concat(chunks));
  }
  await verifyAssets(manifest, directory);
  // The marker is written only after the whole generation is verified.
  await writeFile(join(directory, 'index-manifest.json'), `${JSON.stringify(manifest)}\n`);
  for (const name of [...assetNames, 'index-manifest.json']) await utimes(join(directory, name), 0, 0);
  await utimes(directory, 0, 0);
  console.log(`Verified ${manifest.release} (${manifest.cards} cards)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, path, directory] = process.argv.slice(2);
  if (!path || !directory) throw new Error('Usage: node index-release.mjs download|verify <manifest> <directory>');
  if (command === 'download') await downloadIndex(path, directory);
  else if (command === 'verify') {
    const manifest = await readManifest(path);
    if (!manifest) throw new Error('Candidate manifest is empty');
    await verifyAssets(manifest, directory);
  } else throw new Error(`Unknown command ${command}`);
}
