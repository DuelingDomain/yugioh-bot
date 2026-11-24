/** Freeze reviewed annotations and PNG snapshots as a local, versioned holdout manifest. */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { annotationFiles, makeManifest, sha256 } from './realset-schema';

const dir = process.argv[2];
if (!dir || process.argv.length !== 3) throw new Error('Usage: node --import tsx scripts/vision/build-realset.ts data/vision/realset/v1');
const root = resolve(dir);
const input: unknown = JSON.parse(await readFile(join(root, 'annotations.json'), 'utf8'));
const hashes = new Map<string, string>();
for (const file of annotationFiles(input)) hashes.set(file, sha256(await readFile(join(root, file))));
const manifest = makeManifest(input, hashes);
await writeFile(join(root, 'HOLDOUT'), 'Fixed evaluation set. Keep out of training and tuning.\n', { mode: 0o600 });
await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`Froze ${manifest.frames.length} frames from ${manifest.clips.length} clips in ${root}`);
