import { visionPaceFactor } from "@/lib/remote/send-health-store";
import type { RecognizeRawFeed } from "@/lib/remote/video";
import { relatedPriors, type RelatedCards, type RecognitionPriors } from '@yugidraft/vision';
import { voiceHintFor, type Priors } from '@/lib/remote/recognition-priors';
import { cardReader, reportReaderNote, reportReaderRead, engineBackend, onRecognitionReset, reportBackend, reportGpuFailure, reportReadTime, type EngineBackend } from "./recognition-backend";

/** One guess shown in the tray. `score` is null for guesses that are not image matches. */
export type Guess = { cardId: number; name: string; score: number | null; source?: "ai" };
export type { Priors } from '@/lib/remote/recognition-priors';
export type ReaderStatus = "vision" | "priors" | "none";
export type ReadResult = {
  guesses: Guess[]; reader: ReaderStatus; frames: number; note: string; tier?: "sure" | "not sure" | "low match";
  /** The reader saw a card back (no guesses) or a card that is partly hidden. Both travel with a remote read. */
  faceDown?: boolean; covered?: boolean;
  /** Set when this browser read the card itself. Names the kept crop: the tray can ask AI about it, and a confirmed choice can be saved as a training sample. */
  aiToken?: number;
  visionTimingsMs?: Record<string,number>;
  readerDiagnostics?:import("@yugidraft/vision").ReaderDiagnostics;
  backend?: string;
  /** Laplacian variance near the click on the frame that was read. Absent for reads made elsewhere (a phone, a peer). */
  sharpness?: number;
  /** A second frame of this browser's own read named the same card, on a clean outline. Absent for reads made elsewhere. */
  agreed?: boolean;
};
/** The card box the detector found, as fractions of the frame. Passing it makes the reader crop that exact card. */
export type ReadCard = { quad: { x: number; y: number }[]; kind: "face-up" | "face-down"; confidence: number; partial: boolean; covered?: boolean };

type Meta = { entries: { cardId: string; passcode: number; imageId?: number; name: string }[]; related?: RelatedCards };
type DetectedQuad = ReadCard & { refined: boolean };
type WireResult = { candidates: { cardId: number; name: string; score: number }[]; tier: "sure" | "not sure" | "low match"; faceDown: boolean; covered: boolean };
type RawResult = { reader?:import("@yugidraft/vision").ReaderDiagnostics; quality?: { sharpness?: number; fallback?: boolean; partial?: boolean; covered?: boolean; selectedFrameIndices?: number[] }; candidates: { cardId: string; score: number }[]; tier?: "sure" | "not sure" | "low match"; cropJpeg?: string; feedback?: object; timingsMs?: Record<string, number>; backend?: EngineBackend };
type AIReading = { name: string | null; passcode?: number; match: { passcode: number; name: string } | null };
type RawPeek = { cardId?: string; name: string | null; tier: "sure" | "not sure" | "low match"; faceDown: boolean; covered: boolean };
type RawBoardCard = RawPeek & { outline: DetectedQuad; index: number; side: "near" | "far"; error?: string };
type RawBoard = { near: RawBoardCard[]; far: RawBoardCard[]; timingsMs: { detect: number; total: number } };
type VisionRecognizer = {
  readonly detectorBackend?: EngineBackend;
  readonly detectorTimingsMs?:Record<string,number>;
  readonly separateDetector?: boolean;
  warmup(): Promise<void>;
  prepare(opts?:import("@yugidraft/vision").PrepareOptions):Promise<{ backend: EngineBackend }>;
  recognize(frames: ImageBitmap[], opts?: object): Promise<RawResult>;
  peek(frame: ImageBitmap, opts: { card: ReadCard; cards?: ReadCard[]; priors?: object; signal?: AbortSignal }): Promise<RawPeek>;
  readAll(frame: ImageBitmap, opts: { cards?: ReadCard[]; priors?: object; signal?: AbortSignal }): Promise<RawBoard>;
  detectCards(frame: ImageBitmap, opts?:import("@yugidraft/vision").DetectOptions): Promise<ReadCard[]>;
  askAI(result: RawResult, options?: { explicitRequest?: boolean; signal?: AbortSignal }): Promise<AIReading>;
  recordFeedback(result: RawResult, chosenCardId: string, source: FeedbackSource): Promise<unknown>;
  dispose(): void;
};

export type FeedbackSource = "pick" | "search" | "voice" | "ai";
/** A frame is sharp enough when the Laplacian variance near the click is at least this. Measured on 1280-wide frames: a 2 px blur scores about 12 to 22, a clean frame 40 and up. */
export const SHARP_FLOOR = 30;
/** Top guess must lead the second by this much to be shown alone. */
export const BEST_MARGIN = 0.06;
/**
 * A read that is "not sure" but clear enough to show its top guess as the answer (popup = that card, "Wrong card?" for the rest).
 * "Sure" reads are handled apart (placed at once); "low match" and blurry frames show the guess strip first.
 */
export function isBestMatch(read: ReadResult): boolean {
  if (read.reader !== "vision" || read.tier !== "not sure" || read.faceDown || read.covered || !read.guesses.length) return false;
  const [first, second] = read.guesses;
  if (first.score === null || (read.sharpness !== undefined && read.sharpness < SHARP_FLOOR)) return false;
  return second?.score == null || first.score - second.score >= BEST_MARGIN;
}
/**
 * A "not sure" click read that is accepted at once, as Auto-detect accepts it: above the low-match floor, on a clean outline, read twice with the same winner.
 * It is stricter than Auto-detect's own Best match, because it also needs a sharp frame and a clear lead. The card shows as "Best match" with "Wrong card?".
 */
export function isClearRead(read: ReadResult): boolean { return read.agreed === true && isBestMatch(read); }
const READ_TIMEOUT_MS = 10_000;

let meta: Promise<Meta | null> | null = null;
let recognizer: Promise<VisionRecognizer | null> | null = null;
let warming: Promise<void> | null = null;
let recognizerEpoch=0;
/** Start on table open, without needing a local camera or waiting for a phone read. */
export function prewarmRecognizer(): Promise<void> {
  const epoch=recognizerEpoch;
  warming ??= (async () => {
    const started = performance.now();
    let ready = false;let reason:string|undefined;
    try { const vision = await loadRecognizer(); if(vision) { await vision.warmup(); ready = true; } }
    catch(error) { reason=error instanceof Error?error.message:"Initialization failed"; }
    window.dispatchEvent(new CustomEvent("remote-recognizer-warmup", {detail:{ms:performance.now()-started,ready,...(reason?{reason}:{})}}));
    if(!ready && epoch===recognizerEpoch)warming = null;
  })();
  return warming;
}
/** Loaded once per page. A missing local index (404) is a normal state, not an error. */
function loadMeta() {
  const selected=cardReader();
  meta ??= import("@yugidraft/vision").then(async ({ yugioh }) => {
    const response = await fetch(yugioh.metaUrl, { cache: "force-cache" });
    if (!response.ok) return null;
    const found = await response.json() as Meta;
    if(selected==="hybrid") {
      try {
        const {loadHybridCatalog}=await import('@yugidraft/vision');
        const extra=await loadHybridCatalog();found.entries=[...new Map([...extra.entries,...found.entries].map(e=>[e.cardId,e])).values()];
      }catch { /* The worker reports a visible fallback if hybrid data is unavailable. */ }
    }
    // Optional generated knowledge is loaded once, outside the per-read path.
    try {
      const response = await fetch('/dev/vision-assets/related-cards.json', { cache: 'force-cache', signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        const data = await response.json() as RelatedCards;
        if (data.version === 1 && data.names && data.links && data.groups && data.cardGroups && data.aliases) found.related = data;
      }
    } catch { /* Recognition also works before engine knowledge is prepared. */ }
    return found;
  }).catch(() => null);
  return meta;
}
function loadRecognizer() {
  const epoch=recognizerEpoch,selected=cardReader();
  recognizer ??= loadMeta().then(async found => {
    if (!found) return null;
    const { createRecognizer, yugioh } = await import("@yugidraft/vision");
    return createRecognizer({ profile: yugioh, reader:selected, backend: engineBackend(), onBackendChange: status => {if(epoch!==recognizerEpoch)return;reportBackend(status.backend, undefined, status.fallbackReason ?? "");reportReaderNote(status.readerNote??"");} }) as unknown as VisionRecognizer;
  }).catch(() => null);
  return recognizer;
}

const metaIds = new WeakMap<Meta, Map<number, string[]>>();
const idsFor = (found: Meta, passcodes: number[]) => {
  let byPasscode = metaIds.get(found);
  if (!byPasscode) {
    byPasscode = new Map();
    for (const entry of found.entries) for (const code of [entry.passcode, entry.imageId].filter((id): id is number => !!id)) {
      const ids = byPasscode.get(code) ?? []; if (!ids.includes(entry.cardId)) ids.push(entry.cardId); byPasscode.set(code, ids);
    }
    metaIds.set(found, byPasscode);
  }
  return [...new Set(passcodes.flatMap(code => byPasscode!.get(code) ?? byPasscode!.get(found.related?.aliases[code] ?? code) ?? []))];
};
const relatedCache = new WeakMap<Meta, Map<string, RecognitionPriors["related"]>>();
const priorsFor = (found: Meta, priors: Priors, voice = true): RecognitionPriors => {
  const hint = voice ? voiceHintFor(priors.scope) : { cards: [], expiresAt: undefined };
  let cache = relatedCache.get(found); if (!cache) { cache = new Map(); relatedCache.set(found, cache); }
  const key = (priors.context ?? []).join(",");
  if (!cache.has(key)) {
    cache.set(key, found.related ? relatedPriors(found.related, priors.context ?? []).flatMap(c => idsFor(found, [Number(c.cardId)]).map(cardId => ({ ...c, cardId }))) : []);
    if (cache.size > 16) cache.delete(cache.keys().next().value!);
  }
  return {
  decklist: idsFor(found, priors.decklist), seen: idsFor(found, priors.seen),
  voiceMentioned: idsFor(found, hint.cards), voiceExpiresAt: hint.expiresAt,
  related: cache.get(key),
  forbidden: idsFor(found, priors.forbidden ?? []),
  };
};
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
      reportReadTime(result.timingsMs.total);
      return { status: "ready" as const, near: result.near.map(convert), far: result.far.map(convert), ms: Math.round(result.timingsMs.total) };
    } catch (error) {
      if (signal.aborted) return { status: "error" as const, note: "Cancelled." };
      return { status: "error" as const, note: error instanceof Error ? error.message : "Board read failed" };
    }
  });
}

export function disposeRecognizer() {
  const current = recognizer; recognizer = null; meta = null; warming = null;recognizerEpoch++;
  void current?.then(value => value?.dispose());
}
// A new mode (or a GPU failure) restarts the reader; the open camera warms the new one so the badge shows where it runs.
onRecognitionReset(() => { disposeRecognizer(); if (ownVideo) void prepareOwnReader().catch(() => undefined); });

/** Plays a track in a hidden element so frames can be sampled without touching the visible video. */
async function sampleFrames(track: MediaStreamTrack, signal: AbortSignal): Promise<ImageBitmap[]> {
  const element = document.createElement("video");
  element.muted = true; element.playsInline = true; element.srcObject = new MediaStream([track]);
  await element.play().catch(() => undefined);
  const frames: ImageBitmap[] = [];
  try {
    for (let tries = 0; tries < 40 && !element.videoWidth; tries++) await new Promise(resolve => setTimeout(resolve, 50));
    if (element.videoWidth) {
      signal.throwIfAborted();
      frames.push(await createImageBitmap(element));
    }
    return frames;
  } catch (error) { for (const frame of frames) frame.close(); throw error; }
  finally { element.pause(); element.srcObject = null; }
}

let chain: Promise<unknown> = Promise.resolve();
let pendingJobs = 0;
/** The reader handles one job at a time (reads and outlines share it). Later jobs wait their turn. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  pendingJobs++;
  const run = chain.then(job, job).finally(() => { pendingJobs--; });
  chain = run.catch(() => undefined);
  return run;
}
let sceneChain: Promise<unknown> = Promise.resolve();
/** Outline passes of a split reader (its own detector worker) queue apart from reads; otherwise they share the reader queue. */
function enqueueScene<T>(vision: VisionRecognizer, job: () => Promise<T>): Promise<T> {
  if (!vision.separateDetector) return enqueue(job);
  pendingJobs++;
  const run = sceneChain.then(job, job).finally(() => { pendingJobs--; });
  sceneChain = run.catch(() => undefined);
  return run;
}
/** Whether recognition may keep a card crop for the training set. Set from the signed-in person's opt-in. */
let feedbackCapture = false;
export function setFeedbackCapture(on: boolean) { feedbackCapture = on; }

/**
 * Reads one card. The time limit starts when the job leaves the reader queue, so a board read ahead of it does not use it up.
 * A read that runs too long answers with the decklist instead of failing.
 */
export function readCard(track: MediaStreamTrack | null, point: { x: number; y: number }, priors: Priors, outer: AbortSignal, card?: ReadCard, frames?: HTMLCanvasElement[], own = false): Promise<ReadResult> {
  return enqueue(async () => {
    const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
    const signal = AbortSignal.any([outer, timeout]);
    try { return await readCardNow(track, point, priors, signal, card, frames, own); }
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
async function readCardNow(track: MediaStreamTrack | null, point: { x: number; y: number }, priors: Priors, signal: AbortSignal, card?: ReadCard, kept?: HTMLCanvasElement[], own = false): Promise<ReadResult> {
  const fallback = (note: string) => fallbackRead(priors, note);
  if (!track && !kept?.length && !(own && ownBuffer)) return fallback("No camera frame available. Showing cards from the decklist.");
  const vision = await loadRecognizer();
  const found = await loadMeta();
  if (!vision || !found) return fallback("Card reader data is not installed here. Showing cards from the decklist.");
  // The selected outline belongs to the first held frame. Keep that pair intact
  // and avoid another camera sampling window or detector pass for a desktop click.
  // The own feed keeps a native-resolution ring all the time, so a read of it never waits to sample the camera.
  const frames = kept?.length ? await Promise.all((card?kept.slice(0,1):kept).map(frame => createImageBitmap(frame)))
    : own && ownBuffer ? await ownFeedFrames().catch(() => track ? sampleFrames(track, signal) : [])
    : await sampleFrames(track!, signal);
  if (!frames.length) return fallback("The camera gave no frames. Showing cards from the decklist.");
  const byId = new Map(found.entries.map(entry => [entry.cardId, entry]));
  try {
    const result = await vision.recognize(frames, { clickPoint: point, k: 5, regionFallback: false, maxFrames:1, ...(card ? { card: toQuad(card) } : {}), includeCrop: true,deferAICrop:true, ...(feedbackCapture ? { includeFeedback: true } : {}), priors: priorsFor(found, priors) });
    signal.throwIfAborted();
    if (result.backend && result.timingsMs) reportBackend(result.backend, result.timingsMs.total); reportReaderRead(result.reader);
    const { toRemoteRecognitionResult } = await import("@yugidraft/vision") as unknown as { toRemoteRecognitionResult(result: RawResult, entries: ReadonlyMap<string, Meta["entries"][number]>, requestId: string): WireResult };
    const wire = toRemoteRecognitionResult(result, byId, "local");
    const guesses = wire.faceDown ? [] : result.candidates.flatMap(candidate => {
      const entry = byId.get(candidate.cardId);
      return entry ? [{ cardId: entry.passcode, name: entry.name, score: candidate.score }] : [];
    }).slice(0, 5);
    const read: ReadResult = { guesses, reader: "vision", frames: frames.length, note: kept?.length ? `Sharpest of ${frames.length} buffered ${frames.length === 1 ? "frame" : "frames"}` : `Sharpest of ${frames.length} frames`, sharpness: result.quality?.sharpness, tier: wire.tier, faceDown: wire.faceDown, covered: wire.covered, aiToken: result.cropJpeg ? keep(result) : undefined, visionTimingsMs: result.timingsMs, readerDiagnostics:result.reader, backend: result.backend };
    // Auto-detect reads an unsure card once more before it accepts it. A click does the same, and only when this read could pass.
    if (isBestMatch(read) && !result.quality?.fallback && !result.quality?.partial) {
      // The first read stands even when time runs out here: the person is asked, and no decklist fallback replaces it.
      read.agreed = await secondFrameAgrees(vision, result, point, priorsFor(found, priors), signal, card, kept, own);
    }
    return read;
  } catch (error) {
    if (signal.aborted) throw error;
    console.warn("[remote read] failed", error);
    if (reportGpuFailure(error)) return fallback("The GPU failed, so card recognition moved to the CPU. Try again.");
    return fallback("The card reader failed. Showing cards from the decklist.");
  } finally { for (const frame of frames) frame.close(); }
}

/** Reads one other frame. No other frame, an error, the end of the time limit or a different winner means no agreement, so the person is asked. */
async function secondFrameAgrees(vision: VisionRecognizer, first: RawResult, point: { x: number; y: number }, priors: RecognitionPriors, signal: AbortSignal, card?: ReadCard, kept?: HTMLCanvasElement[], own = false): Promise<boolean> {
  if (signal.aborted) return false;
  try {
    const used = card ? 0 : first.quality?.selectedFrameIndices?.[0] ?? 0;
    const canvas = kept?.[used === 0 ? 1 : 0];
    // The worker takes bitmaps it reads, so the frames of the first read are gone.
    const buffered = !canvas && own && ownBuffer ? await ownFeedFrames() : [];
    const frame = canvas ? await createImageBitmap(canvas) : buffered[0];
    for (const other of buffered.slice(1)) other.close();
    if (!frame) return false;
    try {
      const stopped = new Promise<null>(resolve => signal.addEventListener("abort", () => resolve(null), { once: true }));
      const again = await Promise.race([vision.recognize([frame], { clickPoint: point, k: 5, regionFallback: false, maxFrames: 1, ...(card ? { card: toQuad(card) } : {}), priors }), stopped]);
      if (!again) return false;
      // The same scores mean the same pixels (a low frame rate repeats frames): that is one read, not two.
      const repeated = again.candidates.slice(0, 2).every((candidate, index) => candidate.score === first.candidates[index]?.score);
      return !repeated && again.tier !== "low match" && again.candidates[0]?.cardId === first.candidates[0]?.cardId && !again.quality?.fallback && !again.quality?.partial && !again.quality?.covered;
    } finally { frame.close(); }
  } catch { return false; }
}

export type Detection = { status: "ready"; cards: DetectedQuad[]; ms: number } | { status: "unavailable" | "error"; cards: []; note: string };
/** Finds every card in one frame. The bitmap is consumed. Without the card reader installed this answers "unavailable". */
export async function detectCards(frame: ImageBitmap, opts?:import("@yugidraft/vision").DetectOptions): Promise<Detection> {
  const reader = await loadRecognizer();
  // A split reader's outline worker has its own queue (shared with the field watcher's passes).
  const queue = <T,>(job: () => Promise<T>) => reader ? enqueueScene(reader, job) : enqueue(job);
  return queue(async () => {
    const vision = await loadRecognizer(); const found = await loadMeta();
    if (!vision || !found) { frame.close(); return { status: "unavailable" as const, cards: [] as [], note: "The card reader is not installed here." }; }
    const start = performance.now();
    try {
      const cards = await vision.detectCards(frame,opts);
      return { status: "ready" as const, cards: cards.map(card => ({ ...card, refined: !card.partial })), ms: Math.round(performance.now() - start) };
    } catch (error) { return { status: "error" as const, cards: [] as [], note: error instanceof Error ? error.message : "The card detector failed." }; }
  });
}

/** Adapter for RemoteVideo: the feed owner supplies its own scoped knowledge; only image matches leave it. */
export function makeRecognizeRawFeed(resolveNames: (ids: number[]) => Promise<Map<number, string>>, getPriors: () => Priors = () => ({decklist:[],seen:[]})): RecognizeRawFeed {
  return async ({ track, request, signal }) => {
    const result = await readCard(track, { x: request.x, y: request.y }, getPriors(), signal, undefined, undefined, true);
    if (result.reader !== "vision") return {candidates:[],tier:"low match",faceDown:!!result.faceDown,covered:!!result.covered};
    const names = await resolveNames(result.guesses.filter(g => !g.name).map(g => g.cardId));
    const candidates = result.guesses.map(g => ({ cardId: g.cardId, name: g.name || names.get(g.cardId) || `Card ${g.cardId}`, score: g.score ?? 0 })).slice(0, 5);
    return { candidates, tier: result.tier ?? "low match", faceDown: !!result.faceDown, covered: !!result.covered };
  };
}

type OwnBuffer = { sample(options?:{maxAgeMs?:number}): Promise<{frame:ImageBitmap;at:number}>; snapshot(): Promise<ImageBitmap[]>; stop(): void };
let ownBuffer: OwnBuffer | null = null; let ownVideo: HTMLVideoElement | null = null;
/** Starts the always-on native-resolution frame ring on the own feed. One per page; clicks and remote reads take their frames from it. */
export function attachOwnFeed(video: HTMLVideoElement) {
  if (ownVideo === video) return;
  ownBuffer?.stop(); ownBuffer = null; ownVideo = video;
  void prepareOwnReader().catch(()=>undefined);
  void import("@yugidraft/vision").then(({ createOwnFeedBuffer }) => { if (ownVideo === video) ownBuffer = createOwnFeedBuffer(video) as OwnBuffer; }).catch(error => { console.warn("[remote field] own camera buffer failed", error); });
}

/** Shared by the table and its lobby preview; the resident worker warms once. */
export async function prepareOwnReader(priors?:Priors) {
  const [reader,found]=await Promise.all([loadRecognizer(),loadMeta()]);
  if(reader&&found){const info=await enqueue(()=>reader.prepare(priors?{priors:priorsFor(found,priors,false)}:undefined));if(info?.backend)reportBackend(info.backend);}
}
export function detachOwnFeed(video: HTMLVideoElement) {
  if (ownVideo !== video) return;
  ownBuffer?.stop(); ownBuffer = null; ownVideo = null; lastOwnSampleAt = undefined;
}
/** Clones of the buffered frames (up to 6, newest second). The caller closes them. */
export function ownFeedFrames(): Promise<ImageBitmap[]> {
  return ownBuffer ? ownBuffer.snapshot() : Promise.reject(new Error("The own feed is not buffered"));
}

let lastOwnSampleAt: number | undefined;
const OWN_SAMPLE_GAP_MS = 100;
/** Minimal shared-reader bridge for the owner-only field watcher. Manual reads take priority. */
export async function ownFieldResources(getPriors: () => Priors) {
  const [reader, found] = await Promise.all([loadRecognizer(), loadMeta()]);
  if (!reader || !found) return null;
  // A new watcher can sample immediately, without inheriting the previous watcher's pacing delay.
  lastOwnSampleAt = undefined;
  return {
    recognizer: {
      get detectorBackend() { return reader.detectorBackend; },
      get detectorTimingsMs() { return reader.detectorTimingsMs; },
      get separateDetector() { return reader.separateDetector; },
      prepare:(opts?:import("@yugidraft/vision").PrepareOptions)=>enqueue(()=>reader.prepare({priors:priorsFor(found,getPriors()),...opts})).then(info=>{if(info?.backend)reportBackend(info.backend);return info;}),
      detectCards: (frame: ImageBitmap | ImageData, opts?:import("@yugidraft/vision").DetectOptions) => enqueueScene(reader, () => reader.detectCards(frame as ImageBitmap,opts)),
      recognize: (frames: ImageBitmap[] | ImageData[], opts?: import("@yugidraft/vision").RecognizeOptions) => enqueue(() => reader.recognize(frames as ImageBitmap[], opts)).then(result => { if (result.backend && result.timingsMs) reportBackend(result.backend, result.timingsMs.total); reportReaderRead(result.reader); return result; }) as Promise<import("@yugidraft/vision").RecognitionResult>,
    },
    buffer: { sample: async (options?:{maxAgeMs?:number}) => {
      // While the sent video is CPU limited, wait between samples so real passes come at most every slow x 100 ms.
      // Each bitmap belongs to the watcher once returned: always sample a fresh one after the wait.
      const slow = visionPaceFactor();
      if (slow > 1 && lastOwnSampleAt !== undefined) {
        const remaining = slow * OWN_SAMPLE_GAP_MS - (Date.now() - lastOwnSampleAt);
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      }
      if (!ownBuffer) return Promise.reject(new Error("Waiting for the own camera buffer"));
      const sample = await ownBuffer.sample(options);
      lastOwnSampleAt = Date.now();
      return sample;
    } },
    getPriors: () => priorsFor(found, getPriors()),
    cpuBusy: () => pendingJobs > 0,
    entries: found.entries,
  };
}
