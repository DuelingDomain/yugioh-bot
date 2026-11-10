"use client";
// "Save last 30 s": a ring of the player's own mat camera plus the field watcher's inputs and events, written to one
// .ddclip file on this computer. Developer accounts only (`room.isDeveloper`); nothing is ever uploaded.
import { useSyncExternalStore } from 'react';
import { createClipRecorder, createBrowserFrameEncoder, CLIP_EXTENSION, type ClipRecorder, type ClipRecorderStats, type ClipEvent, type FieldCalibration, type FieldEvent, type FieldFormat, type FieldWatcherOptions } from '@yugidraft/vision';
import { fieldDeveloperEnabled, subscribeFieldDeveloper } from './zone-grid';

type WatcherIo = Pick<FieldWatcherOptions, 'recognizer' | 'buffer'> & Partial<Pick<FieldWatcherOptions, 'getKnownCards'>>;
type ClipAction = Extract<ClipEvent, { kind: 'action' }>['action'];
export interface ClipAttachContext { room?: string; seat?: number; format?: FieldFormat; priors?: () => { decklist?: string[] } | undefined; calibration: () => FieldCalibration | undefined }

/** The build can switch the button off everywhere with NEXT_PUBLIC_FIELD_CLIPS=0. */
export const fieldClipsEnabled = () => process.env.NEXT_PUBLIC_FIELD_CLIPS !== '0' && fieldDeveloperEnabled();

let attached: { config: WatcherIo; context: ClipAttachContext; recorder: ClipRecorder | null; wrapped: WatcherIo | null } | null = null;
let lastSaved: { at: number; stats: ClipRecorderStats } | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
// One flag subscription for the whole attachment (not per Feed: the first Feed to unmount would otherwise stop the sync for all).
let offDeveloper: (() => void) | null = null;

/** Start or stop the ring when the developer flag changes while a watcher runs. */
function sync() {
  if (!attached) return;
  const want = fieldClipsEnabled();
  if (want && !attached.recorder) {
    const recorder = createClipRecorder({ encode: createBrowserFrameEncoder({ crop: attached.context.calibration }) });
    recorder.setContext({ room: attached.context.room, seat: attached.context.seat, format: attached.context.format, detectorBackend: attached.config.recognizer.detectorBackend });
    recorder.setCalibration(attached.context.calibration());
    attached.recorder = recorder; attached.wrapped = recorder.wrap(attached.config); notify();
  } else if (!want && attached.recorder) { attached.recorder.dispose(); attached.recorder = null; attached.wrapped = null; notify(); }
}

/** Wrap the watcher's buffer and recognizer. The ring only exists while the developer flag is on; other players pay nothing. */
export function attachClipRecorder<T extends WatcherIo>(config: T, context: ClipAttachContext): T {
  detachClipRecorder();
  attached = { config, context, recorder: null, wrapped: null };
  offDeveloper = subscribeFieldDeveloper(sync);
  sync();
  const io = () => attached?.wrapped ?? config;
  const inner = config.recognizer;
  const recognizer: WatcherIo['recognizer'] = {
    get detectorBackend() { return inner.detectorBackend; }, get detectorTimingsMs() { return inner.detectorTimingsMs; }, get separateDetector() { return inner.separateDetector; },
    prepare: inner.prepare ? opts => inner.prepare!(opts) : undefined,
    detectCards: (frame, opts) => io().recognizer.detectCards(frame, opts),
    recognize: (frames, opts) => io().recognizer.recognize(frames, opts),
  };
  // The known-card lookup goes through the ring too, so each read's board knowledge is recorded (the raw config would bypass it).
  return { ...config, recognizer, buffer: { sample: opts => io().buffer.sample(opts) }, getKnownCards: config.getKnownCards ? () => io().getKnownCards!() : undefined };
}
export function detachClipRecorder() { offDeveloper?.(); offDeveloper = null; if (!attached) return; attached.recorder?.dispose(); attached = null; notify(); }
export const clipEvent = (event: FieldEvent) => attached?.recorder?.onEvent(event);
export const clipAction = (action: ClipAction, data?: Record<string, unknown>) => attached?.recorder?.action(action, data);
export const clipCalibration = (calibration: FieldCalibration | undefined) => attached?.recorder?.setCalibration(calibration);
export const clipStats = () => attached?.recorder?.stats() ?? null;

/** Write the ring to `dd-clip-<time>.ddclip` through a Blob download. Returns null when no ring runs; `saved: false` when the ring
 *  holds no frame yet (nothing is written). The ring restarts empty whenever the watcher restarts (backend switch, calibration on/off). */
export function saveFieldClip(): { saved: boolean; stats: ClipRecorderStats } | null {
  const recorder = attached?.recorder; if (!recorder || !attached) return null;
  if (recorder.frameCount() === 0) return { saved: false, stats: recorder.stats() };
  recorder.setContext({ decklist: attached.context.priors?.()?.decklist, userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency });
  const bytes = recorder.save(), stats = recorder.stats();
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  const link = document.createElement('a'); link.href = url; link.download = `dd-clip-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}${CLIP_EXTENSION}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  recorder.action('note', { saved: true, bytes: bytes.length });
  lastSaved = { at: Date.now(), stats }; notify();
  return { saved: true, stats };
}
/** True while a ring records (developer flag on and the own watcher runs). */
export const useFieldClipReady = () => useSyncExternalStore(subscribe, () => !!attached?.recorder, () => false);
export const useFieldClipSaved = () => useSyncExternalStore(subscribe, () => lastSaved, () => null);
