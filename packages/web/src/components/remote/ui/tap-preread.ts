import { createFieldAnalyzer, createTapPreread, fieldCenter, type FieldCalibration, type FieldFormat } from "@yugidraft/vision";
import { visionPaceFactor } from "@/lib/remote/send-health-store";
import { detectCards, readerBusy, type PeekAnswer, type ReadCard } from "./recognizer";
import type { Pt } from "./quads";

const SAMPLE_MS = 120;
const DETECT_GAP_MS = 240;
const IDLE_SCAN_MS = 1800;
const RETRY_MS = 2000;
const PEEK_LIMIT_MS = 1800;
// One speculative job across both feeds. Live requests keep their existing worker queues.
let backgroundBusy = false;

export function watchTapFeed(options: {
  video: HTMLVideoElement;
  capture(): HTMLCanvasElement | null;
  calibration(): FieldCalibration | undefined;
  format: FieldFormat;
  tracked(point: Pt): boolean;
  peek(frame: HTMLCanvasElement, card: ReadCard, signal: AbortSignal): Promise<PeekAnswer>;
}) {
  const { video } = options;
  const stop = new AbortController();
  const analyze = createFieldAnalyzer();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let tracker: ReturnType<typeof createTapPreread> | undefined;
  let scope = "", lastVideoTime = -1, lastSample = -Infinity, scannedAt = -Infinity, retryAt = -Infinity;
  let timer: ReturnType<typeof setTimeout>;

  function syncCalibration() {
    const calibration = options.calibration();
    const key = calibration?.orientation && video.videoWidth && video.videoHeight
      ? JSON.stringify([calibration, video.videoWidth, video.videoHeight]) : "";
    if (key !== scope) {
      scope = key;
      tracker = key && calibration ? createTapPreread(calibration, options.format) : undefined;
      analyze.reset();
      lastVideoTime = -1;
      scannedAt = -Infinity;
    }
    return calibration;
  }

  function sample(at: number, calibration?: FieldCalibration) {
    if (!context || video.readyState < 2 || document.hidden || !video.videoWidth || !video.videoHeight) return;
    const width = Math.min(320, video.videoWidth), height = Math.max(3, Math.round(video.videoHeight * width / video.videoWidth));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    return analyze(context.getImageData(0, 0, width, height), at, calibration?.corners);
  }

  async function tick() {
    const at = performance.now(), calibration = syncCalibration(), current = tracker;
    if (!current || document.hidden || video.currentTime === lastVideoTime) return;
    const pixels = sample(at, calibration);
    if (!pixels) return;
    lastSample = at;
    lastVideoTime = video.currentTime;
    const changed = current.sample(pixels, at);
    if (backgroundBusy || readerBusy() || at < retryAt) return;

    const next = current.next(card => options.tracked(fieldCenter(card)));
    const sinceScan = (at - scannedAt) / visionPaceFactor();
    const scan = sinceScan >= IDLE_SCAN_MS || sinceScan >= DETECT_GAP_MS && (changed || (pixels.scene?.sinceMark ?? 0) > 2);
    if (!next && !scan) return;
    const frame = options.capture();
    if (!frame) return;
    backgroundBusy = true;
    try {
      if (next) {
        const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(PEEK_LIMIT_MS)]);
        const answer = await options.peek(frame, next.card, signal);
        const latestCalibration = syncCalibration();
        if (stop.signal.aborted || document.hidden || current !== tracker) return;
        if (answer.status !== "ready") { retryAt = performance.now() + RETRY_MS; return; }
        const latest = sample(performance.now(), latestCalibration);
        if (!latest || !current.currentFront(next, latest)) return;
        const { peek } = answer;
        const identity = peek.tier === "sure" && !peek.faceDown && !peek.covered && peek.cardId
          ? { cardId: peek.cardId, name: peek.name ?? `Card ${peek.cardId}` } : undefined;
        current.finish(next, identity);
      } else {
        scannedAt = at;
        const bitmap = await createImageBitmap(frame);
        if (stop.signal.aborted || document.hidden) { bitmap.close(); return; }
        const found = await detectCards(bitmap, { shadowPass: false }, true);
        syncCalibration();
        if (stop.signal.aborted || document.hidden || current !== tracker) return;
        if (found.status !== "ready") { retryAt = performance.now() + RETRY_MS; return; }
        pixels.scene?.mark();
        current.sample(pixels, at, found.cards);
      }
    } catch {
      retryAt = performance.now() + RETRY_MS;
    } finally { backgroundBusy = false; }
  }

  const loop = async () => {
    const at = performance.now();
    try { await tick(); } catch { /* The next visible sample can retry a failed capture. */ }
    if (!stop.signal.aborted) timer = setTimeout(loop, Math.max(0, SAMPLE_MS - (performance.now() - at)));
  };
  const visibility = () => {
    if (document.hidden) { scope = ""; tracker = undefined; }
  };
  document.addEventListener("visibilitychange", visibility);
  void loop();

  return {
    hit(point: Pt) {
      const at = performance.now(), calibration = syncCalibration();
      if (!tracker || at - lastSample > 500 && video.currentTime === lastVideoTime) return;
      const pixels = sample(at, calibration);
      if (!pixels) return;
      const track = tracker.hit(point, pixels);
      if (!track?.identity) return;
      const current = tracker;
      return { card: track.card, identity: track.identity, invalidate: () => current.finish(track) };
    },
    stop() {
      stop.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
