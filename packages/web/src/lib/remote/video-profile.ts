import { Track, VideoPreset, VideoQuality, type LocalParticipant, type LocalVideoTrack } from "livekit-client";

/**
 * How a webcam is published to the table. Every number is here; change one place.
 *
 * The owner's raw capture is NOT affected: the field watcher and the click reader read the local camera at 1080p, 30 fps
 * (`FIELD_CAMERA`, `optimizeRecognitionCapture`). `maxFramerate` limits the encoder only, so capture stays at 30 fps and the
 * encoder drops every second frame. Received frames serve peek, Read all and viewing; they do not identify a click.
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
  top: { maxBitrate: 1_500_000, maxFramerate: 15 },
  /** Simulcast layers below the top. Every receiver (player or spectator) asks for the top layer; it falls back to one of these only when LiveKit finds its network cannot carry the top layer. */
  low: { width: 640, height: 360, maxBitrate: 300_000, maxFramerate: 15 },
  mid: { width: 1280, height: 720, maxBitrate: 1_000_000, maxFramerate: 15 },
  /** The layer every receiver asks for, seated or spectating. Adaptive stream is off, so a small tile never picks a lower layer. */
  receiverLayer: VideoQuality.HIGH,
  /** The encoder must have made a frame within this time, else the camera is published again as `fallbackCodec`. */
  encoderCheckMs: 5000,
} as const;

const preset = ({ width, height, maxBitrate, maxFramerate }: { width: number; height: number; maxBitrate: number; maxFramerate: number }) =>
  new VideoPreset(width, height, maxBitrate, maxFramerate);

/** True where this browser can encode H.264 (when it cannot say, LiveKit's own default applies and a failed publish retries with VP8). */
export function canEncodeH264(): boolean {
  try {
    const codecs = (globalThis as { RTCRtpSender?: { getCapabilities?: (kind: string) => { codecs: { mimeType: string }[] } | null } }).RTCRtpSender?.getCapabilities?.("video")?.codecs;
    return !codecs || codecs.some(codec => codec.mimeType.toLowerCase() === "video/h264");
  } catch { return true; }
}

/** The options for `publishTrack` with the profile's caps, for one codec. Simulcast: low, mid and top layer. */
export function cameraPublishOptions(codec: string = canEncodeH264() ? CAMERA_PUBLISH.codec : CAMERA_PUBLISH.fallbackCodec) {
  return {
    name: "field-cam", videoCodec: codec as "h264" | "vp8", simulcast: true,
    videoSimulcastLayers: [preset(CAMERA_PUBLISH.low), preset(CAMERA_PUBLISH.mid)],
    videoEncoding: { ...CAMERA_PUBLISH.top },
    degradationPreference: CAMERA_PUBLISH.degradationPreference,
    // Without this the SDK adds a VP8 backup at its own 3 Mbps / 30 fps, above the top cap.
    backupCodec: codec === CAMERA_PUBLISH.fallbackCodec ? false as const : { codec: CAMERA_PUBLISH.fallbackCodec, encoding: { ...CAMERA_PUBLISH.top } },
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
export async function publishCamera(participant: LocalParticipant, camera: LocalVideoTrack, closed: () => boolean, codec?: string): Promise<string> {
  const options = cameraPublishOptions(codec);
  try { await participant.publishTrack(camera, { ...options, source: Track.Source.Camera }); return options.videoCodec; }
  catch (error) {
    if (options.videoCodec === CAMERA_PUBLISH.fallbackCodec || closed()) throw error;
    await discard(participant, camera);
    await participant.publishTrack(camera, { ...cameraPublishOptions(CAMERA_PUBLISH.fallbackCodec), source: Track.Source.Camera });
    return CAMERA_PUBLISH.fallbackCodec;
  }
}

/**
 * An encoder can fail after a good publish (the browser lists H.264 but makes no frames): opponents then see no video.
 * If no frame is encoded within `encoderCheckMs` while the camera runs, publish again as VP8. Checks up to three times (a muted camera makes no frames).
 * Returns a cancel function.
 */
export function watchEncoder(participant: LocalParticipant, camera: LocalVideoTrack, codec: string, closed: () => boolean, republished: () => void, waitMs: number = CAMERA_PUBLISH.encoderCheckMs): () => void {
  if (codec === CAMERA_PUBLISH.fallbackCodec) return () => undefined;
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, tries = 0;
  const check = async () => {
    if (stopped || closed()) return;
    try {
      const running = !camera.isMuted && camera.mediaStreamTrack.readyState === "live";
      if (running && await framesEncoded(camera) === 0) {
        await discard(participant, camera);
        if (stopped || closed()) return;
        await participant.publishTrack(camera, { ...cameraPublishOptions(CAMERA_PUBLISH.fallbackCodec), source: Track.Source.Camera });
        republished(); return;
      }
      if (running || ++tries >= 3) return;
    } catch { return; }
    timer = setTimeout(() => void check(), waitMs);
  };
  timer = setTimeout(() => void check(), waitMs);
  return () => { stopped = true; clearTimeout(timer); };
}
