/** Score one reader on the pinned frames of a realset/1 holdout. */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cpus } from 'node:os';
import { isCovered } from '../../packages/vision/src/board';
import { defaultDataDir, jpegDecoder } from './clip-node';
import { parseManifest, sha256 } from './realset-schema';
import { MATCH_IOU, scoreFrame, summarize, type Prediction } from './realset-metrics';
import { openRealsetReader } from './realset-reader';

const { values } = parseArgs({ options: {
  manifest: { type: 'string' }, reader: { type: 'string', default: 'current' },
  data: { type: 'string' }, threads: { type: 'string', default: '2' }, out: { type: 'string' },
} });
const { reader } = values, threads = Number(values.threads);
if (!values.manifest || !values.out || (reader !== 'current' && reader !== 'hybrid') || !Number.isSafeInteger(threads) || threads < 1) {
  throw new Error('Usage: node --import tsx scripts/vision/score-realset.ts --manifest path/manifest.json --reader current|hybrid --out output-prefix [--data data/vision] [--threads 2]');
}
const manifestFile = resolve(values.manifest);
const bytes = await readFile(manifestFile);
const manifest = parseManifest(JSON.parse(bytes.toString('utf8')));
const decode = await jpegDecoder();
const loaded = await openRealsetReader(reader, values.data ?? defaultDataDir(), threads);

try {
  const frames = [];
  for (const frame of manifest.frames) {
    const pixels = await readFile(join(dirname(manifestFile), frame.file));
    if (sha256(pixels) !== frame.sha256) throw new Error(`Frame hash mismatch: ${frame.file}`);
    const image = await decode(pixels);
    const start = performance.now();
    const outlines = await loaded.pipeline.detectCards(image);
    const predictions: Prediction[] = [];
    for (const outline of outlines) {
      if (outline.kind === 'face-down') {
        predictions.push({ quad: outline.quad, faceDown: true, tier: 'not sure' });
        continue;
      }
      const result = await loaded.pipeline.recognize([image], {
        card: { ...outline, covered: Boolean(outline.covered || isCovered(outline, outlines)) }, maxFrames: 1,
      });
      loaded.assertNoFallback();
      const stage = result.reader?.stage;
      if (reader === 'hybrid' && stage !== 'first' && (stage !== 'second' || result.reader?.model === 'current')) {
        throw new Error('Hybrid did not use the released first or second stage');
      }
      const faceDown = Boolean(result.quality.faceDown);
      const cardId = faceDown ? undefined : result.candidates[0]?.cardId;
      predictions.push({
        quad: outline.quad, faceDown, tier: result.tier, cardId,
        name: cardId ? loaded.names.get(cardId) : undefined,
        stage: stage === 'first' || stage === 'second' ? stage : undefined,
      });
    }
    frames.push(scoreFrame(frame, predictions, performance.now() - start));
  }
  const metrics = summarize(frames);
  const report = {
    schema: 'vision-realset-score/1', reader, setVersion: manifest.version, manifestSha256: sha256(bytes),
    modelIds: loaded.modelIds, assetSha256: loaded.assets,
    runtime: { provider: 'onnxruntime-node cpu', version: loaded.runtime, threads, node: process.version, cpu: cpus()[0]?.model },
    protocol: { matchIou: MATCH_IOU, catalogOnly: true, defaultThresholds: true, singleFrame: true },
    clips: manifest.clips.length, metrics, frames,
  };
  const fmt = (m: typeof metrics.top1) => m.rate === null ? 'n/a (0 labels)' : `${m.count}/${m.total} (${(m.rate * 100).toFixed(1)}%)`;
  const table = [
    '| Reader | Frames | Right name top-1 | Sure-wrong | Not sure | Missed face-up | Phantom detections | Frames with phantoms | Face-down correct | Frame p50 / p95 (ms) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${reader === 'current' ? 'Current' : 'Hybrid'} | ${metrics.frames} | ${fmt(metrics.top1)} | ${fmt(metrics.sureWrong)} | ${fmt(metrics.notSure)} | ${metrics.missed} | ${metrics.phantoms} | ${fmt(metrics.phantomFrames)} | ${fmt(metrics.faceDown)} | ${metrics.frameMs.p50} / ${metrics.frameMs.p95} |`,
  ].join('\n') + '\n';
  await writeFile(`${values.out}.json`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await writeFile(`${values.out}.md`, table, { mode: 0o600 });
  process.stdout.write(table);
} finally {
  await loaded.release();
}
