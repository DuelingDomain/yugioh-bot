import type { LocalVideoTrack } from "livekit-client";
import type { VideoRate } from "./video-rate";
import { capSendResolution, resetEncoderHard, resetEncoderSoft, sendersOf } from "./video-profile";
import { resetSendHealth, setSendHealth } from "./send-health-store";

/**
 * Keeps the sent webcam smooth when the CPU is short. One sample every 2 s of what the browser says about the encoders:
 *
 * 1. CPU limited for 4 s: card vision samples the camera less often (`visionSlowed`, read by the field watcher through `visionPaceFactor`).
 *    The limit gone for 15 s: vision goes back to full speed.
 * 2. CPU limited for 10 s after the cause ended (the vision load dropped or the reader switched between GPU and CPU): the encoder adaptation is
 *    reset in place, soft first (content hint and caps written again), then hard after 10 s more (the sender gets a new video source). The
 *    camera is not published again, the capture is not restarted and the call stays up. Hard resets are limited to 3 per page, 60 s apart.
 * 3. Capture below 20 fps for 8 s: `slowCamera` (a dim room makes the camera lengthen its exposure and drop frames).
 */
export const SEND_HEALTH = {
  sampleMs: 2000,
  slowVisionAfterMs: 4000,
  releaseVisionAfterMs: 15_000,
  resetAfterMs: 10_000,
  hardResetAfterMs: 10_000,
  episodeEndMs: 6000,
  hardResetCooldownMs: 60_000,
  hardResetsPerPage: 3,
  slowCameraBelowFps: 20,
  slowCameraAfterMs: 8000,
  cameraOkFps: 24,
} as const;

export type SendSample = {
  /** An encoder that made frames since the last sample says the CPU limits it. */
  cpu: boolean;
  /** Capture frames per second the browser measured on the track. */
  captureFps?: number;
};
export type SendAction = "soft" | "hard";
export type SendState = { visionSlowed: boolean; slowCamera: boolean; action?: SendAction };

/** The decisions, with no browser in them: feed one sample per step. */
export function createSendPolicy() {
  let cpuSince: number | undefined, clearSince: number | undefined, causeEndedAt = -Infinity, slowedAt: number | undefined;
  let softAt: number | undefined, lastHardAt = -Infinity, hards = 0;
  let visionSlowed = false, slowCamera = false, slowSince: number | undefined, fineSince: number | undefined;
  return {
    /** Tell the policy the cause may have ended (the reader switched backend). */
    causeChanged(at: number) { causeEndedAt = at; },
    /** A hidden tab throttles timers and encoders: the counts start again. */
    hidden() { cpuSince = clearSince = slowSince = fineSince = softAt = undefined; },
    step(sample: SendSample, at: number, rate = 30): SendState {
      let action: SendAction | undefined;
      if (sample.cpu) {
        clearSince = undefined; cpuSince ??= at;
        if (!visionSlowed && at - cpuSince >= SEND_HEALTH.slowVisionAfterMs) { visionSlowed = true; slowedAt = at; }
        // Reset only when the limit holds although the likely causes ended: counted from the later of the limit start, the last backend switch and the start of the vision slow-down.
        const since = Math.max(cpuSince, causeEndedAt, slowedAt ?? -Infinity);
        if (softAt === undefined) {
          if (at - since >= SEND_HEALTH.resetAfterMs) { action = "soft"; softAt = at; }
        } else if (at - softAt >= SEND_HEALTH.hardResetAfterMs && hards < SEND_HEALTH.hardResetsPerPage && at - lastHardAt >= SEND_HEALTH.hardResetCooldownMs) {
          action = "hard"; softAt = at; lastHardAt = at; hards++;
        }
      } else {
        cpuSince = undefined; clearSince ??= at;
        if (visionSlowed && at - clearSince >= SEND_HEALTH.releaseVisionAfterMs) { visionSlowed = false; slowedAt = undefined; }
        if (at - clearSince >= SEND_HEALTH.episodeEndMs) softAt = undefined;
      }
      const fps = sample.captureFps;
      // The 15 fps setting makes the adapter deliver about 15: compare against the chosen rate.
      const slowBelow = Math.min(SEND_HEALTH.slowCameraBelowFps, rate * 2 / 3), okFrom = Math.min(SEND_HEALTH.cameraOkFps, rate * 0.8);
      if (fps !== undefined && fps > 0 && fps < slowBelow) {
        fineSince = undefined; slowSince ??= at;
        if (at - slowSince >= SEND_HEALTH.slowCameraAfterMs) slowCamera = true;
      } else if (fps !== undefined && fps >= okFrom) {
        slowSince = undefined; fineSince ??= at;
        if (at - fineSince >= SEND_HEALTH.sampleMs * 2) slowCamera = false;
      }
      return { visionSlowed, slowCamera, action };
    },
  };
}

type Stat = Record<string, unknown>;
/** Reads what the encoders of this camera did since `seen` (frames per stream id). Never throws. */
export async function readSendSample(camera: LocalVideoTrack, seen: Map<string, number>): Promise<SendSample> {
  let cpu = false, captureFps: number | undefined;
  for (const sender of sendersOf(camera)) {
    try {
      const report = await sender.getStats();
      report.forEach((row: Stat) => {
        if (row.type === "media-source" && row.kind === "video" && typeof row.framesPerSecond === "number") captureFps = Math.max(captureFps ?? 0, row.framesPerSecond);
        if (row.type !== "outbound-rtp" || row.kind !== "video") return;
        const id = String(row.id), frames = typeof row.framesEncoded === "number" ? row.framesEncoded : 0, before = seen.get(id);
        seen.set(id, frames);
        // A stream that made no frames (a paused layer, an idle backup codec) keeps an old reason: it does not count.
        if (before !== undefined && frames > before && row.qualityLimitationReason === "cpu") cpu = true;
      });
    } catch { /* A closing sender has no stats. */ }
  }
  captureFps ??= camera.mediaStreamTrack.getSettings?.().frameRate;
  return { cpu, captureFps };
}

export type SendHealthHooks = {
  /** The camera is gone or the call is closed: stop. */
  gone: () => boolean;
  rate: () => VideoRate;
  /** Runs a publish-queue step (so a reset never overlaps a publish or a rate change). */
  run: <T>(work: () => Promise<T>) => Promise<T>;
  /** Changes whenever the card reader restarts (GPU, CPU, auto): a likely end of the load. */
  readerGeneration: () => number;
  /** A reset ran (for logging). */
  reset?: (kind: SendAction) => void;
};

/** Start the monitor for one published camera. Returns a cancel function; the shared state is cleared on cancel. */
export function watchSendHealth(camera: LocalVideoTrack, hooks: SendHealthHooks, every: number = SEND_HEALTH.sampleMs): () => void {
  const policy = createSendPolicy(), seen = new Map<string, number>();
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, generation = hooks.readerGeneration(), busy = false, capping = false;
  const loop = async () => {
    if (stopped || hooks.gone()) return;
    try {
      if (typeof document !== "undefined" && document.hidden) { policy.hidden(); seen.clear(); }
      else {
        const now = Date.now();
        if (hooks.readerGeneration() !== generation) { generation = hooks.readerGeneration(); policy.causeChanged(now); }
        const sample = await readSendSample(camera, seen);
        if (stopped) return;
        const state = policy.step(sample, now, hooks.rate());
        setSendHealth({ captureFps: sample.captureFps === undefined ? undefined : Math.round(sample.captureFps), slowCamera: state.slowCamera, visionSlowed: state.visionSlowed });
        // Keep the 720p cap: the SDK writes its own encodings again after a restart or a reconnect.
        if (!busy && !capping && !state.action) { capping = true; void hooks.run(async () => { if (!stopped && !hooks.gone()) await capSendResolution(camera); }).catch(() => undefined).finally(() => { capping = false; }); }
        if (state.action && !busy) {
          busy = true;
          const kind = state.action;
          try {
            await hooks.run(async () => {
              if (stopped || hooks.gone()) return;
              if (kind === "soft") await resetEncoderSoft(camera, hooks.rate()); else await resetEncoderHard(camera, hooks.rate());
              seen.clear();
              hooks.reset?.(kind);
            });
          } catch { /* The next sample shows whether it helped. */ } finally { busy = false; }
        }
      }
    } catch { /* Stats are best effort. */ }
    if (!stopped) timer = setTimeout(() => void loop(), every);
  };
  timer = setTimeout(() => void loop(), every);
  return () => { stopped = true; clearTimeout(timer); resetSendHealth(); };
}
