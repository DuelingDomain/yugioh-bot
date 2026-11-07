import { VideoPreset, VideoQuality } from "livekit-client";

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
  /** Simulcast layers below the top. A receiver falls back to one of these only when its network cannot carry the top layer. */
  low: { width: 640, height: 360, maxBitrate: 300_000, maxFramerate: 15 },
  mid: { width: 1280, height: 720, maxBitrate: 1_000_000, maxFramerate: 15 },
  /** Which layer a spectator asks for: the top layer, same as a seated player. LiveKit drops to a lower layer by itself when the network is too weak. */
  spectatorLayer: VideoQuality.HIGH,
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
  };
}
