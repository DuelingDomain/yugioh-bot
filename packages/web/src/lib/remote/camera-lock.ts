/** Image Capture controls are not yet included in TypeScript's MediaTrack types. */
type Mode = 'exposureMode' | 'whiteBalanceMode' | 'focusMode';
type Value = 'exposureTime' | 'colorTemperature' | 'focusDistance';
type Range = { min: number; max: number; step?: number };
type CameraCapabilities = MediaTrackCapabilities & Partial<Record<Mode, string[]>> & Partial<Record<Value, Range>>;
type CameraSettings = MediaTrackSettings & Partial<Record<Mode, string>> & Partial<Record<Value, number>>;
type Control = { mode: Mode; value: Value; target: string; current?: number };
const CONTROLS: { mode: Mode; value: Value }[] = [
  { mode: 'exposureMode', value: 'exposureTime' },
  { mode: 'whiteBalanceMode', value: 'colorTemperature' },
  { mode: 'focusMode', value: 'focusDistance' },
];
export type CameraLockSnapshot = { supported: boolean; enabled: boolean; locked: boolean; busy: boolean; note: string; debug?: string };
export const CAMERA_LOCK_INITIAL: CameraLockSnapshot = { supported: false, enabled: true, locked: false, busy: false, note: '' };
export type CameraPoint = { x: number; y: number };
export type CameraLight = { clipped: number; mean: number; sharpness: number; colour: number[]; frameTime?: number };

/** Playback currentTime can advance without new camera pixels; count delivered frames instead. */
export function cameraFrameCounter(video: HTMLVideoElement) {
  let frame = 0, request: number | undefined, active = true;
  const callbacks = typeof video.requestVideoFrameCallback === 'function';
  const presented = () => {
    if (!active) return;
    frame++;
    request = video.requestVideoFrameCallback(presented);
  };
  if (callbacks) request = video.requestVideoFrameCallback(presented);
  return {
    read: () => callbacks ? frame : video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0,
    stop() { active = false; if (request !== undefined) video.cancelVideoFrameCallback(request); },
  };
}

/** Measure the convex mat quad (or centre 70%): luminance, clipping, colour and Laplacian variance. */
export function measureCameraLight({ data, width, height }: Pick<ImageData, 'data' | 'width' | 'height'>, corners?: readonly CameraPoint[]): CameraLight | null {
  const quad = corners?.length === 4 ? corners : [{ x: .15, y: .15 }, { x: .85, y: .15 }, { x: .85, y: .85 }, { x: .15, y: .85 }];
  const luma = (x: number, y: number) => { const i = (y * width + x) * 4; return .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]; };
  let count = 0, clipped = 0, luminance = 0, edges = 0, lapSum = 0, lapSquared = 0;
  const colour = [0, 0, 0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = (x + .5) / width, py = (y + .5) / height;
    let positive = false, negative = false;
    for (let edge = 0; edge < 4; edge++) {
      const a = quad[edge], b = quad[(edge + 1) % 4];
      const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
      if (cross > 1e-10) positive = true;
      if (cross < -1e-10) negative = true;
    }
    if (positive && negative) continue;
    const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2], mean = luma(x, y);
    count++; if (r >= 250 && g >= 250 && b >= 250) clipped++;
    colour[0] += r; colour[1] += g; colour[2] += b; luminance += mean;
    if (x > 0 && y > 0 && x < width - 1 && y < height - 1) {
      const lap = luma(x - 1, y) + luma(x + 1, y) + luma(x, y - 1) + luma(x, y + 1) - 4 * mean;
      edges++; lapSum += lap; lapSquared += lap * lap;
    }
  }
  if (!count) return null;
  const total = colour.reduce((sum, value) => sum + value, 0);
  return { clipped: clipped / count, mean: luminance / count, sharpness: edges ? Math.max(0, lapSquared / edges - (lapSum / edges) ** 2) : 0,
    colour: colour.map(value => total ? value / total : 0) };
}
function capabilities(track: MediaStreamTrack): CameraCapabilities {
  try { return track.getCapabilities?.() ?? {}; } catch { return {}; }
}
function settings(track: MediaStreamTrack): CameraSettings {
  try { return track.getSettings?.() ?? {}; } catch { return {}; }
}
function exposureRange(track: MediaStreamTrack): Range | undefined {
  const range = capabilities(track).exposureTime;
  // Web exposureTime is in 100 µs, even on Windows (Chrome converts log2 seconds).
  // A nonpositive/invalid range has unknown semantics: keep auto rather than guessing units.
  return range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.min > 0 && range.max > range.min ? range : undefined;
}
function exposureTarget(range: Range, desired: number) {
  const step = range.step && Number.isFinite(range.step) && range.step > 0 ? range.step : 1;
  return Number(Math.max(range.min, Math.min(range.max, range.min + Math.round((desired - range.min) / step) * step)).toPrecision(12));
}
function sameFrame(a: CameraLight, b: CameraLight) { return a.frameTime !== undefined && a.frameTime === b.frameTime; }
function sameLight(a: CameraLight, b: CameraLight) { return Math.abs(a.mean - b.mean) / Math.max(1, a.mean) < .03; }
function controls(track: MediaStreamTrack): Control[] {
  const caps = capabilities(track), current = settings(track);
  return CONTROLS.flatMap<Control>(({ mode, value }) => {
    const modes = caps[mode], range = caps[value], number = current[value];
    // Only freeze controls that can also return to auto.
    if (!modes?.includes('continuous')) return [];
    if (mode === 'exposureMode' && !exposureRange(track)) return [];
    if (modes.includes('manual') && range && Number.isFinite(number) && number! >= range.min && number! <= range.max)
      return [{ mode, value, target: 'manual', current: number }];
    if (mode === 'focusMode' && modes.includes('single-shot')) return [{ mode, value, target: 'single-shot' }];
    return [];
  });
}
class CameraTimeout extends Error {}
async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CameraTimeout('Camera setting timed out')), ms); })]); }
  finally { clearTimeout(timer); }
}
// Size and image controls share a queue. Read constraints inside it, never before a size change.
const queues = new WeakMap<MediaStreamTrack, Promise<unknown>>();
const pendingCapture = new WeakSet<MediaStreamTrack>();
function cameraWork<T>(track: MediaStreamTrack, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(track) ?? Promise.resolve()).catch(() => undefined).then(work);
  queues.set(track, next); return next;
}
function assertLive(track: MediaStreamTrack) { if (track.readyState === 'ended') throw new Error('The camera stopped while setting its capture size. Try again.'); }

/** Keep the camera's orientation. Prefer 1080p30; use 720p30 only if 1080p cannot deliver 30 fps. */
export async function optimizeRecognitionCapture(track: MediaStreamTrack): Promise<void> {
  await cameraWork(track, async () => {
    assertLive(track);
    const caps = capabilities(track), current = settings(track);
    if (!caps.width || !caps.height || !track.applyConstraints) return;
    const portrait = !!current.width && !!current.height && current.height > current.width;
    const sizes = portrait ? [[1080, 1920], [720, 1280]] : [[1920, 1080], [1280, 720]];
    for (const strictRate of [true, false]) for (const [width, height] of sizes) {
      if (width > (caps.width.max ?? 0) || width < (caps.width.min ?? 0) || height > (caps.height.max ?? 0) || height < (caps.height.min ?? 0)) continue;
      let write: Promise<void> | undefined;
      try {
        write = track.applyConstraints({ ...track.getConstraints(), width: { exact: width }, height: { exact: height },
          aspectRatio: { ideal: width / height }, frameRate: strictRate ? { exact: 30 } : { ideal: 30, max: 30 } });
        await bounded(write, 3000);
        assertLive(track);
        if (strictRate && (settings(track).frameRate ?? 30) < 29.5) continue;
        return;
      } catch (error) {
        assertLive(track);
        // A timed-out request cannot be cancelled; do not pile further format requests onto it.
        if (error instanceof CameraTimeout) {
          pendingCapture.add(track);
          void write!.then(() => pendingCapture.delete(track), () => pendingCapture.delete(track));
          return;
        }
      }
    }
    assertLive(track);
  });
}
const locks = new WeakMap<MediaStreamTrack, CameraLock>();
const automaticTracks = new WeakSet<MediaStreamTrack>();
/** Owners call this before stopping, unpublishing or replacing their local webcam. */
export function releaseCameraLock(track: MediaStreamTrack): Promise<void> { return locks.get(track)?.release() ?? Promise.resolve(); }
/** Recovery keeps reads available without locking a capture that failed preparation. */
export async function keepCameraAuto(track: MediaStreamTrack): Promise<void> {
  automaticTracks.add(track);
  await locks.get(track)?.setEnabled(false, false);
}

/** Only construct for an owner's local webcam. Never pass a received or phone track. */
export class CameraLock {
  private snapshot = { ...CAMERA_LOCK_INITIAL };
  private timer?: ReturnType<typeof setTimeout>;
  private wake?: () => void;
  private generation = 0;
  private closed = false;
  private releasing?: Promise<void>;
  private lateWrites = 0;
  private readonly key: string | undefined;
  private readonly lastKey: string;
  constructor(private track: MediaStreamTrack, userKey: string, private changed: (state: CameraLockSnapshot) => void,
    private measure?: () => CameraLight | null, private stopMeasurement?: () => void) {
    const device = settings(track).deviceId;
    this.key = device ? `dd-camera-lock:v1:${userKey}:device:${encodeURIComponent(device)}` : undefined;
    this.lastKey = `dd-camera-lock:last:v1:${userKey}`;
  }
  getSnapshot = () => this.snapshot;
  private live = () => !this.closed && this.track.readyState === 'live';
  private active = (generation: number) => this.live() && generation === this.generation;
  private patch(value: Partial<CameraLockSnapshot>) {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...value }; this.changed(this.snapshot);
  }
  private apply(values: object[], generation?: number, timeout = 500) {
    return cameraWork(this.track, async () => {
      if (this.track.readyState !== 'live' || (generation !== undefined && !this.active(generation))) return;
      if (generation !== undefined && (this.lateWrites || pendingCapture.has(this.track))) throw new CameraTimeout('A previous camera setting is still pending');
      const write = this.track.applyConstraints({ ...this.track.getConstraints(), advanced: values as MediaTrackConstraintSet[] });
      try { await bounded(write, timeout); }
      catch (error) {
        if (error instanceof CameraTimeout) {
          // A timeout cannot cancel a driver write. Block new locks and undo it again when it completes.
          this.lateWrites++;
          const compensate = async () => {
            let restored = false;
            try {
              if (this.track.readyState === 'live') {
                const caps = capabilities(this.track), current = settings(this.track);
                if (CONTROLS.some(({mode}) => caps[mode]?.includes('continuous') && current[mode] !== 'continuous')) await this.restore();
                restored = true;
              }
            }
            catch { this.restoreFailed(); }
            finally { this.lateWrites--; }
            if (restored && this.live()) this.patch({ busy: false, locked: false, note: 'Camera lock not supported — auto kept' });
          };
          void write.then(compensate, compensate);
        }
        throw error;
      }
    });
  }
  private cancel() { ++this.generation; clearTimeout(this.timer); this.wake?.(); this.wake = undefined; this.stopMeasurement?.(); }
  private delay(ms: number, pauseWhenHidden = true) {
    return new Promise<void>(resolve => {
      const finish = () => { document.removeEventListener('visibilitychange', visible); this.wake = undefined; resolve(); };
      const visible = () => { if (!document.hidden) finish(); };
      this.wake = finish;
      // Pause measurements while hidden. Keep the current camera controls and lock.
      this.timer = setTimeout(() => { if (pauseWhenHidden && document.hidden) document.addEventListener('visibilitychange', visible); else finish(); }, ms);
    });
  }
  private ended = () => { this.cancel(); this.patch({ supported: false, locked: false, busy: false, note: 'Camera stopped.' }); };
  private hide = () => { this.cancel(); void bounded(this.restore(), 500).then(() => this.patch({ busy: false })).catch(() => this.restoreFailed()); };
  private show = () => { if (this.live() && this.snapshot.enabled && !this.snapshot.locked && !this.snapshot.busy) this.settle(); };
  start() {
    if (!this.live()) return;
    locks.set(this.track, this);
    let enabled = true;
    try {
      const exact = this.key ? localStorage.getItem(this.key) : null;
      if (exact !== null) enabled = exact !== '0';
      else {
        const last = JSON.parse(localStorage.getItem(this.lastKey) ?? 'null');
        if (this.track.label && last?.label === this.track.label && typeof last.enabled === 'boolean') enabled = last.enabled;
      }
    } catch { /* Memory-only fallback. */ }
    this.track.addEventListener?.('ended', this.ended);
    window.addEventListener('pagehide', this.hide); window.addEventListener('pageshow', this.show);
    if (automaticTracks.has(this.track)) enabled = false;
    this.patch({ enabled, supported: !!this.track.applyConstraints && controls(this.track).length > 0 });
    // Always start in auto, including a dirty manual value left by a previous tab or UVC open.
    if (enabled) this.settle(); else void this.restore().catch(() => this.restoreFailed());
  }
  private sample() {
    try {
      const light = this.measure?.();
      return light && [light.mean, light.clipped, light.sharpness, ...light.colour, light.frameTime ?? 0].every(Number.isFinite) ? light : null;
    } catch { return null; }
  }
  private async stable(generation: number) {
    let previous: CameraLight | null = null;
    const deadline = Date.now() + 5000;
    while (this.active(generation) && Date.now() < deadline) {
      await this.delay(500);
      if (!this.active(generation)) return null;
      const light = this.sample();
      if (light && previous && !sameFrame(previous, light) && light.mean >= 50 && light.mean <= 220 && sameLight(previous, light)) return light;
      previous = light;
    }
    return null;
  }
  /** Ignore queued/paused frames; require two fresh, settled samples after every write. */
  private async settled(generation: number, deadline: number) {
    const first = this.sample();
    let previous: CameraLight | null = null;
    while (this.active(generation) && Date.now() < deadline) {
      // Unlike auto settling, manual validation must time out even in a hidden tab.
      await this.delay(Math.min(150, deadline - Date.now()), false);
      if (!this.active(generation)) return null;
      const light = this.sample();
      if (!light || (first && sameFrame(first, light)) || (previous && sameFrame(previous, light))) continue;
      if (previous && sameLight(previous, light)) return light;
      previous = light;
    }
    return null;
  }
  private async matchBrightness(generation: number, before: CameraLight, deadline: number) {
    while (this.active(generation) && Date.now() < deadline) {
      const light = await this.settled(generation, deadline);
      if (!light || !this.active(generation)) return null;
      this.patch({ debug: `camera: auto mean ${Math.round(before.mean)}, manual mean ${Math.round(light.mean)}; exposure ${settings(this.track).exposureTime ?? '–'}` });
      const ratio = light.mean / before.mean;
      if (ratio >= .75 && ratio <= 1.33) {
        // A video can advance through buffered auto frames before manual exposure reaches it.
        // Observe at least the first 750 ms of the 1.5 s budget before accepting a lock.
        if (Date.now() >= deadline - 750) return light;
        continue;
      }
      const current = settings(this.track), exposure = current.exposureTime, range = exposureRange(this.track);
      if (current.exposureMode !== 'manual' || !range || !Number.isFinite(exposure) || exposure! < range.min || exposure! > range.max) return null;
      // getSettings() in continuous mode is a cached/default value, not a live AE reading.
      // Use pixels as feedback and the browser's advertised range/step, never a Windows unit conversion.
      const target = exposureTarget(range, exposure! * before.mean / Math.max(1, light.mean));
      if (target === exposure || (target - exposure!) * (before.mean - light.mean) <= 0 || Date.now() >= deadline) return null;
      await this.apply([{ exposureMode: 'manual', exposureTime: target }], generation, Math.min(500, deadline - Date.now()));
    }
    return null;
  }
  private acceptable(before: CameraLight, after: CameraLight) {
    // A darker exposure reduces Laplacian variance quadratically even when focus stays fixed.
    const sharpness = after.sharpness * (before.mean / Math.max(1, after.mean)) ** 2;
    return after.mean >= 50 && after.mean <= 220 && after.mean / before.mean >= .75 && after.mean / before.mean <= 1.33
      && sharpness >= Math.max(1, before.sharpness * .7)
      && after.colour.every((value, i) => Math.abs(value - before.colour[i]) <= .06);
  }
  private settle() {
    if (!this.live()) return;
    this.cancel(); const generation = this.generation;
    this.patch({ busy: true, locked: false, note: 'Checking the picture…', debug: undefined });
    void this.lock(generation).catch(async () => {
      if (this.active(generation)) try { await this.autoKept(generation); } catch { this.restoreFailed(); }
    }).finally(() => { if (generation === this.generation) this.stopMeasurement?.(); });
  }
  private async lock(generation: number) {
    await this.restore();
    if (!this.active(generation)) return;
    const before = await this.stable(generation);
    if (!this.active(generation)) return;
    const candidates = controls(this.track);
    this.patch({ supported: candidates.length > 0 });
    if (!candidates.length || !before || before.sharpness < 1) { await this.autoKept(generation); return; }
    const deadline = Date.now() + 1500;
    await this.apply(candidates.map(({ mode, value, target, current }) => ({ [mode]: target, ...(current === undefined ? {} : { [value]: current }) })), generation);
    const after = await this.matchBrightness(generation, before, deadline);
    if (!this.active(generation)) return;
    const current = settings(this.track), applied = candidates.filter(control => current[control.mode] === control.target);
    if (!after || !this.acceptable(before, after) || !applied.length) { await this.autoKept(generation); return; }
    this.patch({ locked: true, busy: false, note: `Locked: ${applied.map(control => control.mode.replace('Mode', '')).join(', ')}.` });
    await this.watchGlare(generation, before);
  }
  private async autoKept(generation: number) {
    if (!this.active(generation)) return;
    await this.restore();
    if (this.active(generation)) this.patch({ busy: false, locked: false, note: 'Camera lock not supported — auto kept' });
  }
  private async watchGlare(generation: number, before: CameraLight) {
    const first = { exposure: settings(this.track).exposureTime, light: before }, floor = Math.max(50, .75 * before.mean);
    const deadline = Date.now() + 10000;
    const report = (light: CameraLight, reason = '') => this.patch({ debug: `camera: exposure ${first.exposure ?? '–'}→${settings(this.track).exposureTime ?? '–'} (100 µs), glare ${Math.round(first.light.clipped * 100)}%→${Math.round(light.clipped * 100)}%, mean auto ${Math.round(before.mean)}→${Math.round(light.mean)}${reason ? `; ${reason}` : ''}` });
    let light = await this.settled(generation, Date.now() + 1000);
    let steps = 0;
    while (this.active(generation)) {
      // Catch a delayed manual transition too: an earlier sample may still have been an auto frame.
      if (!light || !this.acceptable(before, light)) { await this.autoKept(generation); return; }
      report(light);
      if (steps >= 3 || Date.now() >= deadline) return;
      if (light.clipped <= .03) {
        await this.delay(500, false); if (!this.active(generation)) return;
        light = await this.settled(generation, Date.now() + 1000); continue;
      }
      const current = settings(this.track), exposure = current.exposureTime, range = exposureRange(this.track);
      if (current.exposureMode !== 'manual' || !Number.isFinite(exposure) || !range) return;
      const target = exposureTarget(range, exposure! * .77);
      if (target >= exposure! || target <= 0 || light.mean * target / exposure! < floor) return;
      steps++;
      let failed = false;
      try { await this.apply([{ exposureMode: 'manual', exposureTime: target }], generation); } catch { failed = true; }
      const next = await this.settled(generation, Date.now() + 1000);
      if (!this.active(generation)) return;
      const actual = settings(this.track);
      if (failed || !next || next.mean < floor || !this.acceptable(before, next) || next.clipped > light.clipped * .75 || actual.exposureMode !== 'manual') {
        if (actual.exposureMode !== 'manual') {
          await this.autoKept(generation);
        } else {
          try {
            await this.apply([{ exposureMode: 'manual', exposureTime: exposure }], generation);
            const restoredLight = await this.settled(generation, Date.now() + 750);
            if (!this.active(generation)) return;
            const restored = settings(this.track);
            if (restored.exposureMode !== 'manual' || !restoredLight || restoredLight.mean < floor || !this.acceptable(before, restoredLight)) throw new Error('Glare rollback did not restore the picture');
          } catch {
            await this.autoKept(generation);
          }
        }
        if (!this.active(generation)) return;
        report(next ?? light, 'glare did not fall or picture became too dark; step stopped'); return;
      }
      light = next;
    }
  }
  private async restore() {
    if (this.track.readyState !== 'live' || !this.track.applyConstraints) return;
    const caps = capabilities(this.track);
    const values = CONTROLS.filter(({ mode }) => caps[mode]?.includes('continuous')).map(({ mode }) => ({ [mode]: 'continuous' }));
    if (values.length) {
      // Retry individual controls if a driver rejects the combined request.
      try { await this.apply(values); }
      catch (error) {
        if (error instanceof CameraTimeout) throw error;
        await Promise.allSettled(values.map(value => this.apply([value])));
      }
      const after = settings(this.track);
      if (values.some(value => Object.keys(value).some(mode => after[mode as Mode] !== 'continuous'))) throw new Error('Camera did not restore auto');
    }
    this.patch({ locked: false });
  }
  private restoreFailed() { this.patch({ busy: false, locked: controls(this.track).some(control => settings(this.track)[control.mode] === control.target), note: 'The camera did not return to auto. Stop the camera and try again.' }); }
  async setEnabled(enabled: boolean, remember = true): Promise<void> {
    this.cancel();
    this.patch({ enabled, busy: true, note: '', debug: undefined });
    if (enabled) automaticTracks.delete(this.track);
    if (remember) try {
      if (this.key) localStorage.setItem(this.key, enabled ? '1' : '0');
      if (this.track.label) localStorage.setItem(this.lastKey, JSON.stringify({ label: this.track.label, enabled }));
    } catch { /* Memory-only fallback. */ }
    if (!this.live()) return;
    if (enabled) this.settle();
    else try { await this.restore(); this.patch({ busy: false, note: 'Camera lock is off.' }); } catch { this.restoreFailed(); }
  }
  relock = () => this.setEnabled(true);
  release(): Promise<void> {
    if (this.releasing) return this.releasing;
    this.cancel();
    this.track.removeEventListener?.('ended', this.ended);
    window.removeEventListener('pagehide', this.hide); window.removeEventListener('pageshow', this.show);
    this.closed = true;
    this.releasing = bounded(this.restore(), 500).catch(() => { /* The next capture starts in auto again. */ }).finally(() => { if (locks.get(this.track) === this) locks.delete(this.track); });
    return this.releasing;
  }
  dispose() { void this.release(); }
}
