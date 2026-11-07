import { DEFAULT_VIDEO_RATE, type VideoRate } from "./video-rate";
import { Track, VideoPreset, VideoQuality, type LocalParticipant, type LocalVideoTrack } from "livekit-client";

/**
 * How a webcam is published to the table. Every number is here; change one place.
 *
 * The owner's raw capture is NOT affected: the field watcher and the click reader read the local camera at 1080p, 30 fps
 * (`FIELD_CAMERA`, `optimizeRecognitionCapture`). The frame rate is a choice (`VideoRate` in `video-rate.ts`: 30 default, 15 lighter) that sets `maxFramerate` on every layer; it limits the
 * encoder only, so capture stays at 30 fps (at 15 the encoder drops every second frame). Received frames serve peek, Read all and viewing; they do not identify a click.
 *
 * Measured on a synthetic still mat (codec-measure-2026-11-06.md): H.264 1080p15 at 1.5 Mbps kept 11/11 card reads. A real
 * webcam has sensor noise and will use more; the owner Debug panel shows the real kbps per camera.
 */
export const CAMERA_PUBLISH = {
  /** Preferred codec. A browser without an H.264 encoder publishes `fallbackCodec` with the same caps. */
  codec: "h264",
  fallbackCodec: "vp8",
  contentHint: "detail",
  degradationPreference: "maintain-resolution",
  /** Top layer: the full 1080p stream. */
  top: { maxBitrate: 2_500_000 },
  /** Top layer cap at the lighter rate: 15 fps fits in 1.5 Mbps; 1.5 Mbps cannot carry 30 fps of a busy picture (measured 4 to 12 fps), so `top` is higher. */
  topLight: { maxBitrate: 1_500_000 },
  /** Simulcast layers below the top. Every receiver (player or spectator) asks for the top layer; it falls back to one of these only when LiveKit finds its network cannot carry the top layer. */
  low: { width: 640, height: 360, maxBitrate: 300_000 },
  mid: { width: 1280, height: 720, maxBitrate: 1_000_000 },
  /** The layer every receiver asks for, seated or spectating. Adaptive stream is off, so a small tile never picks a lower layer. */
  receiverLayer: VideoQuality.HIGH,
  /** The encoder must have made a frame within this time, else the camera is published again as `fallbackCodec`. */
  encoderCheckMs: 5000,
} as const;

const preset = ({ width, height, maxBitrate }: { width: number; height: number; maxBitrate: number }, rate: VideoRate) =>
  new VideoPreset(width, height, maxBitrate, rate);

/** The top layer's bitrate cap for a frame rate. */
const topAt = (rate: VideoRate) => rate === 15 ? CAMERA_PUBLISH.topLight : CAMERA_PUBLISH.top;

/** True where this browser can encode H.264 (when it cannot say, LiveKit's own default applies and a failed publish retries with VP8). */
export function canEncodeH264(): boolean {
  try {
    const codecs = (globalThis as { RTCRtpSender?: { getCapabilities?: (kind: string) => { codecs: { mimeType: string }[] } | null } }).RTCRtpSender?.getCapabilities?.("video")?.codecs;
    return !codecs || codecs.some(codec => codec.mimeType.toLowerCase() === "video/h264");
  } catch { return true; }
}

/** The options for `publishTrack` with the profile's caps, for one codec. Simulcast: low, mid and top layer. */
export function cameraPublishOptions(codec: string = canEncodeH264() ? CAMERA_PUBLISH.codec : CAMERA_PUBLISH.fallbackCodec, rate: VideoRate = DEFAULT_VIDEO_RATE) {
  return {
    name: "field-cam", videoCodec: codec as "h264" | "vp8", simulcast: true,
    videoSimulcastLayers: [preset(CAMERA_PUBLISH.low, rate), preset(CAMERA_PUBLISH.mid, rate)],
    videoEncoding: { ...topAt(rate), maxFramerate: rate },
    degradationPreference: CAMERA_PUBLISH.degradationPreference,
    // Without this the SDK adds a VP8 backup at its own 3 Mbps / 30 fps, above the top cap.
    backupCodec: codec === CAMERA_PUBLISH.fallbackCodec ? false as const : { codec: CAMERA_PUBLISH.fallbackCodec, encoding: { ...topAt(rate), maxFramerate: rate } },
  };
}

const sendersOf = (camera: LocalVideoTrack) => [camera.sender, ...[...camera.simulcastCodecs.values()].map(codec => codec.sender)].filter((sender): sender is RTCRtpSender => !!sender);

/** Frames the encoders of this camera made so far, over all layers and codecs. */
export async function framesEncoded(camera: LocalVideoTrack): Promise<number> {
  let frames = 0;
  for (const sender of sendersOf(camera)) {
    const report = await sender.getStats();
    report.forEach(stat => { if (stat.type === "outbound-rtp" && stat.kind === "video") frames += stat.framesEncoded ?? 0; });
  }
  return frames;
}

/** Remove a half-added camera so a second publish does not add a second transceiver. */
async function discard(participant: LocalParticipant, camera: LocalVideoTrack) {
  try { await participant.unpublishTrack(camera, false); } catch { /* Not published. */ }
  const engine = (participant as unknown as { engine?: { pcManager?: { publisher?: { removeTrack(sender: RTCRtpSender): void } } } }).engine;
  if (camera.sender) { try { engine?.pcManager?.publisher?.removeTrack(camera.sender); } catch { /* Already removed. */ } }
  // The server drops the old track with the next negotiation. A publish of the same track before that is lost (the id is the same).
  await new Promise(done => setTimeout(done, 1500));
}

/** Publish with the profile. A browser that cannot encode H.264 publishes VP8 with the same caps, silently. Returns the codec used. */
export async function publishCamera(participant: LocalParticipant, camera: LocalVideoTrack, closed: () => boolean, codec?: string, rate: VideoRate = DEFAULT_VIDEO_RATE): Promise<string> {
  const options = cameraPublishOptions(codec, rate);
  try { await participant.publishTrack(camera, { ...options, source: Track.Source.Camera }); return options.videoCodec; }
  catch (error) {
    if (options.videoCodec === CAMERA_PUBLISH.fallbackCodec || closed()) throw error;
    await discard(participant, camera);
    await participant.publishTrack(camera, { ...cameraPublishOptions(CAMERA_PUBLISH.fallbackCodec, rate), source: Track.Source.Camera });
    return CAMERA_PUBLISH.fallbackCodec;
  }
}

type Engine = { pcManager?: { publisher?: { pc?: RTCPeerConnection } } };
const publisherConnected = (participant: LocalParticipant) => (participant as unknown as { engine?: Engine }).engine?.pcManager?.publisher?.pc?.connectionState === "connected";

/**
 * Publish again as VP8 after the first publish went bad. If the SDK stopped the capture (its publish timeout does that), capture again first,
 * so card reading keeps a live local track. Throws when this does not work.
 */
export async function republishAsFallback(participant: LocalParticipant, camera: LocalVideoTrack, closed: () => boolean, rate: VideoRate = DEFAULT_VIDEO_RATE): Promise<void> {
  await discard(participant, camera);
  if (closed()) return;
  if (camera.mediaStreamTrack.readyState === "ended") await camera.restartTrack();
  if (closed()) return;
  await participant.publishTrack(camera, { ...cameraPublishOptions(CAMERA_PUBLISH.fallbackCodec, rate), source: Track.Source.Camera });
}

/**
 * An encoder can fail after a good publish (the browser lists H.264 but makes no frames): opponents then see no video.
 * A zero only counts when the room and the publisher connection are connected, the camera runs and its sender exists; slow ICE or a reconnect
 * is not an encoder fault. Two such checks in a row with zero frames (`waitMs` apart) publish again as VP8. Only checks that count are limited
 * (4); a connection that is not ready yet is waited for, up to 12 checks in all. A failed second publish is retried once with a fresh capture,
 * then reported through `failed`. Returns a cancel function.
 */
export function watchEncoder(participant: LocalParticipant, camera: LocalVideoTrack, codec: string, hooks: { closed: () => boolean; connected: () => boolean; rate: () => VideoRate; /** Runs one publish step after the ones before it. */ run: <T>(work: () => Promise<T>) => Promise<T>; republished: () => void; failed: (error: unknown) => void }, waitMs: number = CAMERA_PUBLISH.encoderCheckMs): () => void {
  if (codec === CAMERA_PUBLISH.fallbackCodec) return () => undefined;
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, checks = 0, counted = 0, zeros = 0;
  const gone = () => stopped || hooks.closed();
  const republish = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        // The step is queued behind other publishes (a rate change): look again when it starts.
        const done = await hooks.run(async () => { if (gone()) return false; await republishAsFallback(participant, camera, gone, hooks.rate()); return true; });
        if (done && !hooks.closed()) hooks.republished();
        return;
      }
      catch (error) { if (gone()) return; if (attempt >= 1) { hooks.failed(error); return; } }
    }
  };
  const check = async () => {
    if (gone()) return;
    checks++;
    try {
      const ready = hooks.connected() && publisherConnected(participant) && !camera.isMuted && !camera.mediaStreamTrack.muted
        && camera.mediaStreamTrack.readyState === "live" && !!camera.sender;
      if (ready) {
        counted++;
        if (await framesEncoded(camera) > 0) return;
        if (++zeros >= 2) { await republish(); return; }
      } else zeros = 0;
    } catch { zeros = 0; }
    if (counted < 4 && checks < 12) timer = setTimeout(() => void check(), waitMs);
  };
  timer = setTimeout(() => void check(), waitMs);
  return () => { stopped = true; clearTimeout(timer); };
}

/**
 * Change the frame rate of a camera that is already published. First choice: set `maxFramerate` on every sender encoding (all simulcast
 * layers and the backup codec), which needs no renegotiation. If the browser refuses, publish again with the new caps. The local capture
 * track is never stopped, so card reading goes on. Returns how it was done; throws when both ways fail.
 */
export async function applyCameraRate(participant: LocalParticipant, camera: LocalVideoTrack, codec: string, rate: VideoRate, closed: () => boolean): Promise<"live" | "republished"> {
  try {
    const senders = sendersOf(camera);
    if (!senders.length) throw new Error("No sender");
    for (const sender of senders) {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) throw new Error("No encodings");
      // The low and mid layers keep their own bitrate caps; the full layer (and a single stream) follows the rate.
      parameters.encodings.forEach(encoding => { encoding.maxFramerate = rate; if (encoding.rid !== "q" && encoding.rid !== "h") encoding.maxBitrate = topAt(rate).maxBitrate; });
      await sender.setParameters(parameters);
    }
    // The SDK reads these objects again after a full reconnect, a restart with another resolution and a late backup codec: keep them in step.
    const next = cameraPublishOptions(codec, rate);
    const publication = participant.getTrackPublication(Track.Source.Camera) as { options?: Record<string, unknown> } | undefined;
    for (const options of [camera.publishOptions as Record<string, unknown> | undefined, publication?.options]) {
      if (options) Object.assign(options, { videoEncoding: next.videoEncoding, videoSimulcastLayers: next.videoSimulcastLayers, backupCodec: next.backupCodec });
    }
    return "live";
  } catch {
    await discard(participant, camera);
    if (closed()) return "republished";
    if (camera.mediaStreamTrack.readyState === "ended") await camera.restartTrack();
    await participant.publishTrack(camera, { ...cameraPublishOptions(codec, rate), source: Track.Source.Camera });
    return "republished";
  }
}

/** True when the browser says an encoder of this camera is limited by CPU right now (WebRTC `qualityLimitationReason`). */
export async function cpuLimited(camera: LocalVideoTrack): Promise<boolean> {
  for (const sender of sendersOf(camera)) {
    const report = await sender.getStats();
    let limited = false;
    report.forEach(stat => { if (stat.type === "outbound-rtp" && stat.kind === "video" && stat.qualityLimitationReason === "cpu") limited = true; });
    if (limited) return true;
  }
  return false;
}

/**
 * LiveKit's CpuConstrained event fires on one monitor sample. This asks again every `everyMs` and calls `sustained` only after the CPU limit
 * held for `holdMs` in a row while the page was visible (a hidden tab throttles timers and encoders and starts the count again).
 * Start it from the event. Returns a cancel function.
 */
export function watchCpuLimit(camera: LocalVideoTrack, sustained: () => void, ended: () => void, holdMs = 20_000, everyMs = 5000): () => void {
  let stopped = false, since: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  // The watch ends on its own (sustained, the limit went away, stats failed): tell the owner, so a later event can start a new one. Not after a cancel.
  const finish = (sustain: boolean) => { if (stopped) return; stopped = true; ended(); if (sustain) sustained(); };
  const sample = async () => {
    if (stopped) return;
    try {
      const hidden = typeof document !== "undefined" && document.hidden;
      if (hidden) since = undefined;
      else {
        const limited = await cpuLimited(camera);
        if (stopped) return;
        if (!limited) return finish(false); // The limit went away: a later event starts a new watch.
        since ??= Date.now();
        if (Date.now() - since >= holdMs) return finish(true);
      }
    } catch { return finish(false); }
    timer = setTimeout(() => void sample(), everyMs);
  };
  timer = setTimeout(() => void sample(), everyMs);
  return () => { stopped = true; clearTimeout(timer); };
}
