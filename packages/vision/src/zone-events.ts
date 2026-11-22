/**
 * Event-driven per-zone watch (prototype, not wired into the app).
 *
 * The calibration already says where every zone is. So instead of a full detector pass on a timer, each camera frame
 * gets a tiny per-zone change signal on a small grey frame (about 160 px wide). A zone that moves and then stays still
 * for `settleMs` emits one `settle` event; the caller crops that zone and runs the zone-state classifier
 * (zone-state.ts) and, for a face-up card, the embedder. Nothing here runs a model.
 *
 * Cost control: idle frames are sampled at `idleIntervalMs`; while any zone is active every frame is used. The watch
 * measures its own CPU time and widens the idle interval when it goes over `budget` (share of one core).
 */
import { fieldMatPoint, fieldZoneCells, type FieldCalibration, type FieldFormat } from './field-zones';
import type { Point } from './types';

export interface GrayFrame { width: number; height: number; data: Uint8Array | Uint8ClampedArray }
export interface ZoneSpec { id: string; /** Zone corners in normalised image coordinates, clockwise. */ quad: Point[] }

/** Zone rectangles of the saved calibration, mapped into the picture. `inset` keeps the samples off the zone edge (a neighbour card). */
export function zoneSpecsFromCalibration(calibration: FieldCalibration, format: FieldFormat = 'normal', ids?: readonly string[]): ZoneSpec[] {
  return fieldZoneCells(format, calibration.zoneSpacing, calibration.zones)
    .filter(cell => !ids || ids.includes(cell.zone))
    .map(cell => ({
      id: cell.zone,
      quad: [{ x: cell.x, y: cell.y }, { x: cell.x + cell.w, y: cell.y }, { x: cell.x + cell.w, y: cell.y + cell.h }, { x: cell.x, y: cell.y + cell.h }]
        .map(p => fieldMatPoint(p, calibration)),
    }));
}

export interface ZoneWatchOptions {
  /** Stillness before a zone settles. Default 160 ms. */
  settleMs?: number;
  /** A pixel counts as changed when it differs by more than this (grey levels, after exposure compensation). Default 14. */
  pixelDelta?: number;
  /** Share of changed samples that makes a zone "moving". Default 0.05. */
  moveShare?: number;
  /** Share of samples that differ from the settled reference for `changed`. Default 0.12. */
  changeShare?: number;
  /** Samples per zone along each axis. Default 16 x 22. */
  grid?: { u: number; v: number };
  /** Inner share of the zone to sample (0..1). Default 0.8. */
  inner?: number;
  /** Take the settled picture as the new reference by itself. Off by default: the caller commits (`commit`) only when the zone state is known, so a hand that rests over a zone never becomes the reference. */
  autoCommit?: boolean;
  /** Frame interval while nothing moves. Default 66 ms (about 15 fps). */
  idleIntervalMs?: number;
  /** Share of one core the watch may use on average. Default 0.05. */
  budget?: number;
  now?: () => number;
}
export type ZoneEvent =
  | { type: 'start'; zone: string; at: number }
  /** Zone left the settled picture and is moving. Fires once per movement. */
  | { type: 'settle'; zone: string; /** The last moment of movement. */ at: number; /** When the event fires (at + settleMs, on a frame). The frame pushed now is the one to crop. */ emittedAt: number; startedAt: number; /** Share of samples that differ from the committed picture of the zone. */ change: number; changed: boolean };
export interface ZoneWatchStats { frames: number; skipped: number; cpuMs: number; maxMs: number; idleIntervalMs: number }

interface ZoneState {
  spec: ZoneSpec; index: Int32Array; ref: Uint8Array | null; prev: Uint8Array;
  active: boolean; startedAt: number; stillSince: number; moveFrames: number;
}
const median = (values: number[]) => { values.sort((a, b) => a - b); return values[values.length >> 1] ?? 0; };

export function createZoneWatch(zones: readonly ZoneSpec[], size: { width: number; height: number }, options: ZoneWatchOptions = {}) {
  const settleMs = options.settleMs ?? 160, pixelDelta = options.pixelDelta ?? 14, moveShare = options.moveShare ?? .05, changeShare = options.changeShare ?? .12;
  const grid = options.grid ?? { u: 16, v: 22 }, inner = Math.max(.3, Math.min(1, options.inner ?? .8)), budget = options.budget ?? .05;
  const now = options.now ?? (() => performance.now());
  let idleIntervalMs = options.idleIntervalMs ?? 66;
  const { width, height } = size;
  // Sample positions: the inner part of each zone, through the zone's own perspective (bilinear between its four corners
  // is exact enough at this size; the quad is small).
  const states: ZoneState[] = zones.map(spec => {
    const [a, b, c, d] = spec.quad, picks = new Set<number>(), pad = (1 - inner) / 2;
    for (let j = 0; j < grid.v; j++) for (let i = 0; i < grid.u; i++) {
      const u = pad + inner * (i + .5) / grid.u, v = pad + inner * (j + .5) / grid.v;
      const x = (1 - v) * ((1 - u) * a.x + u * b.x) + v * ((1 - u) * d.x + u * c.x), y = (1 - v) * ((1 - u) * a.y + u * b.y) + v * ((1 - u) * d.y + u * c.y);
      const px = Math.round(x * width - .5), py = Math.round(y * height - .5);
      if (px >= 0 && py >= 0 && px < width && py < height) picks.add(py * width + px);
    }
    const index = Int32Array.from(picks);
    return { spec, index, ref: null, prev: new Uint8Array(index.length), active: false, startedAt: 0, stillSince: 0, moveFrames: 0 };
  });
  // Sparse picture-wide sample of the zones for exposure compensation (median of the differences, so a card does not count).
  const sparse = Int32Array.from(states.flatMap(s => Array.from(s.index).filter((_, i) => i % 7 === 0)));
  let previousSparse = new Uint8Array(sparse.length), referenceSparse = new Uint8Array(sparse.length), havePrevious = false;
  let lastSampleAt = -Infinity, frames = 0, skipped = 0, cpuMs = 0, maxMs = 0, windowStart = now(), windowCpu = 0;

  const gain = (data: Uint8Array | Uint8ClampedArray, base: Uint8Array) => {
    const diffs: number[] = new Array(sparse.length);
    for (let i = 0; i < sparse.length; i++) diffs[i] = data[sparse[i]] - base[i];
    return median(diffs);
  };
  return {
    zones: states.map(s => s.spec.id),
    /** True when this frame should be pushed: every frame while a zone is active, else one per idle interval. */
    wants(at: number): boolean { return states.some(s => s.active) || at - lastSampleAt >= idleIntervalMs; },
    /** Learn the current picture as the settled one (once after calibration, per zone once its state is known, and after the full detector confirms the board). */
    setReference(frame: GrayFrame, zoneId?: string) {
      for (const s of states) if (!zoneId || s.spec.id === zoneId) { s.ref = new Uint8Array(s.index.length); for (let i = 0; i < s.index.length; i++) s.ref[i] = frame.data[s.index[i]]; }
      if (!zoneId) for (let i = 0; i < sparse.length; i++) referenceSparse[i] = frame.data[sparse[i]];
    },
    push(frame: GrayFrame, at: number): ZoneEvent[] {
      if (frame.width !== width || frame.height !== height) throw new Error('Frame size changed; build a new watch');
      const t0 = now();
      lastSampleAt = at; frames++;
      const out: ZoneEvent[] = [], data = frame.data;
      if (!states[0]?.ref) this.setReference(frame);
      if (havePrevious) {
        const g = gain(data, previousSparse), gRef = gain(data, referenceSparse);
        for (const s of states) {
          let moved = 0; const n = s.index.length;
          for (let i = 0; i < n; i++) { const v = data[s.index[i]]; if (Math.abs(v - s.prev[i] - g) > pixelDelta) moved++; }
          const moving = moved / n > moveShare;
          if (moving) {
            if (!s.active) { s.moveFrames++; // One frame is enough for a big jump (a card slapped down between two frames); small moves need two, so sensor noise does not start a zone.
            if (s.moveFrames >= 2 || moved / n > .3) { s.active = true; s.startedAt = at; out.push({ type: 'start', zone: s.spec.id, at }); } }
            s.stillSince = at;
          } else {
            s.moveFrames = 0;
            if (s.active && at - s.stillSince >= settleMs) {
              let diff = 0; const ref = s.ref!;
              for (let i = 0; i < n; i++) if (Math.abs(data[s.index[i]] - ref[i] - gRef) > pixelDelta) diff++;
              const change = diff / n;
              out.push({ type: 'settle', zone: s.spec.id, at: s.stillSince, emittedAt: at, startedAt: s.startedAt, change, changed: change > changeShare });
              if (options.autoCommit) for (let i = 0; i < n; i++) ref[i] = data[s.index[i]];
              s.active = false;
            }
          }
        }
      }
      for (const s of states) for (let i = 0; i < s.index.length; i++) s.prev[i] = data[s.index[i]];
      for (let i = 0; i < sparse.length; i++) previousSparse[i] = data[sparse[i]];
      // The reference exposure follows the light only for zones that settle; refresh the sparse reference when nothing is active.
      if (!states.some(s => s.active)) for (let i = 0; i < sparse.length; i++) referenceSparse[i] = data[sparse[i]];
      havePrevious = true;
      const spent = now() - t0; cpuMs += spent; windowCpu += spent; if (spent > maxMs) maxMs = spent;
      // Budget: over a one second window, widen the idle interval when the watch uses more than its share.
      const wall = now() - windowStart;
      if (wall >= 1000) { const share = windowCpu / wall; idleIntervalMs = share > budget ? Math.min(200, idleIntervalMs * 1.5) : share < budget / 2 ? Math.max(options.idleIntervalMs ?? 66, idleIntervalMs / 1.25) : idleIntervalMs; windowStart = now(); windowCpu = 0; }
      return out;
    },
    commit(frame: GrayFrame, zoneId: string) { this.setReference(frame, zoneId); },
    /** True while the zone is moving (it left the settled picture and has not rested yet). */
    isActive(zoneId: string) { return !!states.find(s => s.spec.id === zoneId)?.active; },
    skip() { skipped++; },
    /** Count CPU the caller spent on this watch's behalf (the grey draw) against the same budget. */
    charge(ms: number) { cpuMs += ms; windowCpu += ms; if (ms > maxMs) maxMs = ms; },
    stats(): ZoneWatchStats { return { frames, skipped, cpuMs, maxMs, idleIntervalMs }; },
  };
}

/** Settings per machine class. Chosen once at start by `pickZoneTier`; the player can override. */
export interface ZoneTier {
  name: 'gpu' | 'cpu4';
  /** Idle frame interval of the watch (ms). */
  idleIntervalMs: number; settleMs: number; budget: number;
  /** Start the embedder while the card is still moving (spare budget only). */
  preRead: boolean;
  /** Frames of the moving card to try for a pre-read. */
  maxPreReads: number;
}
export interface TierProbe { cores: number; gpu: boolean; /** Median time of one embedder run on a card crop, measured at start. */ embedMs: number; /** Median watch cost per frame (us), measured on a synthetic frame. */ watchUs: number }
export function pickZoneTier(probe: TierProbe): ZoneTier {
  const spare = probe.gpu || (probe.cores >= 8 && probe.embedMs < 45);
  if (probe.gpu && probe.embedMs < 40) return { name: 'gpu', idleIntervalMs: 33, settleMs: 120, budget: .05, preRead: spare, maxPreReads: 2 };
  // The floor is a 4-core machine without a GPU. Slower machines are not a target; they get the same settings.
  return { name: 'cpu4', idleIntervalMs: 66, settleMs: 160, budget: .05, preRead: spare, maxPreReads: 1 };
}
