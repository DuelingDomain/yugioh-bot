import { createFieldAnalyzer, createTapPreread, fieldCenter, type FieldCalibration, type FieldFormat } from "@yugidraft/vision";
import { visionPaceFactor } from "@/lib/remote/send-health-store";
import { detectCards, readerBusy, runUntilAbort, type PeekAnswer, type ReadCard } from "./recognizer";
import type { Pt } from "./quads";

const SAMPLE_GAP_MS = 250;
const ACTIVE_SAMPLE_MS = 400;
const IDLE_SAMPLE_MS = 1200;
const JOB_GAP_MS = 850;
const RETRY_MS = 2000;
const TIMEOUT_RETRY_MS = 10_000;

// All feeds share one sampler and one inference budget. Advance round-robin after each sample.
type Feed = { nextAt: number; tick(at: number): Promise<boolean> };
const feeds = new Set<Feed>();
let timer: ReturnType<typeof setTimeout> | undefined;
let ticking = false;
let retryAfterTimeout = -Infinity;

function schedule(delay = 0) {
  if (timer === undefined && !ticking && feeds.size) timer = setTimeout(run, delay);
}

async function run() {
  timer = undefined;
  ticking = true;
  const at = performance.now();
  const feed = [...feeds].find(feed => feed.nextAt <= at);
  let delay = Math.min(...[...feeds].map(feed => feed.nextAt)) - at;
  try {
    if (!feed) return;
    feeds.delete(feed);
    feeds.add(feed);
    delay = SAMPLE_GAP_MS * visionPaceFactor();
    if (await feed.tick(at)) delay = JOB_GAP_MS * visionPaceFactor();
  } catch { /* A failed sample can retry on the next turn. */ }
  finally {
    ticking = false;
    schedule(Math.max(0, delay));
  }
}

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
  let scope = "", lastVideoTime = -1, lastSample = -Infinity, retryAt = -Infinity;
  const feed: Feed = { nextAt: 0, tick };

  function deferRetry(timedOut?: boolean) {
    if (timedOut) retryAfterTimeout = performance.now() + TIMEOUT_RETRY_MS;
    else retryAt = performance.now() + RETRY_MS;
  }

  function syncCalibration() {
    const calibration = options.calibration();
    const key = calibration?.orientation && video.videoWidth && video.videoHeight
      ? JSON.stringify([calibration, video.videoWidth, video.videoHeight]) : "";
    if (key !== scope) {
      scope = key;
      tracker = key && calibration ? createTapPreread(calibration, options.format) : undefined;
      analyze.reset();
      lastVideoTime = -1;
      lastSample = -Infinity;
      retryAt = -Infinity;
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

  async function tick(at: number) {
    const pace = visionPaceFactor();
    feed.nextAt = at + IDLE_SAMPLE_MS * pace;
    if (document.hidden) return false;
    const calibration = syncCalibration(), current = tracker;
    if (!current || video.currentTime === lastVideoTime) return false;
    const pixels = sample(at, calibration);
    if (!pixels) return false;
    lastSample = at;
    lastVideoTime = video.currentTime;
    const scan = current.sample(pixels, at);
    const next = current.next(card => options.tracked(fieldCenter(card)));
    if (next || scan || (pixels.scene?.sinceMark ?? 0) > 2) feed.nextAt = at + ACTIVE_SAMPLE_MS * pace;
    if ((!next && !scan) || readerBusy() || at < Math.max(retryAt, retryAfterTimeout)) return false;
    const frame = options.capture();
    if (!frame) return false;
    const signal = stop.signal;
    try {
      await runUntilAbort(signal, async () => {
        if (next) {
          const answer = await options.peek(frame, next.card, signal);
          signal.throwIfAborted();
          const latestCalibration = syncCalibration();
          if (document.hidden || current !== tracker) return;
          if (answer.status !== "ready") { deferRetry(answer.timedOut); return; }
          const latest = sample(performance.now(), latestCalibration);
          if (!latest || !current.currentFront(next, latest)) return;
          const { peek } = answer;
          const identity = peek.tier === "sure" && !peek.faceDown && !peek.covered && peek.cardId
            ? { cardId: peek.cardId, name: peek.name ?? `Card ${peek.cardId}` } : undefined;
          current.finish(next, identity);
        } else {
          const bitmap = await createImageBitmap(frame);
          if (signal.aborted || document.hidden || readerBusy()) { bitmap.close(); return; }
          const found = await detectCards(bitmap, { shadowPass: false }, signal);
          signal.throwIfAborted();
          syncCalibration();
          if (document.hidden || current !== tracker) return;
          if (found.status !== "ready") { deferRetry(found.timedOut); return; }
          pixels.scene?.mark();
          current.sample(pixels, at, found.cards);
        }
      });
    } catch {
      retryAt = performance.now() + RETRY_MS;
    }
    return true;
  }

  const visibility = () => {
    if (document.hidden) { scope = ""; tracker = undefined; }
  };
  document.addEventListener("visibilitychange", visibility);
  feeds.add(feed);
  schedule();

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
      feeds.delete(feed);
      if (!feeds.size) { clearTimeout(timer); timer = undefined; }
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
