/** In-page side of benchmark-cpu.ts: a synthetic camera (MediaStreamTrackGenerator) and the real watcher, CPU mode, with stage timers. */
import { createOwnFeedBuffer, createRecognizer, createFieldWatcher, createFieldCalibration, fieldMatPoint, fieldZoneCells, yugioh } from '../../packages/vision/src/index';
import { createFieldAnalyzer, type FieldAnalysis, type FieldFrame } from '../../packages/vision/src/field-motion';

const W = 1920, H = 1080, SLOTS = ['M1', 'M2', 'M3', 'M4', 'M5'];
type Stat = { ms: number; n: number; max: number };
const stages: Record<string, Stat> = {};
let recording = false;
const add = (name: string, ms: number) => { if (!recording) return; const s = stages[name] ??= { ms: 0, n: 0, max: 0 }; s.ms += ms; s.n++; s.max = Math.max(s.max, ms); };
const clock = () => performance.now();

let NOISE = 7, cardScale = 1;
function noiseTable() { const t = new Int8Array(1 << 16); for (let i = 0; i < t.length; i++) t[i] = Math.round((Math.random() + Math.random() - 1) * NOISE); return t; }
let noise = noiseTable();
interface Card { image: ImageBitmap; id: string }
const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d', { willReadFrequently: true })!;
let matBase: ImageBitmap;
async function makeMat() {
  ctx.fillStyle = '#24282a'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) { const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 160); const x = Math.random() * W, y = Math.random() * H; g.addColorStop(0, `rgba(${90 + Math.random() * 40},${90 + Math.random() * 40},${120},.05)`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.save(); ctx.translate(x, y); ctx.fillStyle = g; ctx.fillRect(-160, -160, 320, 320); ctx.restore(); }
  matBase = await createImageBitmap(canvas);
}
const calibration = createFieldCalibration([{ x: .08, y: .04 }, { x: .92, y: .04 }, { x: .92, y: .96 }, { x: .08, y: .96 }], { playerSide: 'bottom', mirrored: false });
const cellCenter = (zone: string) => { const c = fieldZoneCells('normal', calibration.zoneSpacing, calibration.zones).find(cell => cell.zone === zone)!; const m = fieldMatPoint({ x: c.x + c.w / 2, y: c.y + c.h / 2 }, calibration), a = fieldMatPoint({ x: c.x, y: c.y }, calibration), b = fieldMatPoint({ x: c.x, y: c.y + c.h }, calibration); return { x: m.x * W, y: m.y * H, cellH: Math.abs(b.y - a.y) * H }; };
function drawHand(x: number, y: number) {
  // A forearm from the bottom edge up to (x,y): skin tones, soft shape.
  ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = '#c99a7c'; ctx.lineWidth = 138; ctx.beginPath(); ctx.moveTo(x + 40, H + 80); ctx.lineTo(x, y + 70); ctx.stroke();
  ctx.strokeStyle = '#d6a98c'; ctx.lineWidth = 92; ctx.beginPath(); ctx.moveTo(x + 40, H + 80); ctx.lineTo(x, y + 70); ctx.stroke(); ctx.restore();
}
function renderFrame(cards: { card: Card; x: number; y: number; h: number }[], hand?: { x: number; y: number }) {
  ctx.drawImage(matBase, 0, 0);
  for (const c of cards) { const w = c.h * c.card.image.width / c.card.image.height; ctx.drawImage(c.card.image, c.x - w / 2, c.y - c.h / 2, w, c.h); }
  if (hand) drawHand(hand.x, hand.y);
  const image = ctx.getImageData(0, 0, W, H), d = image.data; let n = Math.floor(Math.random() * 60000);
  for (let i = 0; i < d.length; i += 4) { const v = noise[(n++) & 65535]; d[i] += v; d[i + 1] += v; d[i + 2] += noise[(n += 3) & 65535]; }
  return createImageBitmap(image);
}
const events: any[] = [], trace: any[] = [], ticks: any[] = [];
let script: { frames: ImageBitmap[]; loop: boolean; at: number; done?: () => void } | undefined;
const play = (frames: ImageBitmap[], loop = false) => new Promise<void>(done => { script = { frames, loop, at: clock(), done: loop ? undefined : done }; if (loop) done(); });
let beganAt = 0, gaps: number[] = [], lastVideoAt = 0, lag: number[] = [], longTasks = { n: 0, ms: 0, max: 0 };
let watcher: ReturnType<typeof createFieldWatcher> | undefined, video: HTMLVideoElement, reader: ReturnType<typeof createRecognizer>;
const metricsLog: { at: number; duty: number; interval: number; status: string }[] = [];
let passes = { full: 0, crop: 0, shadow: 0 }, reads = 0, notifies = 0, fps = 30;

async function startCamera() {
  const generator = new (window as any).MediaStreamTrackGenerator({ kind: 'video' }), writer = generator.writable.getWriter();
  let serial = 0;
  setInterval(async () => {
    if (!script) return;
    const index = Math.floor((clock() - script.at) * fps / 1000);
    let bitmap: ImageBitmap;
    if (script.loop) bitmap = script.frames[index % script.frames.length];
    else if (index < script.frames.length) bitmap = script.frames[index];
    else { bitmap = script.frames[script.frames.length - 1]; const done = script.done; script.done = undefined; done?.(); }
    const frame = new (window as any).VideoFrame(bitmap, { timestamp: ++serial * 33333 });
    try { await writer.write(frame); } catch { frame.close(); }
  }, 1000 / fps);
  video = document.createElement('video'); video.muted = true; video.playsInline = true; video.width = 640; video.height = 360;
  video.srcObject = new MediaStream([generator]); document.body.append(video);
  await new Promise<void>(resolve => { const check = () => { script = script; if (video.readyState >= 2) resolve(); else setTimeout(check, 50); }; check(); });
  const onVideo = (now: number) => { if (recording) { if (lastVideoAt) gaps.push(now - lastVideoAt); lastVideoAt = now; } (video as any).requestVideoFrameCallback(onVideo); };
  (video as any).requestVideoFrameCallback(onVideo);
  void video.play();
}
function board(cards: Card[], placed: number[]) { return placed.map(i => { const c = cellCenter(SLOTS[i]); return { card: cards[i], x: c.x, y: c.y, h: c.cellH * .78 * cardScale }; }); }
async function loopFrames(cards: Card[], placed: number[], n = 3) { const f: ImageBitmap[] = []; for (let i = 0; i < n; i++) f.push(await renderFrame(board(cards, placed))); return f; }
async function placeFrames(cards: Card[], before: number[], i: number) {
  const c = cellCenter(SLOTS[i]), h = c.cellH * .78, f: ImageBitmap[] = [], base = board(cards, before);
  for (let k = 0; k <= 8; k++) { const y = H + 160 + (c.y - H - 160) * k / 8; f.push(await renderFrame([...base, { card: cards[i], x: c.x, y, h }], { x: c.x + 16, y: y + h * .36 })); f.push(f.at(-1)!); }
  const downAt = f.length;
  for (let k = 1; k <= 6; k++) { const y = c.y + h * .36 + 40 * k + k * k * 8; f.push(await renderFrame([...base, { card: cards[i], x: c.x, y: c.y, h }], { x: c.x + 16, y })); f.push(f.at(-1)!); }
  return { frames: f, downAt };
}
async function removeFrames(cards: Card[], before: number[], i: number) {
  const c = cellCenter(SLOTS[i]), h = c.cellH * .78, f: ImageBitmap[] = [], rest = board(cards, before.filter(v => v !== i));
  for (let k = 6; k >= 0; k--) { const y = c.y + h * .36 + 40 * k + k * k * 8; f.push(await renderFrame([...rest, { card: cards[i], x: c.x, y: c.y, h }], { x: c.x + 16, y })); f.push(f.at(-1)!); }
  for (let k = 1; k <= 8; k++) { const y = c.y + (H + 160 - c.y) * k / 8; f.push(await renderFrame([...rest, { card: cards[i], x: c.x, y, h }], { x: c.x + 16, y: y + h * .36 })); f.push(f.at(-1)!); }
  return f;
}
function timedAnalyzer() {
  const base = createFieldAnalyzer();
  const wrap = (frame: FieldFrame): FieldAnalysis => {
    const t = clock(), a = base(frame) as any; add('main.analyze(motion+shadow+sharp)', clock() - t);
    if (a.scene) { add('scene.samples', 0); if (a.scene.moving > 0) add('scene.moving', a.scene.moving); if (a.scene.sinceMark > 0) add('scene.dirty', a.scene.sinceMark); }
    for (const key of ['crop', 'motion', 'appearance', 'touched', 'halo', 'sharpness', 'background', 'motionOutside']) if (typeof a[key] === 'function') { const fn = a[key]; a[key] = (...args: unknown[]) => { const s = clock(), v = fn.apply(a, args); add(`main.evidence.${key}`, clock() - s); return v; }; }
    return a;
  };
  return Object.assign(wrap, { reset: base.reset });
}
export async function setup(config: { cards: { id: string; url: string }[]; scene: string; threads?: number; profile?: Record<string, unknown>; workers?: 'auto' | 'single' | 'split'; backend?: 'auto' | 'wasm'; opts?: Record<string, unknown>; noise?: number; spinning?: boolean; longSide?: number; detector?: { url: string; sha256: string } }) {
  if ((config as any).cardScale) cardScale = (config as any).cardScale;
  if (config.noise !== undefined) { NOISE = config.noise; noise = noiseTable(); }
  const cards: Card[] = [];
  for (const c of config.cards) { const r = await fetch(c.url); cards.push({ id: c.id, image: await createImageBitmap(await r.blob()) }); }
  await makeMat();
  new PerformanceObserver(list => { if (!recording) return; for (const e of list.getEntries()) { if (e.startTime < beganAt) continue; longTasks.n++; longTasks.ms += e.duration; longTasks.max = Math.max(longTasks.max, e.duration); } }).observe({ entryTypes: ['longtask'] });
  let last = clock(); setInterval(() => { const at = clock(); if (recording) lag.push(Math.max(0, at - last - 50)); last = at; }, 50);
  const empty = await loopFrames(cards, [], 3);
  const all = [0, 1, 2, 3, 4];
  (window as any).__scene = { cards, empty, all };
  if (config.scene === 'steady' || config.scene === 'pass' || config.scene === 'grab') await play(await loopFrames(cards, all, 3), true); else await play(empty, true);
  await startCamera();
  if (config.scene === 'control') return { hardwareConcurrency: navigator.hardwareConcurrency, isolated: crossOriginIsolated };
  reader = createRecognizer({ backend: config.backend ?? 'wasm', workers: config.workers ?? 'auto', ...(config.threads ? { threads: config.threads } : {}), ...(config.spinning === false ? { spinning: false } : {}), profile: { ...yugioh, detector: { ...yugioh.detector, ...(config.longSide ? { longSide: config.longSide } : {}), ...(config.detector ?? {}) } } } as any);
  if (config.scene === 'pass' || config.scene === 'grab') return { hardwareConcurrency: navigator.hardwareConcurrency, isolated: crossOriginIsolated };
  const raw = createOwnFeedBuffer(video);
  const recognizer = {
    get detectorBackend() { return reader.detectorBackend; }, get detectorTimingsMs() { return reader.detectorTimingsMs; }, get separateDetector() { return reader.separateDetector; },
    prepare: (o?: any) => reader.prepare(o),
    detectCards: async (frame: any, o?: any) => {
      const t = clock(), result = await reader.detectCards(frame, o); add(o?.region ? 'detect.roundTrip(crop)' : 'detect.roundTrip(full)', clock() - t);
      if (o?.region) passes.crop++; else passes.full++;
      if (recording) trace.push({ at: t, end: clock(), crop: !!o?.region, n: result.length, confs: result.map(c => Number(c.confidence.toFixed(2))), path: watcher?.getSnapshot().debug?.path });
      const timing = reader.detectorTimingsMs as any; if (timing) for (const key of Object.keys(timing)) add(`worker.detect.${key}`, timing[key]);
      if (timing?.shadowPasses) passes.shadow += timing.shadowPasses;
      return result;
    },
    recognize: async (frames: any, o?: any) => { const t = clock(), result = await reader.recognize(frames, o); add('read.roundTrip', clock() - t); reads++; for (const key of Object.keys(result.timingsMs ?? {})) add(`worker.read.${key}`, (result.timingsMs as any)[key]); return result; },
  };
  const buffer = { sample: async (o?: any) => { const t = clock(), r = await raw.sample(o); add('main.frameGrab(sample)', clock() - t); return r; } };
  watcher = createFieldWatcher({ recognizer: recognizer as any, buffer, profile: yugioh as any, calibration, earlyExitMargin: .02, getPriors: () => ({ decklist: cards.map(c => c.id) }), analyze: timedAnalyzer() as any,
    clone: (async (frame: any) => { const t = clock(), r = await createImageBitmap(frame); add('main.frameClone', clock() - t); return r; }) as any, ...(config.opts ?? {}) } as any);
  watcher.subscribe(event => {
    events.push({ type: event.type, at: clock(), zone: event.track.zone, cardId: event.track.cardId, id: event.track.id, reason: event.reason, faceDown: event.track.faceDown });
    if (event.type === 'placed' || event.type === 'prompt') watcher!.confirm(event.track.id, event.track.cardId, `ref-${event.track.id}`, false);
  });
  watcher.subscribeState(() => { notifies++; if (!recording) return; const s = watcher!.getSnapshot(); metricsLog.push({ at: clock(), duty: s.metrics.dutyPercent, interval: s.metrics.intervalMs, status: s.status }); ticks.push({ at: Math.round(clock() - beganAt), path: s.debug?.path, st: s.status }); });
  watcher.start();
  return { hardwareConcurrency: navigator.hardwareConcurrency, isolated: crossOriginIsolated };
}
export const backend = () => reader?.backendStatus;
export const placedCount = () => events.filter(e => e.type === 'placed').length;
export function begin() { recording = true; beganAt = clock(); for (const k of Object.keys(stages)) delete stages[k]; metricsLog.length = 0; gaps = []; lag = []; lastVideoAt = 0; longTasks = { n: 0, ms: 0, max: 0 }; passes = { full: 0, crop: 0, shadow: 0 }; reads = 0; notifies = 0; }
export function end() {
  recording = false;
  const sorted = (v: number[]) => [...v].sort((a, b) => a - b), pct = (v: number[], p: number) => v.length ? sorted(v)[Math.min(v.length - 1, Math.floor(v.length * p))] : 0;
  const duty = metricsLog.map(m => m.duty), status: Record<string, number> = {}; for (const m of metricsLog) status[m.status] = (status[m.status] ?? 0) + 1;
  return { stages, passes, reads, notifies, longTasks, lagP95: pct(lag, .95), lagMax: pct(lag, 1), videoGapP95: pct(gaps, .95), videoFrames: gaps.length, dutyP50: pct(duty, .5), dutyP95: pct(duty, .95), dutyAt100: duty.filter(d => d >= 95).length / Math.max(1, duty.length), intervalP50: pct(metricsLog.map(m => m.interval), .5), status, snapshot: watcher ? { status: watcher.getSnapshot().status, tracks: watcher.getSnapshot().tracks.map(t => ({ zone: t.zone, state: t.state, cardId: t.cardId, removed: t.removed })) } : undefined };
}
/** The active scene: 5 placements (6 s apart), then 5 removals (6 s apart). Returns placed and removed latencies from the moment the card lands / leaves. */
export async function active(spacingMs = 6000) {
  const { cards } = (window as any).__scene as { cards: Card[] }; const log: any[] = []; const prepared: any[] = [];
  const onBoard: number[] = [];
  for (const i of [0, 1, 2, 3, 4]) { const p = await placeFrames(cards, [...onBoard], i); onBoard.push(i); prepared.push({ kind: 'place', i, ...p, rest: await loopFrames(cards, [...onBoard], 3) }); }
  for (const i of [2, 0, 4, 1, 3]) { const frames = await removeFrames(cards, [...onBoard], i); onBoard.splice(onBoard.indexOf(i), 1); prepared.push({ kind: 'remove', i, frames, rest: await loopFrames(cards, [...onBoard], 3) }); }
  begin();
  const startedAt = clock();
  for (const step of prepared) {
    const t0 = clock(); const landedAt = step.kind === 'place' ? t0 + step.downAt * 1000 / fps : t0 + step.frames.length * 1000 / fps;
    await play(step.frames); const clearAt = clock(); await play(step.rest, true);
    log.push({ kind: step.kind, zone: SLOTS[step.i], cardId: cards[step.i].id, landedAt, clearAt });
    await new Promise(r => setTimeout(r, Math.max(0, spacingMs - (clock() - t0))));
  }
  const seconds = (clock() - startedAt) / 1000, stats = end();
  for (const entry of log) {
    const types = entry.kind === 'place' ? ['placed', 'prompt'] : ['removed'];
    const hit = events.find(e => types.includes(e.type) && e.at >= entry.landedAt - 500 && (e.zone === entry.zone || entry.kind === 'remove' && e.cardId === entry.cardId));
    entry.ms = hit ? hit.at - entry.landedAt : null; entry.fromClear = hit ? hit.at - entry.clearAt : null; entry.eventCard = hit?.cardId; entry.type = hit?.type;
  }
  for (const t of trace) { t.at = Math.round(t.at - startedAt); t.end = Math.round(t.end - startedAt); }
  for (const l of log) { l.landedAt = Math.round(l.landedAt - startedAt); l.clearAt = Math.round(l.clearAt - startedAt); }
  return { ...stats, seconds, log, trace, ticks: ticks.splice(0), events: events.map(e => ({ ...e, at: Math.round(e.at - startedAt) })) };
}
export const allEvents = () => events.map(e => ({ ...e }));

/** Detector passes (and reads) on the real worker: wall per pass; the caller reads CPU from /proc. */
export async function passBench(n: number) {
  await reader.prepare({ priors: { decklist: ((window as any).__scene.cards as Card[]).map(c => c.id) } } as any);
  const first = await reader.detectCards(await createImageBitmap(video)); begin(); const walls: number[] = [], timing: Record<string, number> = {};
  for (let i = 0; i < n; i++) { const frame = await createImageBitmap(video), t = clock(); await reader.detectCards(frame); walls.push(clock() - t); for (const [k, v] of Object.entries(reader.detectorTimingsMs ?? {})) timing[k] = (timing[k] ?? 0) + v / n; }
  walls.sort((a, b) => a - b); return { found: first.length, conf: first.map(c => Number(c.confidence.toFixed(2))), wallP50: walls[n >> 1], wallP90: walls[Math.floor(n * .9)], timing, n };
}
export async function readBench(n: number) {
  const cards = await reader.detectCards(await createImageBitmap(video)), walls: number[] = [], timing: Record<string, number> = {}; let top = '';
  for (let i = 0; i < n; i++) { const frame = await createImageBitmap(video), t = clock(), r = await reader.recognize([frame], { card: cards[i % cards.length], priors: { decklist: ((window as any).__scene.cards as Card[]).map(c => c.id) } } as any); walls.push(clock() - t); top = r.candidates[0]?.cardId ?? ''; for (const [k, v] of Object.entries(r.timingsMs ?? {})) timing[k] = (timing[k] ?? 0) + (v as number) / n; }
  walls.sort((a, b) => a - b); return { wallP50: walls[n >> 1], timing, top, n };
}
/** Main-thread cost of one camera sample, by method. */
export async function grabBench(n: number) {
  const out: Record<string, number> = {}, low = new OffscreenCanvas(320, 180), lc = low.getContext('2d', { willReadFrequently: true })!;
  const each = async (name: string, run: () => Promise<void> | void) => { const t = clock(); for (let i = 0; i < n; i++) { await run(); await new Promise(r => setTimeout(r, 20)); } out[name] = (clock() - t) / n - 20; };
  await each('createImageBitmap(video) 1080p', async () => { (await createImageBitmap(video)).close(); });
  await each('createImageBitmap(video,resize 320)', async () => { (await createImageBitmap(video, { resizeWidth: 320, resizeHeight: 180, resizeQuality: 'low' })).close(); });
  await each('drawImage(video,320)+getImageData', () => { lc.drawImage(video, 0, 0, 320, 180); lc.getImageData(0, 0, 320, 180); });
  const bitmap = await createImageBitmap(video), native = new OffscreenCanvas(1920, 1080), nc = native.getContext('2d', { willReadFrequently: true })!;
  await each('clone bitmap', async () => { (await createImageBitmap(bitmap)).close(); });
  await each('bitmap->320 draw+getImageData', () => { lc.drawImage(bitmap, 0, 0, 320, 180); lc.getImageData(0, 0, 320, 180); });
  await each('bitmap->1080 draw+getImageData', () => { nc.drawImage(bitmap, 0, 0); nc.getImageData(0, 0, 1920, 1080); });
  return out;
}
