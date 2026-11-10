// Ring buffer behind the "Save last 30 s" button: wraps the field watcher's frame buffer and recognizer,
// keeps encoded frames and events for the last window, and writes one .ddclip zip on request.
// Local only: the result goes to the player's own disk. Nothing is sent anywhere.
import type { FieldBuffer, FieldEvent, FieldWatcherOptions } from './field-watcher';
import type { FieldFrame } from './field-motion';
import type { FieldCalibration } from './field-zones';
import type { FieldIdentityEntry } from './field-gallery';
import { buildClipEntries, matCropRect, rebaseCalibration, sameCrop, slimEvent, slimResult, writeZip, type ClipEvent, type ClipFrameMeta, type ClipRecorderStats, type ClipRect, type ClipSession } from './clip-format';

export interface EncodedFrame { bytes: Uint8Array; width: number; height: number; /** Source camera size and the crop that was applied. */ camera: { width: number; height: number }; crop?: ClipRect }
/** Encodes one frame. It must copy the pixels before its first `await`: the frame belongs to the watcher and may be closed right after. */
export type FrameEncoder = (frame: FieldFrame, at: number) => Promise<EncodedFrame | null>;

export interface ClipRecorderOptions {
  encode: FrameEncoder;
  /** Ring length (default 30 s) and the least gap between two saved frames (default 200 ms = 5 fps). */
  windowMs?: number; frameGapMs?: number;
  now?: () => number;
  /** Events kept beyond the window (actions, prompts) up to this count; frames are strictly windowed. */
  maxEvents?: number;
}

export type ClipContext = Partial<Omit<ClipSession, 'version' | 'savedAt' | 'clipStartAt' | 'clipEndAt' | 'windowMs' | 'camera' | 'frame' | 'frameCalibration' | 'cost'>>;

type WatcherIo = Pick<FieldWatcherOptions, 'recognizer' | 'buffer'> & Partial<Pick<FieldWatcherOptions, 'getKnownCards'>>;

export interface ClipRecorder {
  /** Wrap the watcher's buffer, recognizer and known-card lookup so frames, detections, reads and the reader's knowledge are recorded. */
  wrap<T extends WatcherIo>(io: T): T;
  onEvent(event: FieldEvent): void;
  action(action: Extract<ClipEvent, { kind: 'action' }>['action'], data?: Record<string, unknown>): void;
  setContext(context: ClipContext): void;
  setCalibration(calibration: FieldCalibration | undefined): void;
  stats(): ClipRecorderStats;
  /** Frames in the ring right now. */
  frameCount(): number;
  /** One .ddclip (zip) with the last window. Empty ring gives a bundle with no frames. */
  save(): Uint8Array;
  dispose(): void;
}

interface StoredFrame { meta: ClipFrameMeta; bytes: Uint8Array; camera: { width: number; height: number }; crop?: ClipRect }

export function createClipRecorder(options: ClipRecorderOptions): ClipRecorder {
  const now = options.now ?? (() => performance.now()), windowMs = options.windowMs ?? 30_000, gap = options.frameGapMs ?? 200, maxEvents = options.maxEvents ?? 4000;
  const frames: StoredFrame[] = [], events: ClipEvent[] = [];
  let context: ClipContext = {}, calibration: FieldCalibration | undefined;
  let encoding = false, lastFrameAt = -Infinity, serial = 0, disposed = false, lastKnown: ReturnType<NonNullable<WatcherIo['getKnownCards']>> | undefined, lastGallery: readonly FieldIdentityEntry[] | undefined;
  let encodeMsTotal = 0, encodeMsMax = 0, encoded = 0, dropped = 0;
  const startedAt = now();
  const prune = (at: number) => {
    while (frames.length && frames[0].meta.at < at - windowMs) frames.shift();
    while (events.length && (events.length > maxEvents || events[0].at < at - windowMs * 2)) events.shift();
  };
  const push = (event: ClipEvent) => { if (disposed) return; events.push(event); prune(event.at); };
  const record = (frame: FieldFrame, at: number) => {
    if (disposed || encoding || at - lastFrameAt < gap) { if (!disposed && encoding && at - lastFrameAt >= gap) dropped++; return; }
    encoding = true; lastFrameAt = at; const start = now();
    options.encode(frame, at).then(result => {
      if (disposed || !result) return;
      const ms = now() - start; encodeMsTotal += ms; encodeMsMax = Math.max(encodeMsMax, ms); encoded++;
      const name = `frames/${String(++serial).padStart(5, '0')}.jpg`;
      frames.push({ meta: { at, name, width: result.width, height: result.height, bytes: result.bytes.length, crop: result.crop }, bytes: result.bytes, camera: result.camera, crop: result.crop });
      prune(at);
    }).catch(() => { /* A failed encode drops the frame; recording never breaks the watcher. */ }).finally(() => { encoding = false; });
  };
  const stats = (): ClipRecorderStats => ({ frames: frames.length, bytes: frames.reduce((n, f) => n + f.bytes.length, 0), events: events.length, encodeMsMean: encoded ? encodeMsTotal / encoded : 0, encodeMsMax, encodeMsTotal, dropped, activeS: (now() - startedAt) / 1000 });
  return {
    wrap(io) {
      const buffer: FieldBuffer = { sample: async opts => { const sample = await io.buffer.sample(opts); record(sample.frame, sample.at); return sample; } };
      const inner = io.recognizer;
      const recognizer: WatcherIo['recognizer'] = {
        get detectorBackend() { return inner.detectorBackend; },
        get detectorTimingsMs() { return inner.detectorTimingsMs; },
        get separateDetector() { return inner.separateDetector; },
        prepare: inner.prepare ? opts => inner.prepare!(opts) : undefined,
        detectCards: async (frame, opts) => { const at = now(), start = now(); const cards = await inner.detectCards(frame, opts); push({ at, kind: 'detect', ms: now() - start, cards: structuredClone(cards), opts: opts ? { ...opts } : undefined }); return cards; },
        recognize: async (frames, opts) => {
          const at = now(), start = now(); const card = opts?.card ? structuredClone(opts.card) : undefined;
          if (opts?.gallery) lastGallery = opts.gallery;
          const knowledge = { priors: opts?.priors ? structuredClone(opts.priors) : undefined, gallery: opts?.gallery?.length, known: lastKnown ? structuredClone(lastKnown) : undefined };
          try { const result = await inner.recognize(frames, opts); push({ at, kind: 'read', ms: now() - start, frames: frames.length, card, result: slimResult(result), opts: { k: opts?.k }, ...knowledge }); return result; }
          catch (error) { push({ at, kind: 'read', ms: now() - start, frames: frames.length, card, error: error instanceof Error ? error.message : String(error), ...knowledge }); throw error; }
        },
      };
      const getKnownCards = io.getKnownCards ? () => { const known = io.getKnownCards!(); lastKnown = known; return known; } : undefined;
      return { ...io, buffer, recognizer, ...(getKnownCards ? { getKnownCards } : {}) };
    },
    onEvent(event) { const at = now(); push({ at, kind: 'watcher', event: slimEvent(event) }); if (event.timing) push({ at, kind: 'timing', timing: structuredClone(event.timing) }); },
    action(action, data) { push({ at: now(), kind: 'action', action, data }); },
    setContext(next) { context = { ...context, ...next }; },
    setCalibration(next) { calibration = next; this.action('calibration', next ? { corners: next.corners, orientation: next.orientation, zoneSpacing: next.zoneSpacing, zones: next.zones } : { cleared: true }); },
    stats, frameCount: () => frames.length,
    save() {
      const at = now(); prune(at);
      const last = frames[frames.length - 1];
      const camera = last?.camera ?? { width: 0, height: 0 }, crop = last?.crop;
      // One crop per clip: frames cropped with an older calibration would map onto the wrong zones.
      const saved = frames.filter(f => sameCrop(f.crop, crop)), first = saved[0];
      const clipStartAt = first ? first.meta.at : at - windowMs, clipEndAt = last ? last.meta.at : at;
      const kept = events.filter(e => e.at >= clipStartAt - 1000);
      const session: ClipSession = {
        version: 1, savedAt: new Date().toISOString(), clipStartAt, clipEndAt, windowMs, camera,
        frame: { width: last?.meta.width ?? 0, height: last?.meta.height ?? 0, crop, fps: 1000 / gap, type: 'image/jpeg' },
        ...context, calibration: calibration ?? context.calibration,
        frameCalibration: (calibration ?? context.calibration) ? rebaseCalibration((calibration ?? context.calibration)!, crop) : undefined,
        userAgent: context.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : undefined),
        hardwareConcurrency: context.hardwareConcurrency ?? (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined),
        gallery: lastGallery?.filter(e => e.cardId).slice(-512).map(e => ({ cardId: e.cardId, embedding: e.embedding })),
        droppedCropFrames: frames.length - saved.length || undefined,
        cost: stats(),
      };
      return writeZip(buildClipEntries(session, saved.map(f => ({ meta: f.meta, bytes: f.bytes })), kept));
    },
    dispose() { disposed = true; frames.length = 0; events.length = 0; },
  };
}

/** Browser encoder: crops to the mat (when calibrated), downscales to `maxSide` (960 px: a card stays about 90-130 px wide) and encodes JPEG on an OffscreenCanvas. The draw is synchronous. */
export function createBrowserFrameEncoder(options: { maxSide?: number; quality?: number; crop?: () => FieldCalibration | undefined; margin?: number } = {}): FrameEncoder {
  const maxSide = options.maxSide ?? 960, quality = options.quality ?? .7;
  let canvas: OffscreenCanvas | undefined, staging: OffscreenCanvas | undefined;
  return async (frame) => {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const camera = { width: frame.width, height: frame.height };
    const crop = matCropRect(options.crop?.(), options.margin);
    const sx = Math.round((crop?.x ?? 0) * frame.width), sy = Math.round((crop?.y ?? 0) * frame.height), sw = Math.max(1, Math.round((crop?.w ?? 1) * frame.width)), sh = Math.max(1, Math.round((crop?.h ?? 1) * frame.height));
    const scale = Math.min(1, maxSide / Math.max(sw, sh)), width = Math.max(1, Math.round(sw * scale)), height = Math.max(1, Math.round(sh * scale));
    if (!canvas || canvas.width !== width || canvas.height !== height) canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d')!;
    let source: CanvasImageSource;
    if ('close' in frame) source = frame;
    else { if (!staging || staging.width !== frame.width || staging.height !== frame.height) staging = new OffscreenCanvas(frame.width, frame.height); staging.getContext('2d')!.putImageData(frame, 0, 0); source = staging; }
    context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, camera, crop };
  };
}
