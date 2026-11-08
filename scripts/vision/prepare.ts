/**
 * Reproducible model/runtime setup; never executes code from the upstream repository.
 * --code-only writes just worker.js, ort/ and NOTICE: no network, no models, no Python. The web image build uses it.
 */
import {execFileSync} from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import { prepareRelatedCards } from './build-related';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(process.env.VISION_DATA_DIR ?? path.join(root, 'data/vision'));
const revision = 'f6968f3682d53a79c4a9fef591300615eda61c11';
const models = [
  { file: 'dinov2-small-duel.q8.onnx', source: 'extension/models/dinov2-small-duel.q8.onnx', sha: yugioh.embedding.sha256 },
  { file: 'card-detector.onnx', source: 'extension/models/detector/card-detector.onnx', sha: yugioh.detector.sha256 },
];
const codeOnly = process.argv.includes('--code-only');
if (codeOnly && ['--related', '--webgpu'].some(flag => process.argv.includes(flag))) throw new Error('--code-only cannot be combined with --related or --webgpu');
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
if (process.argv.includes('--related')) {
  await prepareRelatedCards(path.resolve(process.env.DUEL_DATA_DIR ?? process.env.DUEL_ENGINE_DATA_DIR ?? path.join(root, 'data/duel-engine')), path.join(out, 'related-cards.json'));
}
if (!codeOnly) await mkdir(path.join(out, 'models'), { recursive: true });
for (const model of codeOnly || process.argv.includes('--bundle-only') ? [] : models) {
  const dest = path.join(out, 'models', model.file);
  let existing: Buffer | undefined;
  try { existing = await readFile(dest); } catch {}
  if (existing && sha(existing) === model.sha) continue;
  const response = await fetch(`https://raw.githubusercontent.com/mathulbrich/duel-lens/${revision}/${model.source}`);
  if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status}): ${model.file}. See packages/vision/README.md for DINOv2 fallback.`);
  const data = Buffer.from(await response.arrayBuffer());
  if (sha(data) !== model.sha) throw new Error(`Checksum failed: ${model.file}`);
  await writeFile(`${dest}.part`, data); await rename(`${dest}.part`, dest);
}
if(process.argv.includes('--webgpu')) {
  execFileSync(process.env.VISION_PYTHON??'python3',[path.join(root,'scripts/vision/export-runtime-models.py'),'--data',out,'--export-only'],{stdio:'inherit'});
  for(const variant of [yugioh.embedding.webgpu!,yugioh.embedding.webgpu!.fp32!,yugioh.detector.webgpu!]) {
    const file=path.join(out,'models',path.basename(variant.url));
    if(sha(await readFile(file))!==variant.sha256)throw new Error(`WebGPU export checksum mismatch: ${file}. Use the pinned Python dependencies in README.md.`);
  }
}
const require = createRequire(import.meta.url);
const runtimeDir = path.dirname(require.resolve('onnxruntime-web/wasm'));
await mkdir(path.join(out, 'ort'), { recursive: true });
// Only the plain WASM + WebGPU asyncify builds; omit JSEP/JSPI, maps and unused providers.
for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) await copyFile(path.join(runtimeDir, file), path.join(out, 'ort', file));
// The npm web package omits these files; retain the exact upstream v1.30.0 notices.
for (const file of ['LICENSE', 'ThirdPartyNotices.txt']) await copyFile(path.join(root, 'packages/vision/src/licenses', `onnxruntime.${file}`), path.join(out, 'ort', file));
await copyFile(path.join(root, 'NOTICE'), path.join(out, 'NOTICE'));
// The model notices ship with the models, in the data volume.
if (!codeOnly) {
  await copyFile(path.join(root, 'packages/vision/src/licenses/duel-lens.LICENSE'), path.join(out, 'models/LICENSE'));
  await copyFile(path.join(root, 'packages/vision/src/licenses/duel-lens.THIRD_PARTY_NOTICES.md'), path.join(out, 'models/THIRD_PARTY_NOTICES.md'));
}
await build({ entryPoints: [path.join(root, 'packages/vision/src/worker.ts')], outfile: path.join(out, 'worker.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof' });
console.log(`Vision ${codeOnly ? 'worker and ONNX runtime' : 'models, worker and ONNX runtime'} ready in ${out}`);
