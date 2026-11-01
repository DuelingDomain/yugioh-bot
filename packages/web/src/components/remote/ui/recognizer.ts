import type { RecognizeRawFeed } from "@/lib/remote/video";

/** One guess shown in the tray. `score` is null for guesses that are not image matches. */
export type Guess = { cardId: number; name: string; score: number | null; source?: "ai" };
export type Priors = { decklist: number[]; seen: number[] };
export type ReaderStatus = "vision" | "priors" | "none";
export type ReadResult = {
  guesses: Guess[]; reader: ReaderStatus; frames: number; note: string; tier?: "sure" | "not sure" | "low match";
  /** Set when this browser read the card itself. Names the kept crop: the tray can ask AI about it, and a confirmed choice can be saved as a training sample. */
  aiToken?: number;
};
/** The card box the detector found, as fractions of the frame. Passing it makes the reader crop that exact card. */
export type ReadCard = { quad: { x: number; y: number }[]; kind: "face-up" | "face-down"; confidence: number; partial: boolean; covered?: boolean };

type Meta = { entries: { cardId: string; passcode: number; name: string }[] };
type DetectedQuad = ReadCard & { refined: boolean };
type RawResult = { candidates: { cardId: string; score: number }[]; tier?: "sure" | "not sure" | "low match"; cropJpeg?: string; feedback?: object };
type AIReading = { name: string | null; passcode?: number; match: { passcode: number; name: string } | null };
type RawPeek = { cardId?: string; name: string | null; tier: "sure" | "not sure" | "low match"; faceDown: boolean; covered: boolean };
type RawBoardCard = RawPeek & { outline: DetectedQuad; index: number; side: "near" | "far"; error?: string };
type RawBoard = { near: RawBoardCard[]; far: RawBoardCard[]; timingsMs: { detect: number; total: number } };
type VisionRecognizer = {
  recognize(frames: ImageBitmap[], opts?: object): Promise<RawResult>;
  peek(frame: ImageBitmap, opts: { card: ReadCard; cards?: ReadCard[]; priors?: object; signal?: AbortSignal }): Promise<RawPeek>;
  readAll(frame: ImageBitmap, opts: { cards?: ReadCard[]; priors?: object; signal?: AbortSignal }): Promise<RawBoard>;
  detectCards(frame: ImageBitmap): Promise<ReadCard[]>;
  askAI(result: RawResult, options?: { explicitRequest?: boolean; signal?: AbortSignal }): Promise<AIReading>;
  recordFeedback(result: RawResult, chosenCardId: string, source: FeedbackSource): Promise<unknown>;
  dispose(): void;
};

export type FeedbackSource = "pick" | "search" | "voice" | "ai";
const READ_TIMEOUT_MS = 10_000;
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
    return createRecognizer({ profile: yugioh, backend: "auto" }) as unknown as VisionRecognizer;
  }).catch(() => null);
  return recognizer;
}

const idsFor = (found: Meta, passcodes: number[]) => {
  const byPasscode = new Map(found.entries.map(entry => [entry.passcode, entry]));
  return passcodes.map(code => byPasscode.get(code)?.cardId).filter((id): id is string => !!id);
};
const priorsFor = (found: Meta, priors: Priors) => ({ decklist: idsFor(found, priors.decklist), seen: idsFor(found, priors.seen) });
const toQuad = (card: ReadCard): ReadCard => ({ quad: card.quad, kind: card.kind, confidence: card.confidence, partial: card.partial, ...(card.covered ? { covered: true } : {}) });

export type Peek = { cardId?: number; name: string | null; tier: "sure" | "not sure" | "low match"; faceDown: boolean; covered: boolean };
export type PeekAnswer = { status: "ready"; peek: Peek } | { status: "unavailable" | "error"; note: string };
/** Names one outlined card of a frozen frame, locally. No crop leaves this browser and no AI is asked. */
export function peekCard(frame: HTMLCanvasElement, card: ReadCard, cards: ReadCard[], priors: Priors, signal: AbortSignal): Promise<PeekAnswer> {
  return enqueue(async () => {
    const vision = await loadRecognizer(); const found = await loadMeta();
    if (!vision || !found) return { status: "unavailable" as const, note: "The card reader is not installed here." };
    try {
      signal.throwIfAborted();
      const bitmap = await createImageBitmap(frame);
      const answer = await vision.peek(bitmap, { card: toQuad(card), cards: cards.map(toQuad), priors: priorsFor(found, priors), signal });
      const entry = answer.cardId ? found.entries.find(e => e.cardId === answer.cardId) : undefined;
      return { status: "ready" as const, peek: { cardId: entry?.passcode, name: answer.name ?? entry?.name ?? null, tier: answer.tier, faceDown: answer.faceDown, covered: answer.covered } };
    } catch (error) { return { status: "error" as const, note: error instanceof Error ? error.message : "Peek failed" }; }
  });
}

export type BoardRead = Peek & { index: number; side: "near" | "far"; quad: { x: number; y: number }[]; error?: string };
export type BoardAnswer = { status: "ready"; near: BoardRead[]; far: BoardRead[]; ms: number } | { status: "unavailable" | "error"; note: string };
/** Reads every outlined card of a frozen frame (up to 60), split into the near and far side of the mat. */
export function readBoard(frame: HTMLCanvasElement, cards: ReadCard[], priors: Priors, signal: AbortSignal): Promise<BoardAnswer> {
  return enqueue(async () => {
    const vision = await loadRecognizer(); const found = await loadMeta();
    if (!vision || !found) return { status: "unavailable" as const, note: "The card reader is not installed here." };
    try {
      signal.throwIfAborted();
      const bitmap = await createImageBitmap(frame);
      const result = await vision.readAll(bitmap, { cards: cards.map(toQuad), priors: priorsFor(found, priors), signal });
      const convert = (entry: RawBoardCard): BoardRead => {
        const match = entry.cardId ? found.entries.find(e => e.cardId === entry.cardId) : undefined;
        return { cardId: match?.passcode, name: entry.name ?? match?.name ?? null, tier: entry.tier, faceDown: entry.faceDown, covered: entry.covered, index: entry.index, side: entry.side, quad: entry.outline.quad, error: entry.error };
      };
      return { status: "ready" as const, near: result.near.map(convert), far: result.far.map(convert), ms: Math.round(result.timingsMs.total) };
    } catch (error) {
      if (signal.aborted) return { status: "error" as const, note: "Cancelled." };
      return { status: "error" as const, note: error instanceof Error ? error.message : "Board read failed" };
    }
  });
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
/** Whether recognition may keep a card crop for the training set. Set from the signed-in person's opt-in. */
let feedbackCapture = false;
export function setFeedbackCapture(on: boolean) { feedbackCapture = on; }

/**
 * Reads one card. The time limit starts when the job leaves the reader queue, so a board read ahead of it does not use it up.
 * A read that runs too long answers with the decklist instead of failing.
 */
export function readCard(track: MediaStreamTrack | null, point: { x: number; y: number }, priors: Priors, outer: AbortSignal, card?: ReadCard, frames?: HTMLCanvasElement[]): Promise<ReadResult> {
  return enqueue(async () => {
    const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
    const signal = AbortSignal.any([outer, timeout]);
    try { return await readCardNow(track, point, priors, signal, card, frames); }
    catch (error) {
      if (timeout.aborted && !outer.aborted) return fallbackRead(priors, "The read took too long. Showing cards from the decklist.");
      throw error;
    }
  });
}

/** Saves a confirmed card as a training sample. One sample per read; never throws. */
export async function recordFeedback(token: number, passcode: number, source: FeedbackSource): Promise<{ ok: boolean; note: string }> {
  const raw = raws.get(token); if (!raw?.feedback) return { ok: false, note: "" };
  const [vision, found] = await Promise.all([loadRecognizer(), loadMeta()]);
  const entry = found?.entries.find(item => item.passcode === passcode);
  if (!vision || !entry) return { ok: false, note: "" };
  raw.feedback = undefined;
  try { await vision.recordFeedback(raw, entry.cardId, source); return { ok: true, note: "Saved to the training set" }; }
  catch (error) { return { ok: false, note: error instanceof Error ? error.message : "The sample could not be saved" }; }
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
function fallbackRead(priors: Priors, note: string): ReadResult {
  const ids = [...new Set([...priors.seen, ...priors.decklist])].slice(0, 5);
  return { guesses: ids.map(cardId => ({ cardId, name: "", score: null })), reader: ids.length ? "priors" : "none", frames: 0, note };
}
async function readCardNow(track: MediaStreamTrack | null, point: { x: number; y: number }, priors: Priors, signal: AbortSignal, card?: ReadCard, kept?: HTMLCanvasElement[]): Promise<ReadResult> {
  const fallback = (note: string) => fallbackRead(priors, note);
  if (!track && !kept?.length) return fallback("No camera frame available. Showing cards from the decklist.");
  const vision = await loadRecognizer();
  const found = await loadMeta();
  if (!vision || !found) return fallback("Card reader data is not installed here. Showing cards from the decklist.");
  // Frames the feed already holds (its ring buffer) read at once. Without them the track is sampled for about a second.
  const frames = kept?.length ? await Promise.all(kept.map(frame => createImageBitmap(frame))) : await sampleFrames(track!, signal);
  if (!frames.length) return fallback("The camera gave no frames. Showing cards from the decklist.");
  const byId = new Map(found.entries.map(entry => [entry.cardId, entry]));
  try {
    const result = await vision.recognize(frames, { clickPoint: point, k: 5, ...(card ? { card: toQuad(card) } : {}), includeCrop: true, ...(feedbackCapture ? { includeFeedback: true } : {}), priors: priorsFor(found, priors) });
    signal.throwIfAborted();
    const guesses = result.candidates.flatMap(candidate => {
      const entry = byId.get(candidate.cardId);
      return entry ? [{ cardId: entry.passcode, name: entry.name, score: candidate.score }] : [];
    }).slice(0, 5);
    return { guesses, reader: "vision", frames: frames.length, note: kept?.length ? `Sharpest of ${frames.length} buffered ${frames.length === 1 ? "frame" : "frames"}` : `Sharpest of ${frames.length} frames`, tier: result.tier, aiToken: result.cropJpeg ? keep(result) : undefined };
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
