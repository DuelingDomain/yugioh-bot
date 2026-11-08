/** Real WebRTC traffic per camera, for the owner Debug panel. Counters only: no frames, nothing sent anywhere. */
export type CameraLayer = { rid: string; width: number; height: number; fps: number; bytes: number };
export type CameraTraffic = {
  direction: "sent" | "received"; seat: number; codec: string; width: number; height: number; fps: number;
  /** RTP payload bytes so far, all layers. Transport overhead is not in it. */
  bytes: number; at: number; layers: CameraLayer[]; limit?: string;
  /** Sent cameras only: what the webcam delivers before encoding (WebRTC media-source), and the seconds the browser limited the top layer by cause. */
  capture?: { fps: number; width: number; height: number };
  limitedFor?: { cpu: number; bandwidth: number };
};
export type CameraRate = Omit<CameraTraffic, "bytes" | "at" | "layers"> & { kbps?: number; layers: { rid: string; width: number; height: number; kbps?: number }[] };

type Stat = Record<string, unknown>;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : 0;

/** Reads one sender or receiver. Returns nothing when the browser has no stats for it. */
export async function cameraTraffic(direction: "sent" | "received", seat: number, transports: (RTCRtpSender | RTCRtpReceiver | undefined)[]): Promise<CameraTraffic[]> {
  const out: CameraTraffic[] = [];
  for (const transport of transports) {
    try {
      const report = await transport?.getStats();
      if (!report) continue;
      const rows: Stat[] = []; report.forEach((value: Stat) => rows.push(value));
      const type = direction === "sent" ? "outbound-rtp" : "inbound-rtp";
      const streams = rows.filter(r => r.type === type && (r.kind ?? r.mediaType) === "video");
      if (!streams.length) continue;
      const codecId = streams.map(r => r.codecId).find(Boolean) as string | undefined;
      const codec = String((rows.find(r => r.id === codecId)?.mimeType as string | undefined) ?? "?").replace(/^video\//i, "").toUpperCase();
      const layers = streams.map(r => ({ rid: String(r.rid ?? ""), width: num(r.frameWidth), height: num(r.frameHeight), fps: num(r.framesPerSecond), bytes: num(direction === "sent" ? r.bytesSent : r.bytesReceived) }))
        .sort((a, b) => a.width - b.width);
      const top = layers[layers.length - 1];
      const reason = streams.map(r => r.qualityLimitationReason).find(v => v && v !== "none") as string | undefined;
      const source = direction === "sent" ? rows.find(r => r.type === "media-source" && r.kind === "video") : undefined;
      const topStream = [...streams].sort((a, b) => num(b.frameWidth) - num(a.frameWidth))[0];
      const durations = topStream.qualityLimitationDurations as { cpu?: number; bandwidth?: number } | undefined;
      out.push({ direction, seat, codec, width: top.width, height: top.height, fps: top.fps, bytes: layers.reduce((n, l) => n + l.bytes, 0),
        at: Math.max(...streams.map(r => num(r.timestamp))), layers, limit: reason,
        ...(source ? { capture: { fps: num(source.framesPerSecond), width: num(source.width), height: num(source.height) } } : {}),
        ...(durations ? { limitedFor: { cpu: num(durations.cpu), bandwidth: num(durations.bandwidth) } } : {}) });
    } catch { /* A closed transport has no stats. */ }
  }
  return out;
}

const keyOf = (t: CameraTraffic) => `${t.direction}:${t.seat}:${t.codec}`;
/** kbps from two samples of the same camera. The first sample has no rate (undefined, never zero). */
export function cameraRates(previous: Map<string, CameraTraffic>, next: CameraTraffic[]): CameraRate[] {
  const seen = new Map<string, CameraTraffic>();
  const rates = next.map(({ bytes, at, ...rest }) => {
    const key = keyOf({ ...rest, bytes, at }), before = previous.get(key); seen.set(key, { ...rest, bytes, at });
    const ms = before ? at - before.at : 0;
    const kbps = before && ms > 0 && bytes >= before.bytes ? (bytes - before.bytes) * 8 / ms : undefined;
    const layers = rest.layers.map(({ rid, width, height, bytes: layerBytes }) => {
      const old = before?.layers.find(p => p.rid === rid);
      return { rid, width, height, kbps: old && ms > 0 && layerBytes >= old.bytes ? Math.round((layerBytes - old.bytes) * 8 / ms) : undefined };
    });
    return { ...rest, layers, kbps };
  });
  previous.clear(); for (const [k, v] of seen) previous.set(k, v);
  return rates;
}

/** Sent cameras: the capture before encoding and how long the browser limited the sent picture, by cause. */
const sentDetail = (r: CameraRate) => r.direction !== "sent" ? "" :
  `${r.capture ? `\n  capture ${Math.round(r.capture.fps)} fps${r.capture.width ? ` ${r.capture.width}x${r.capture.height}` : ""}` : ""}${r.limitedFor ? `\n  limited: cpu ${r.limitedFor.cpu.toFixed(1)} s · bandwidth ${r.limitedFor.bandwidth.toFixed(1)} s` : ""}`;

/** One line per camera: `sent seat 1 · H264 · 1920x1080 · 15 fps · 812 kbps`. Layers (low to top) follow for a simulcast stream. */
export function trafficLine(r: CameraRate): string {
  const rate = r.kbps === undefined ? "– kbps" : `${Math.round(r.kbps)} kbps`;
  const layers = r.layers.length > 1 ? ` [${r.layers.map(l => `${l.rid || "?"} ${l.width}x${l.height} ${l.kbps ?? "–"}`).join(" · ")}]` : "";
  return `${r.direction === "sent" ? "sent " : "recv "} seat ${r.seat + 1} · ${r.codec} · ${r.width}x${r.height} · ${Math.round(r.fps)} fps · ${rate}${r.limit ? ` · limited by ${r.limit}` : ""}${layers}${sentDetail(r)}`;
}
