import type { RecognizeRawFeed } from "@/lib/remote/video";

/** One guess shown in the tray. `score` is null for guesses that are not image matches. */
export type Guess = { cardId: number; name: string; score: number | null };
export type Priors = { decklist: number[]; seen: number[] };
export type ReaderStatus = "vision" | "priors" | "none";
export type ReadResult = { guesses: Guess[]; reader: ReaderStatus; frames: number; note: string };

type Meta = { entries: { cardId: string; passcode: number; name: string }[] };
type VisionRecognizer = { recognize(frames: ImageBitmap[], opts?: object): Promise<{ candidates: { cardId: string; score: number }[] }>; dispose(): void };

const RING_MS = 1000;
const FRAME_GAP_MS = 200;
const MAX_FRAMES = 6;

let meta: Promise<Meta | null> | null = null;
let recognizer: Promise<VisionRecognizer | null> | null = null;
/** Loaded once per page. A missing local index (404) is a normal state, not an error. */
function loadMeta() {
  meta ??= import("@yugidraft/vision").then(async ({ yugioh }) => {
    const response = await fetch(yugioh.metaUrl, { cache: "force-cache" });
    return response.ok ? await response.json() as Meta : null;
  }).catch(() => null);
  return meta;
}
function loadRecognizer() {
  recognizer ??= loadMeta().then(async found => {
    if (!found) return null;
    const { createRecognizer, yugioh } = await import("@yugidraft/vision");
    return createRecognizer({ profile: yugioh, backend: "auto" }) as VisionRecognizer;
  }).catch(() => null);
  return recognizer;
}
export function disposeRecognizer() {
  const current = recognizer; recognizer = null;
  void current?.then(value => value?.dispose());
}

/** Plays a track in a hidden element so frames can be sampled without touching the visible video. */
async function sampleFrames(track: MediaStreamTrack, signal: AbortSignal): Promise<ImageBitmap[]> {
  const element = document.createElement("video");
  element.muted = true; element.playsInline = true; element.srcObject = new MediaStream([track]);
  await element.play().catch(() => undefined);
  const frames: ImageBitmap[] = [];
  try {
    const until = Date.now() + RING_MS;
    for (let tries = 0; tries < 40 && !element.videoWidth; tries++) await new Promise(resolve => setTimeout(resolve, 50));
    while (element.videoWidth && frames.length < MAX_FRAMES && Date.now() < until + FRAME_GAP_MS) {
      signal.throwIfAborted();
      frames.push(await createImageBitmap(element));
      await new Promise(resolve => setTimeout(resolve, FRAME_GAP_MS));
    }
    return frames;
  } catch (error) { for (const frame of frames) frame.close(); throw error; }
  finally { element.pause(); element.srcObject = null; }
}

let chain: Promise<unknown> = Promise.resolve();
/** The reader handles one read at a time. Later reads wait their turn. */
export function readCard(track: MediaStreamTrack | null, point: { x: number; y: number }, priors: Priors, signal: AbortSignal): Promise<ReadResult> {
  const run = chain.then(() => readCardNow(track, point, priors, signal), () => readCardNow(track, point, priors, signal));
  chain = run.catch(() => undefined);
  return run;
}

/** Reads one card at a click point. Frames stay in this browser; only public passcodes leave it. */
async function readCardNow(track: MediaStreamTrack | null, point: { x: number; y: number }, priors: Priors, signal: AbortSignal): Promise<ReadResult> {
  const fallback = (note: string): ReadResult => {
    const ids = [...new Set([...priors.seen, ...priors.decklist])].slice(0, 5);
    return { guesses: ids.map(cardId => ({ cardId, name: "", score: null })), reader: ids.length ? "priors" : "none", frames: 0, note };
  };
  if (!track) return fallback("No camera frame available. Showing cards from the decklist.");
  const vision = await loadRecognizer();
  const found = await loadMeta();
  if (!vision || !found) return fallback("Card reader data is not installed here. Showing cards from the decklist.");
  const frames = await sampleFrames(track, signal);
  if (!frames.length) return fallback("The camera gave no frames. Showing cards from the decklist.");
  const byPasscode = new Map(found.entries.map(entry => [entry.passcode, entry]));
  const byId = new Map(found.entries.map(entry => [entry.cardId, entry]));
  const idsFor = (passcodes: number[]) => passcodes.map(code => byPasscode.get(code)?.cardId).filter((id): id is string => !!id);
  try {
    const result = await vision.recognize(frames, { clickPoint: point, k: 5, priors: { decklist: idsFor(priors.decklist), seen: idsFor(priors.seen) } });
    signal.throwIfAborted();
    const guesses = result.candidates.flatMap(candidate => {
      const entry = byId.get(candidate.cardId);
      return entry ? [{ cardId: entry.passcode, name: entry.name, score: candidate.score }] : [];
    }).slice(0, 5);
    return { guesses, reader: "vision", frames: frames.length, note: `Sharpest of ${frames.length} frames` };
  } catch (error) {
    if (signal.aborted) throw error;
    return fallback("The card reader failed. Showing cards from the decklist.");
  } finally { for (const frame of frames) frame.close(); }
}

/** Adapter for RemoteVideo: answers a remote request from the raw local track. */
export function makeRecognizeRawFeed(getPriors: () => Priors, resolveNames: (ids: number[]) => Promise<Map<number, string>>): RecognizeRawFeed {
  return async ({ track, request, signal }) => {
    const result = await readCard(track, { x: request.x, y: request.y }, getPriors(), signal);
    const names = await resolveNames(result.guesses.filter(g => !g.name).map(g => g.cardId));
    return result.guesses.map(g => ({ cardId: g.cardId, name: g.name || names.get(g.cardId) || `Card ${g.cardId}`, score: g.score ?? 0 })).slice(0, 5);
  };
}
