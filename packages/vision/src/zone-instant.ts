/**
 * Instant zone path: read a face-up card the moment its zone settles (own seat, Auto-detect only).
 *
 * The zone watch (zone-events.ts) runs on small grey frames of the own camera. When a zone moves and then rests, this
 * controller takes one fresh full-size frame, asks the heuristic zone classifier (zone-state.ts) if something that is not
 * a hand lies in the zone, and sends that zone crop straight to the card reader. It never places a card itself: the
 * result goes back to the field watcher (`deliver`), which runs it through its normal outline, rest, hand, twin and slot
 * guards. A card that is not sure, not face-up or not alone in its zone is left to the normal pipeline.
 *
 * Cost control: one read per zone per settle, a cap per second, and it yields to scans and other reads (`busy`).
 * No model is trained and none runs here except the existing reader.
 */
import { createZoneWatch, zoneSpecsFromCalibration, type GrayFrame, type ZoneTier } from './zone-events';
import { classifyZone, estimateMat, zoneCrop, type MatColour, type ZoneKind } from './zone-state';
import { warpQuad, type Quad } from './geometry';
import type { FieldCalibration, FieldFormat, FieldZone } from './field-zones';
import type { FieldFrame } from './field-motion';
import type { RGBAImage } from './pixels';
import type { DetectedQuad, Point, RecognitionResult } from './types';

export interface ZoneInstantRead {
  zone: FieldZone;
  /** Zone outline (portrait corner order) the reader was given. */
  card: DetectedQuad;
  result: RecognitionResult;
  /** Last moment of movement (watcher clock): the card rests from here. */
  since: number;
  /** When the read started (watcher clock). */
  readAt: number;
  /** Camera time of the frame the read used (watcher clock): a track may use the read only from a newer frame. */
  frameAt: number;
  kind: ZoneKind;
  /** Watcher-clock times of the steps, for the timing log. */
  stages: Record<string, number>;
}
export interface ZoneInstantOptions {
  calibration: () => FieldCalibration | undefined;
  format?: FieldFormat;
  tier: ZoneTier;
  /** A small grey frame of the camera now, or nothing when there is no new frame. */
  gray: () => GrayFrame | undefined;
  /** A fresh full-size frame (the caller owns it until `release`). */
  sample: () => Promise<{ frame: FieldFrame; at: number }>;
  release: (frame: FieldFrame) => void;
  /** The quad the reader is given for a zone, in portrait corner order. */
  zoneCard: (zone: FieldZone) => DetectedQuad | undefined;
  /** True when this zone may take an instant read (a field slot with no card on the board and no live track). */
  eligible: (zone: FieldZone) => boolean;
  /** True while a scan or another read holds the reader: the instant read waits, then drops. */
  busy: () => boolean;
  read: (frame: FieldFrame, card: DetectedQuad) => Promise<RecognitionResult>;
  deliver: (read: ZoneInstantRead) => void;
  enabled?: () => boolean;
  now?: () => number;
  /** Reads per second over all zones. Default 4. */
  maxPerSecond?: number;
  /** Longest wait for a busy reader (ms). Default 400. */
  yieldMs?: number;
}
export interface ZoneInstantStats { frames: number; settles: number; reads: number; delivered: number; skipped: Record<string, number>; watchCpuMs: number }

const CROP_W = 48, CROP_H = 72, MAT_REFRESH_MS = 3000, MAX_PENDING = 3, ZONE_COOLDOWN_MS = 1000;
let canvas: OffscreenCanvas | undefined;

/** One zone rectified to a small upright crop, from either a native bitmap or a pixel buffer. */
export function zoneCropOf(frame: FieldFrame, quad: readonly Point[], width = CROP_W, height = CROP_H): RGBAImage | null {
  if (!('close' in frame)) return zoneCrop(frame as RGBAImage, quad, .06, width, height);
  const cx = quad.reduce((s, p) => s + p.x, 0) / 4, cy = quad.reduce((s, p) => s + p.y, 0) / 4;
  const grown = quad.map(p => ({ x: (cx + (p.x - cx) * 1.12) * frame.width, y: (cy + (p.y - cy) * 1.12) * frame.height }));
  const x = Math.max(0, Math.floor(Math.min(...grown.map(p => p.x)))), y = Math.max(0, Math.floor(Math.min(...grown.map(p => p.y))));
  const w = Math.min(frame.width, Math.ceil(Math.max(...grown.map(p => p.x)))) - x, h = Math.min(frame.height, Math.ceil(Math.max(...grown.map(p => p.y)))) - y;
  if (w < 3 || h < 3) return null;
  const scale = Math.min(1, 160 / Math.max(w, h)), pw = Math.max(3, Math.round(w * scale)), ph = Math.max(3, Math.round(h * scale));
  canvas ??= new OffscreenCanvas(pw, ph);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.globalCompositeOperation = 'copy';
  context.drawImage(frame, x, y, w, h, 0, 0, pw, ph);
  const patch = context.getImageData(0, 0, pw, ph);
  return warpQuad(patch, grown.map(p => ({ x: (p.x - x) * pw / w, y: (p.y - y) * ph / h })) as Quad, width, height);
}

/** Never throws into the caller's loop: a failure counts as a skip. */
export function createZoneInstant(options: ZoneInstantOptions) {
  const now = options.now ?? (() => performance.now());
  const maxPerSecond = options.maxPerSecond ?? 4, yieldMs = options.yieldMs ?? 400;
  const stats: ZoneInstantStats = { frames: 0, settles: 0, reads: 0, delivered: 0, skipped: {}, watchCpuMs: 0 };
  const skip = (why: string) => { stats.skipped[why] = (stats.skipped[why] ?? 0) + 1; };
  let watch: ReturnType<typeof createZoneWatch> | undefined, watchKey = '', specs: ReturnType<typeof zoneSpecsFromCalibration> = [];
  let timer: ReturnType<typeof setTimeout> | undefined, running = false, working = false, disposed = false;
  let mat: MatColour | undefined, matAt = -Infinity;
  const pending: { zone: FieldZone; settleAt: number; eventAt: number }[] = [], recent: number[] = [], zoneAt = new Map<string, number>();

  function ensureWatch(frame: GrayFrame) {
    const calibration = options.calibration();
    if (!calibration) { watch = undefined; return undefined; }
    const key = `${frame.width}x${frame.height}:${JSON.stringify(calibration.corners)}:${JSON.stringify(calibration.zoneSpacing ?? null)}:${JSON.stringify(calibration.zones ?? null)}:${options.format ?? ''}`;
    if (!watch || key !== watchKey) {
      // Only field slots: piles and the hand are not instant zones.
      specs = zoneSpecsFromCalibration(calibration, options.format, undefined).filter(s => /^(M[1-5]|S[1-5]|EMZ[12]|FIELD)$/.test(s.id));
      watch = createZoneWatch(specs, frame, { idleIntervalMs: options.tier.idleIntervalMs, settleMs: options.tier.settleMs, budget: options.tier.budget, now });
      watchKey = key; pending.length = 0; mat = undefined;
    }
    return watch;
  }

  /** One camera frame. Returns after the zone watch has seen it; reads run on their own. */
  function push(frame: GrayFrame, at = now()) {
    const w = ensureWatch(frame);
    if (!w || !w.wants(at)) return;
    stats.frames++;
    for (const event of w.push(frame, at)) {
      if (event.type !== 'settle') continue;
      stats.settles++;
      if (!options.eligible(event.zone as FieldZone)) { w.commit(frame, event.zone); skip('not-eligible'); continue; }
      if (pending.length >= MAX_PENDING) { skip('queue-full'); continue; }
      pending.push({ zone: event.zone as FieldZone, settleAt: event.at, eventAt: event.emittedAt });
    }
    stats.watchCpuMs = w.stats().cpuMs;
    if (pending.length && !working) void work();
  }

  async function work() {
    working = true;
    try { while (pending.length && !disposed) { const job = pending.shift()!; try { await handle(job); } catch { skip('error'); } } }
    finally { working = false; }
  }

  async function handle(job: { zone: FieldZone; settleAt: number; eventAt: number }) {
    if (options.enabled && !options.enabled()) return skip('disabled');
    const stages: Record<string, number> = { zoneSettle: job.settleAt, zoneEvent: job.eventAt };
    const started = now();
    // Yield to scans and other reads; a card that waits too long goes to the normal pipeline.
    while (options.busy()) { if (disposed || now() - started > yieldMs) return skip('busy'); await new Promise(r => setTimeout(r, 25)); }
    const at = now();
    if (at - (zoneAt.get(job.zone) ?? -Infinity) < ZONE_COOLDOWN_MS) return skip('zone-cooldown');
    while (recent.length && at - recent[0] > 1000) recent.shift();
    if (recent.length >= maxPerSecond) return skip('rate');
    if (!options.eligible(job.zone)) return skip('not-eligible');
    const card = options.zoneCard(job.zone);
    if (!card) return skip('no-zone');
    const { frame, at: frameAt } = await options.sample();
    try {
      stages.zoneSampled = now();
      if (!mat || now() - matAt > MAT_REFRESH_MS) {
        const crops = specs.map(s => zoneCropOf(frame, s.quad)).filter((c): c is RGBAImage => !!c);
        if (crops.length >= 4) { mat = estimateMat(crops); matAt = now(); }
      }
      const crop = zoneCropOf(frame, card.quad);
      if (!crop || !mat) return skip('no-crop');
      const state = classifyZone(crop, mat);
      stages.zoneClassified = now();
      // The heuristic is a look-here gate, not a verdict: empty, hand, a back or a sideways card never reach the reader.
      if (state.kind !== 'face-up' && state.kind !== 'unknown') return skip(`state-${state.kind}`);
      if (!options.eligible(job.zone)) return skip('not-eligible');
      zoneAt.set(job.zone, now()); recent.push(now()); stats.reads++;
      const readAt = now();
      const result = await options.read(frame, card);
      stages.zoneRead = now();
      if (disposed) return;
      stats.delivered++;
      options.deliver({ zone: job.zone, card, result, since: job.settleAt, readAt, frameAt, kind: state.kind, stages });
    } finally { options.release(frame); }
  }

  async function loop() {
    if (!running || disposed) return;
    const start = now();
    try { const frame = options.gray(); if (frame && (!options.enabled || options.enabled())) push(frame, start); } catch { skip('error'); }
    if (running && !disposed) timer = setTimeout(loop, Math.max(0, (watch?.stats().idleIntervalMs ?? options.tier.idleIntervalMs) - (now() - start)));
  }
  return {
    push,
    start() { if (running || disposed) return; running = true; timer = setTimeout(loop, 0); },
    stop() { running = false; clearTimeout(timer); pending.length = 0; },
    dispose() { disposed = true; running = false; clearTimeout(timer); pending.length = 0; },
    /** A zone settled on the board (a card placed or confirmed absent): learn the grey picture of it. */
    commit(frame: GrayFrame, zone: string) { watch?.commit(frame, zone); },
    stats: () => ({ ...stats, skipped: { ...stats.skipped } }),
  };
}
export type ZoneInstant = ReturnType<typeof createZoneInstant>;
