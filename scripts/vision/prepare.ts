/** Reproducible model/runtime setup; never executes code from the upstream repository. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { yugioh } from '../../packages/vision/src/games/yugioh';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(process.env.VISION_DATA_DIR ?? path.join(root, 'data/vision'));
const revision = 'f6968f3682d53a79c4a9fef591300615eda61c11';
const models = [
  { file: 'dinov2-small-duel.q8.onnx', source: 'extension/models/dinov2-small-duel.q8.onnx', sha: yugioh.embedding.sha256 },
  { file: 'card-detector.onnx', source: 'extension/models/detector/card-detector.onnx', sha: yugioh.detector.sha256 },
];
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
await mkdir(path.join(out, 'models'), { recursive: true });
for (const model of process.argv.includes('--bundle-only') ? [] : models) {
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
const require = createRequire(import.meta.url);
const runtimeDir = path.dirname(require.resolve('onnxruntime-web/wasm'));
await mkdir(path.join(out, 'ort'), { recursive: true });
// Only the plain WASM + WebGPU asyncify builds; omit JSEP/JSPI, maps and unused providers.
for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) await copyFile(path.join(runtimeDir, file), path.join(out, 'ort', file));
// The npm web package omits these files; retain the exact upstream v1.30.0 notices.
for (const file of ['LICENSE', 'ThirdPartyNotices.txt']) await copyFile(path.join(root, 'packages/vision/src/licenses', `onnxruntime.${file}`), path.join(out, 'ort', file));
await copyFile(path.join(root, 'NOTICE'), path.join(out, 'NOTICE'));
await copyFile(path.join(root, 'packages/vision/src/licenses/duel-lens.LICENSE'), path.join(out, 'models/LICENSE'));
await copyFile(path.join(root, 'packages/vision/src/licenses/duel-lens.THIRD_PARTY_NOTICES.md'), path.join(out, 'models/THIRD_PARTY_NOTICES.md'));
await copyFile(path.join(root, 'packages/vision/src/licenses/dinov3.LICENSE.md'), path.join(out, 'models/DINOv3-LICENSE.md'));
await build({ entryPoints: [path.join(root, 'packages/vision/src/worker.ts')], outfile: path.join(out, 'worker.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof' });
console.log(`Vision models, worker and ONNX runtime ready in ${out}`);
