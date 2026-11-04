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
export type CameraLight = { clipped: number; mean: number };

/** Near-white clipping and mean Rec. 709 luminance, in the convex mat quad or centre 70%.
 * Pixel centres are tested against the quad itself, so light outside a tilted mat is excluded.
 */
export function measureCameraLight({ data, width, height }: Pick<ImageData, 'data' | 'width' | 'height'>, corners?: readonly CameraPoint[]): CameraLight | null {
  const quad = corners?.length === 4 ? corners : [{ x: .15, y: .15 }, { x: .85, y: .15 }, { x: .85, y: .85 }, { x: .15, y: .85 }];
  let count = 0, clipped = 0, luminance = 0;
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
    const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    count++; if (r >= 250 && g >= 250 && b >= 250) clipped++;
    luminance += .2126 * r + .7152 * g + .0722 * b;
  }
  return count ? { clipped: clipped / count, mean: luminance / count } : null;
}

function capabilities(track: MediaStreamTrack): CameraCapabilities {
  try { return track.getCapabilities?.() ?? {}; } catch { return {}; }
}
function settings(track: MediaStreamTrack): CameraSettings {
  try { return track.getSettings?.() ?? {}; } catch { return {}; }
}
function controls(track: MediaStreamTrack): Control[] {
  const caps = capabilities(track), current = settings(track);
  return CONTROLS.flatMap<Control>(({ mode, value }) => {
    const modes = caps[mode], range = caps[value], number = current[value];
    if (modes?.includes('manual') && range && Number.isFinite(number) && number! >= range.min && number! <= range.max)
      return [{ mode, value, target: 'manual', current: number }];
    if (mode === 'focusMode' && modes?.includes('single-shot')) return [{ mode, value, target: 'single-shot' }];
    return [];
  });
}

/** Request bounded capture sizes before publishing, retaining the same track and device. */
export async function optimizeRecognitionCapture(track: MediaStreamTrack): Promise<void> {
  const caps = capabilities(track);
  if (!caps.width || !caps.height || !track.applyConstraints) return;
  // Prefer 720p30 over a 1080p mode that can deliver only 15 fps. Then allow slower devices.
  for (const strictRate of [true, false]) for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    if (width > (caps.width.max ?? 0) || width < (caps.width.min ?? 0) || height > (caps.height.max ?? 0) || height < (caps.height.min ?? 0)) continue;
    try {
      const fps = Math.min(30, caps.frameRate?.max ?? 30);
      await track.applyConstraints({ ...track.getConstraints(), width: { exact: width }, height: { exact: height },
        ...(fps >= (caps.frameRate?.min ?? 0) ? { frameRate: strictRate ? { exact: fps } : { ideal: fps, max: fps } } : {}) });
      return;
    } catch { /* Some UVC size/rate combinations are absent despite the advertised ranges. */ }
    if (track.readyState === 'ended') return;
  }
}

/** Only construct for an owner's local capture. Never pass a received or phone track. */
export class CameraLock {
  private snapshot = { ...CAMERA_LOCK_INITIAL };
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private closed = false;
  private pending = Promise.resolve();
  private originals = new Map<Mode, string>();
  private applied: Control[] = [];
  private readonly key: string | undefined;
  private readonly lastKey: string;
  constructor(private track: MediaStreamTrack, userKey: string, private changed: (state: CameraLockSnapshot) => void,
    private measure?: () => CameraLight | null) {
    const device = settings(track).deviceId;
    // Like calibration, the setting stays in guarded localStorage. Seat changes keep this user's choice.
    this.key = device ? `dd-camera-lock:v1:${userKey}:device:${encodeURIComponent(device)}` : undefined;
    this.lastKey = `dd-camera-lock:last:v1:${userKey}`;
  }
  getSnapshot = () => this.snapshot;
  private live = () => !this.closed && this.track.readyState === 'live';
  private patch(value: Partial<CameraLockSnapshot>) {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...value }; this.changed(this.snapshot);
  }
  private enqueue(work: () => Promise<void>) {
    this.pending = this.pending.then(work).catch(() => { this.patch({ busy: false, note: 'Camera setting failed. Try camera lock again.' }); });
    return this.pending;
  }
  private apply(values: object[]) {
    return this.track.applyConstraints({ ...this.track.getConstraints(), advanced: values as MediaTrackConstraintSet[] });
  }
  private cancel() { ++this.generation; clearTimeout(this.timer); }
  private ended = () => { this.cancel(); this.patch({ supported: false, locked: false, busy: false, note: 'Camera stopped.' }); };
  start() {
    if (!this.live()) return;
    let enabled = true;
    try {
      const exact = this.key ? localStorage.getItem(this.key) : null;
      if (exact !== null) enabled = exact !== '0';
      else {
        // Camera IDs can rotate after permission/reload. Calibration also reuses the last matching label.
        const last = JSON.parse(localStorage.getItem(this.lastKey) ?? 'null');
        if (this.track.label && last?.label === this.track.label && typeof last.enabled === 'boolean') enabled = last.enabled;
      }
    } catch { /* Memory-only fallback, as for calibration. */ }
    this.track.addEventListener?.('ended', this.ended);
    const supported = !!this.track.applyConstraints && controls(this.track).length > 0;
    this.patch({ enabled, supported });
    // Some drivers expose image controls only after the first frames arrive.
    if ((enabled || !supported) && typeof this.track.getCapabilities === 'function' && typeof this.track.getSettings === 'function' && typeof this.track.applyConstraints === 'function') this.settle();
  }
  private settle() {
    if (!this.live()) return;
    const generation = this.generation;
    this.patch({ busy: true, note: 'Setting camera lock…' });
    this.timer = setTimeout(() => { void this.enqueue(async () => {
      if (!this.live() || generation !== this.generation) return;
      const candidates = controls(this.track), before = settings(this.track);
      if (!candidates.length) { this.patch({ supported: false, locked: false, busy: false, note: '' }); return; }
      if (!this.snapshot.enabled) { this.patch({ supported: true, busy: false, note: '' }); return; }
      for (const { mode } of candidates) if (!this.originals.has(mode) && before[mode]) this.originals.set(mode, before[mode]!);
      const values = candidates.map(({ mode, value, target, current }) => ({ [mode]: target, ...(current === undefined ? {} : { [value]: current }) }));
      try { await this.apply(values); }
      catch {
        // One rejected control must not prevent the other supported controls from locking.
        const accepted: object[] = [];
        for (const value of values) {
          if (!this.live() || generation !== this.generation) break;
          try { await this.apply([...accepted, value]); accepted.push(value); } catch { /* Keep the other controls. */ }
        }
      }
      if (!this.live()) return;
      const after = settings(this.track);
      this.applied = candidates.filter(control => after[control.mode] === control.target);
      // An Off request during apply must still restore the modes just applied.
      if (generation !== this.generation) return;
      this.patch({ supported: candidates.length > 0, locked: this.applied.length > 0, busy: false,
        note: this.applied.length ? `Locked: ${this.applied.map(control => control.mode.replace('Mode', '')).join(', ')}.` : candidates.length ? 'Camera did not accept the lock. Try Re-lock.' : '' });
      if (this.snapshot.locked) this.watchGlare(generation);
    }); }, 1500);
  }
  private watchGlare(generation: number) {
    if (!this.measure) return;
    const deadline = Date.now() + 10000;
    // Keep the mat's mean luminance within 50..220 on the 8-bit scale. Predict before
    // applying, then verify the next settled frame and restore if the driver overshoots.
    const inRange = (mean: number) => mean >= 50 && mean <= 220;
    const active = () => this.live() && generation === this.generation && this.snapshot.enabled && this.snapshot.locked;
    let first: { exposure?: number; light: CameraLight } | undefined;
    let previous: number | undefined;
    let steps = 0, stopped = '';
    const report = (light: CameraLight, note = stopped, exposure = settings(this.track).exposureTime) => {
      const pct = (value: number) => `${Math.round(value * 100)}%`;
      this.patch({ debug: `camera: exposure ${first?.exposure ?? '–'}→${exposure ?? '–'}, glare ${pct(first!.light.clipped)}→${pct(light.clipped)}, mean ${Math.round(light.mean)}${note ? `; ${note}` : ''}` });
    };
    const rollback = async (reason: string) => {
      const target = previous!; previous = undefined;
      stopped = `${reason}; exposure restored to ${target}`;
      try { await this.apply([{ exposureMode: 'manual', exposureTime: target }]); }
      catch { stopped = `${reason}; exposure restore failed`; }
      if (settings(this.track).exposureTime !== target) stopped = `${reason}; exposure restore failed`;
    };
    const schedule = () => {
      const remaining = deadline - Date.now();
      if (active() && (remaining > 0 || previous !== undefined))
        this.timer = setTimeout(() => { void this.enqueue(check); }, remaining > 0 ? Math.min(2000, remaining) : 2000);
    };
    const check = async () => {
      // Browser timers can run late. Allow the final verification up to one second late.
      if (!active() || (Date.now() > deadline + 1000 && previous === undefined)) return;
      let light: CameraLight | null = null;
      try { light = this.measure!(); } catch { /* A missing frame must not break the camera lock. */ }
      if (!light || !Number.isFinite(light.mean) || !Number.isFinite(light.clipped)) {
        if (previous !== undefined && Date.now() >= deadline) {
          await rollback('glare measurement unavailable');
          if (active()) this.patch({ debug: `camera: exposure ${first?.exposure ?? '–'}→${settings(this.track).exposureTime ?? '–'}; ${stopped}` });
          return;
        }
        this.patch({ debug: 'camera: glare measurement unavailable' }); schedule(); return;
      }
      const current = settings(this.track), exposure = current.exposureTime;
      first ??= { exposure, light };
      if (previous !== undefined && !inRange(light.mean)) {
        await rollback('luminance outside 50–220');
        if (!active()) return;
        report(light, stopped, exposure); schedule(); return;
      }
      previous = undefined;
      report(light);
      // The final sample verifies the last change; it must not start an unverified change.
      if (stopped || steps >= 3 || light.clipped <= .03 || !inRange(light.mean) || Date.now() >= deadline) { schedule(); return; }
      const range = capabilities(this.track).exposureTime;
      if (current.exposureMode !== 'manual' || !Number.isFinite(exposure) || !range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
        stopped = 'manual exposure unavailable'; report(light); schedule(); return;
      }
      const quantum = range.step && Number.isFinite(range.step) && range.step > 0 ? range.step : 1;
      // A small exposure step (~one third EV), rounded down to the driver's value grid.
      const target = Number(Math.max(range.min, Math.min(range.max, range.min + Math.floor((exposure! * .77 - range.min) / quantum) * quantum)).toPrecision(12));
      if (target >= exposure! || target <= 0 || !inRange(light.mean * target / exposure!)) { schedule(); return; }
      steps++;
      try { await this.apply([{ exposureMode: 'manual', exposureTime: target }]); }
      catch { stopped = 'exposure change rejected'; }
      if (!active()) return;
      // Even a rejected or rounded constraint can partially change the driver's state.
      previous = exposure!;
      const actual = settings(this.track);
      if (!stopped && (actual.exposureTime !== target || actual.exposureMode !== 'manual')) stopped = 'exposure change ignored';
      report(light, stopped || 'checking glare'); schedule();
    };
    schedule();
  }
  private async restore() {
    if (!this.live() || !this.applied.length) return;
    const caps = capabilities(this.track);
    const values = this.applied.flatMap(({ mode }) => {
      // Re-lock must let the automatic algorithms measure the new light before settling.
      const original = this.originals.get(mode), target = caps[mode]?.includes('continuous') ? 'continuous' : original;
      return target ? [{ [mode]: target }] : [];
    });
    if (values.length) await this.apply(values);
    const after = settings(this.track);
    if (values.some(value => Object.entries(value).some(([mode, target]) => after[mode as Mode] !== target)))
      throw new Error('Camera did not restore automatic settings');
    this.applied = [];
  }
  setEnabled(enabled: boolean): Promise<void> {
    this.cancel();
    const generation = this.generation;
    this.patch({ enabled, busy: true, note: '', debug: undefined });
    try {
      if (this.key) localStorage.setItem(this.key, enabled ? '1' : '0');
      if (this.track.label) localStorage.setItem(this.lastKey, JSON.stringify({ label: this.track.label, enabled }));
    } catch { /* Memory-only fallback. */ }
    return this.enqueue(async () => {
      if (!this.live()) return;
      await this.restore();
      if (!this.live() || generation !== this.generation) return;
      this.patch({ locked: false, busy: false });
      if (enabled && this.snapshot.supported) this.settle();
    });
  }
  relock = () => this.setEnabled(true);
  dispose() { this.cancel(); this.closed = true; this.track.removeEventListener?.('ended', this.ended); }
}
