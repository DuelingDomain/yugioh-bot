import type { RecognizeRawFeed } from "@/lib/remote/video";

/** One guess shown in the tray. `score` is null for guesses that are not image matches. */
export type Guess = { cardId: number; name: string; score: number | null; source?: "ai" };
export type Priors = { decklist: number[]; seen: number[] };
export type ReaderStatus = "vision" | "priors" | "none";
export type ReadResult = {
  guesses: Guess[]; reader: ReaderStatus; frames: number; note: string; tier?: "sure" | "not sure" | "low match";
  /** Set when this browser read the card itself. Lets the tray ask for an optional AI second opinion on the same crop. */
  aiToken?: number;
};
/** The card box the detector found, as fractions of the frame. Passing it makes the reader crop that exact card. */
export type ReadCard = { quad: { x: number; y: number }[]; kind: "face-up" | "face-down"; confidence: number; partial: boolean };

type Meta = { entries: { cardId: string; passcode: number; name: string }[] };
type DetectedQuad = ReadCard & { refined: boolean };
type RawResult = { candidates: { cardId: string; score: number }[]; tier?: "sure" | "not sure" | "low match"; cropJpeg?: string };
type AIReading = { name: string | null; passcode?: number; match: { passcode: number; name: string } | null };
type VisionRecognizer = {
  recognize(frames: ImageBitmap[], opts?: object): Promise<RawResult>;
  detectCards(frame: ImageBitmap): Promise<ReadCard[]>;
  askAI(result: RawResult, options?: { explicitRequest?: boolean; signal?: AbortSignal }): Promise<AIReading>;
  dispose(): void;
};

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
/** The reader handles one job at a time (reads and outlines share it). Later jobs wait their turn. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.catch(() => undefined);
  return run;
}
export function readCard(track: MediaStreamTrack | null, point: { x: number; y: number }, priors: Priors, signal: AbortSignal, card?: ReadCard): Promise<ReadResult> {
  return enqueue(() => readCardNow(track, point, priors, signal, card));
}

/** Last raw reads, kept so Ask AI can reuse the crop. The crop stays in this browser until the person asks. */
const raws = new Map<number, RawResult>(); let rawCount = 0;
function keep(raw: RawResult) { const id = ++rawCount; raws.set(id, raw); for (const old of raws.keys()) if (old <= id - 6) raws.delete(old); return id; }
export type AiAnswer = { status: "ok"; guess: Guess } | { status: "none" | "off" | "error"; note: string };
/** Sends the kept crop for an optional AI second opinion. Only the owner can use it. */
export async function askAi(token: number, signal?: AbortSignal): Promise<AiAnswer> {
  const raw = raws.get(token); const vision = await loadRecognizer();
  if (!raw?.cropJpeg || !vision) return { status: "error", note: "No card image is kept for this read. Click the card again." };
  try {
    const answer = await vision.askAI(raw, { explicitRequest: true, signal });
    if (answer.match) return { status: "ok", guess: { cardId: answer.match.passcode, name: answer.match.name, score: null, source: "ai" } };
    return { status: "none", note: "The AI could not read this card either." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI reading failed";
    return { status: /disabled|owner/i.test(message) ? "off" : "error", note: message };
  }
}

/** Reads one card at a click point. Frames stay in this browser; only public passcodes leave it. */
async function readCardNow(track: MediaStreamTrack | null, point: { x: number; y: number }, priors: Priors, signal: AbortSignal, card?: ReadCard): Promise<ReadResult> {
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
    const result = await vision.recognize(frames, { clickPoint: point, k: 5, ...(card ? { card } : {}), includeCrop: true, priors: { decklist: idsFor(priors.decklist), seen: idsFor(priors.seen) } });
    signal.throwIfAborted();
    const guesses = result.candidates.flatMap(candidate => {
      const entry = byId.get(candidate.cardId);
      return entry ? [{ cardId: entry.passcode, name: entry.name, score: candidate.score }] : [];
    }).slice(0, 5);
    return { guesses, reader: "vision", frames: frames.length, note: `Sharpest of ${frames.length} frames`, tier: result.tier, aiToken: result.cropJpeg ? keep(result) : undefined };
  } catch (error) {
    if (signal.aborted) throw error;
    return fallback("The card reader failed. Showing cards from the decklist.");
  } finally { for (const frame of frames) frame.close(); }
}

export type Detection = { status: "ready"; cards: DetectedQuad[]; ms: number } | { status: "unavailable" | "error"; cards: []; note: string };
/** Finds every card in one frame. The bitmap is consumed. Without the card reader installed this answers "unavailable". */
export function detectCards(frame: ImageBitmap): Promise<Detection> {
  return enqueue(async () => {
    const vision = await loadRecognizer(); const found = await loadMeta();
    if (!vision || !found) { frame.close(); return { status: "unavailable" as const, cards: [] as [], note: "The card reader is not installed here." }; }
    const start = performance.now();
    try {
      const cards = await vision.detectCards(frame);
      return { status: "ready" as const, cards: cards.map(card => ({ ...card, refined: !card.partial })), ms: Math.round(performance.now() - start) };
    } catch (error) { return { status: "error" as const, cards: [] as [], note: error instanceof Error ? error.message : "The card detector failed." }; }
  });
}

/** Adapter for RemoteVideo: answers a remote request from the raw local track. */
export function makeRecognizeRawFeed(getPriors: () => Priors, resolveNames: (ids: number[]) => Promise<Map<number, string>>): RecognizeRawFeed {
  return async ({ track, request, signal }) => {
    const result = await readCard(track, { x: request.x, y: request.y }, getPriors(), signal);
    const names = await resolveNames(result.guesses.filter(g => !g.name).map(g => g.cardId));
    return result.guesses.map(g => ({ cardId: g.cardId, name: g.name || names.get(g.cardId) || `Card ${g.cardId}`, score: g.score ?? 0 })).slice(0, 5);
  };
}
