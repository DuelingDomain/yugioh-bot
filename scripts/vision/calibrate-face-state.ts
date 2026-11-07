/** Offline, deterministic face-state calibration. No downloads, servers or saved images. */
import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { createCardDetector } from '../../packages/vision/src/detector/detector';
import { warpQuad, type Quad } from '../../packages/vision/src/geometry';
import type { SessionLike, TensorCtor } from '../../packages/vision/src/embed';
import type { RGBAImage } from '../../packages/vision/src/pixels';
import { classifyFaceState, isLikelyFaceDown } from '../../packages/vision/src/face-state';

const { values } = parseArgs({ options: {
  data: { type: 'string', default: process.env.VISION_DATA_DIR ?? 'data/vision' },
  feedback: { type: 'string' }, diagnostics: { type: 'string' }, fronts: { type: 'string' }, out: { type: 'string', default: 'data/face-state/report.json' },
} });
const dataDir = resolve(values.data!), width = 144, height = 210;
let seed = 633;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const rgba = async (file: string): Promise<RGBAImage> => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};
const resize = async (image: RGBAImage, blur = 0): Promise<RGBAImage> => {
  let pipeline = sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).resize(width, height);
  if (blur) pipeline = pipeline.blur(blur);
  return { data: await pipeline.raw().toBuffer(), width, height };
};
const hash = (v: string) => createHash('sha256').update(v).digest().readUInt32LE(0);
type Sample = { id: string; group: string; down: boolean; crop: RGBAImage; reference: RGBAImage; split: string };
const fronts: { id: string; crop: RGBAImage; source: string; identity?: string }[] = [];
const session = await ort.InferenceSession.create(join(dataDir, 'models/card-detector.onnx'), { intraOpNumThreads: 2, interOpNumThreads: 1 });
const detector = createCardDetector({ session: session as unknown as SessionLike, Tensor: ort.Tensor as unknown as TensorCtor });
try {
  const photos = JSON.parse(await readFile(join(dataDir, 'benchmark/photos.json'), 'utf8')) as { file: string; cardId: string }[];
  for (const photo of photos) {
    const frame = await rgba(join(dataDir, 'benchmark', photo.file));
    const cards = await detector.findCards(frame, { refine: true });
    const card = cards.find(c => c.kind === 'face-up' && c.conf > .4);
    if (!card) throw new Error(`Missing face-up fixture: ${photo.file}`);
    const crop = warpQuad(frame, card.pts.map(([x, y]) => ({ x, y })) as Quad, width, height);
    if (!crop) throw new Error(`Cannot warp ${photo.file}`);
    fronts.push({ id: photo.cardId, crop, source: 'vision benchmark (synthetic camera)' });
  }
} finally { await session.release(); }
for (const [directory, source] of [[values.feedback, 'retained feedback'], [values.fronts, 'full card image']] as const) {
  if (!directory) continue;
  for (const file of (await readdir(directory)).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).sort()) {
    const crop = await rgba(join(directory, file));
    // Art-only catalog thumbnails are NOT whole cards and cannot be labelled face-up here.
    if (crop.height / crop.width < 1.3 || crop.height / crop.width > 1.65) continue;
    fronts.push({ id: `${source}:${file}`, crop: await resize(crop), source, identity: /^(\d+)/.exec(file)?.[1] });
  }
}

/** Lighting gradient, localized glossy highlight, sensor noise, defocus, exposure and 180/90-degree pose. */
async function camera(image: RGBAImage, variant: number): Promise<RGBAImage> {
  const crop = await resize(image, variant % 3 === 2 ? 1.1 : .4);
  const pixels = Uint8Array.from(crop.data), exposure = [.62, .85, 1.05, 1.2][variant % 4];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, light = .78 + .24 * u + .10 * v;
    const shine = variant % 2 ? .50 * Math.exp(-(((u - .65) / .16) ** 2) - ((v - .35) / .25) ** 2) : 0;
    for (let c = 0; c < 3; c++) {
      const i = (y * width + x) * 4 + c;
      pixels[i] = Math.max(0, Math.min(255, (pixels[i] * exposure * light) * (1 - shine) + 255 * shine + (random() - .5) * 7));
    }
  }
  const rotated = await sharp(pixels, { raw: { width, height, channels: 4 } }).rotate(variant % 3 === 0 ? 180 : variant % 3 === 1 ? 90 : 0).raw().toBuffer({ resolveWithObject: true });
  return { data: rotated.data, width: rotated.info.width, height: rotated.info.height };
}
function sleeve(kind: number): RGBAImage {
  const pixels = new Uint8Array(width * height * 4);
  const colors = [[250, 250, 250], [7, 7, 7], [220, 25, 40], [20, 65, 215], [25, 175, 65], [95, 35, 155]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let color = colors[kind % colors.length];
    if (kind >= 6) {
      const a = .5 + .5 * Math.sin(x * .18 + y * .07), b = .5 + .5 * Math.cos(y * .15 - x * .06);
      color = kind % 2 ? [40 + 180 * a, 40 + 170 * b, 70 + 130 * a * b] :
        ((Math.floor(x / 14) + Math.floor(y / 14)) % 2 ? [220, 160, 55] : [40, 65, 165]);
    }
    pixels.set([...color, 255], (y * width + x) * 4);
  }
  return { data: pixels, width, height };
}

// Three retained screenshot captures, one JPEG per source (do not count alternate warps twice).
if (values.diagnostics) for (const file of (await readdir(values.diagnostics)).filter(f => f.endsWith('-default-warp.jpg')).sort()) {
  fronts.push({ id: `diagnostic:${file}`, identity: '27204311', crop: await resize(await rgba(join(values.diagnostics, file))), source: 'retained screenshot crop' });
}
const samples: Sample[] = [], sleeves = Array.from({ length: 10 }, (_, i) => sleeve(i));
const officialBack = await resize(await rgba(join(dataDir, 'training/card-back.jpg')));
// Keep the same identity in one split, even if retained feedback duplicates a benchmark card.
const feedbackManifest = values.feedback ? await readFile(join(resolve(values.feedback, '../export'), 'manifest.json'), 'utf8').then(JSON.parse).catch(() => []) : [];
for (const front of fronts) {
  const feedbackId = feedbackManifest.find((row: { file: string; cardId: string }) => front.id.endsWith(row.file))?.cardId;
  const identity = feedbackId ?? front.identity ?? front.id, split = hash(identity) % 3 === 0 ? 'calibration' : 'evaluation conditions';
  for (let variant = 0; variant < 4; variant++) samples.push({ id: `${front.id}:${variant}`, group: front.source, down: false, crop: await camera(front.crop, variant), reference: front.crop, split });
  const dark = { ...front.crop, data: Uint8Array.from(front.crop.data, (v,i) => i%4 === 3 ? v : v*.1) };
  const blurred = await resize(front.crop, 10);
  for (const [condition, crop] of [['dark',dark], ['defocus',blurred]] as const)
    samples.push({id:`${front.id}:${condition}`, group:'lost-detail face-up', down:false, crop, reference:front.crop, split});
}
// Repeating seeds/conditions differ by split; these are synthetic sleeves, not real sleeve labels.
for (let i = 0; i < 240; i++) {
  const kind = i % 12, back = kind < 10 ? sleeves[kind] : kind === 10 ? officialBack :
    // Adversarial all-over artwork sleeve: use existing art-only catalog images.
    await resize(await rgba(join(dataDir, 'thumbnails', `${fronts[i % 30].id}.jpg`)));
  samples.push({ id: `sleeve:${i}`, group: kind < 6 ? 'plain sleeve' : kind < 10 ? 'pattern sleeve' : kind === 10 ? 'official back' : 'art sleeve',
    down: true, crop: await camera(back, Math.floor(i / 12)), reference: fronts[i % fronts.length].crop,
    split: Math.floor(i / 12) % 3 === 0 ? 'calibration' : 'evaluation conditions' });
}

type Counts = { tp: number; fp: number; fn: number; tn: number; unknown: number };
const rows: Record<string, Counts> = {}, mistakes: { mode: string; id: string; group: string; state: string }[] = [];
for (const sample of samples) for (const mode of ['crop only', 'bound reference']) {
  const result = classifyFaceState(sample.crop, mode === 'bound reference' ? { reference: { crop: sample.reference } } : {});
  const key = `${sample.split} / ${mode}`, count = rows[key] ??= { tp: 0, fp: 0, fn: 0, tn: 0, unknown: 0 };
  if (sample.down) { if (result.state === 'down') count.tp++; else count.fn++; }
  else { if (result.state === 'down') count.fp++; else count.tn++; }
  if (result.state === 'unknown') count.unknown++;
  if ((result.state === 'down') !== sample.down) mistakes.push({ mode, id: sample.id, group: sample.group, state: result.state });
}
const summary = Object.entries(rows).map(([mode, count]) => ({ mode, ...count, precision: count.tp / (count.tp + count.fp) || 0, recall: count.tp / (count.tp + count.fn) || 0 }));
const groups = [...new Set(samples.map(s => s.group))].map(group => {
  const set = samples.filter(s => s.split === 'evaluation conditions' && s.group === group);
  return { group, n: set.length, down: set.filter(s => s.down).length,
    cropDown: set.filter(s => isLikelyFaceDown(s.crop)).length,
    boundDown: set.filter(s => classifyFaceState(s.crop, { reference: { crop: s.reference } }).state === 'down').length };
});
const timing: Record<string, { wallP50: number; wallP95: number; wallMax: number; cpuMean: number }> = {};
for (const mode of ['crop only', 'bound reference']) {
  for (let i = 0; i < 300; i++) {
    const sample = samples[i % samples.length];
    classifyFaceState(sample.crop, mode === 'bound reference' ? { reference: { crop: sample.reference } } : {});
  }
  const times: number[] = [], cpuStart = process.threadCpuUsage();
  for (let i = 0; i < 1000; i++) {
    const sample = samples[i % samples.length], start = performance.now();
    classifyFaceState(sample.crop, mode === 'bound reference' ? { reference: { crop: sample.reference } } : {});
    times.push(performance.now() - start);

  }
  const cpu = process.threadCpuUsage(cpuStart);
  times.sort((a, b) => a - b);
  timing[mode] = { wallP50: times[500], wallP95: times[950], wallMax: times[999], cpuMean: (cpu.user + cpu.system) / 1_000_000 };
}
const report = { seed: 633, sources: { vision: dataDir, feedback: values.feedback, diagnostics: values.diagnostics, fronts: values.fronts }, fronts: fronts.length,
  splitNotes: 'Front identities are disjoint; sleeve designs/art are shared, camera conditions differ. These are finite calibration fixtures, not unseen-sleeve accuracy.', positiveClass: 'face-down; unknown counts as a missed face-down', summary, groups, timing, mistakes };
await mkdir(resolve(values.out!, '..'), { recursive: true });
await writeFile(values.out!, JSON.stringify(report, null, 2) + '\n');
console.table(summary); console.table(groups); console.table(timing);
console.log(`Report: ${resolve(values.out!)}`);
