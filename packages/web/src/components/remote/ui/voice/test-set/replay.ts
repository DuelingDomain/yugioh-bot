import { ygoModule } from "@yugidraft/shared/remote";
import { interpret } from "../../grammar";
import { ASR_BASE, KWS_BASE, KwsClient, type KwsReady, type KwsUtterance } from "../kws-client";
import { createSentencePiece } from "../sentencepiece";
import vocab from "../sp-vocab.json";
import { buildPhrases, combineHits, isChatter, type Combined } from "../phrases";
import { buildMatcher, DEFAULTS } from "../speech-matcher";
import { SAMPLE_RATE, type ClipResult, type Method, type Observation, type Prompt, type TestSet } from "./model";
import { score } from "./scoring";
import { buildGatePhrases, GATE_PHRASE_OPTIONS, TwoStageClient } from "../two-stage";
import { cpuShare, type MetricsSnapshot } from "../metrics";

export const METHODS = { asr: "Speech model (Moonshine Tiny q8)", kws: "Keywords (sherpa-onnx)", "two-stage": "Keyword gate + verify" };
export const METHOD_IDS = ["asr", "kws", "two-stage"] as const;
const sp = createSentencePiece(vocab);

export async function checkAssets(method: Method, signal?: AbortSignal): Promise<string | null> {
  if (method === "two-stage") return await checkAssets("kws", signal) ?? await checkAssets("asr", signal);
  const base = method === "asr" ? ASR_BASE : KWS_BASE;
  const files = method === "asr" ? ["worker.js", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm", "model/encoder_model_quantized.onnx", "model/decoder_model_merged_quantized.onnx", "model/vocab.json"]
    : ["worker.js", "sherpa-kws.js", "sherpa-kws.wasm", "model/tokens.txt", ...["encoder", "decoder", "joiner"].map(name => `model/${name}-epoch-12-avg-2-chunk-16-left-64.int8.onnx`)];
  for (const file of files) {
    const response = await fetch(base + file, { method: "HEAD", signal });
    if (!response.ok) return `assets missing: ${base}${file} (HTTP ${response.status}). Nothing was installed.`;
  }
  return null;
}

export function decideUtterance(u: KwsUtterance, method: Method, prompt: Prompt, phrases: ReturnType<typeof buildPhrases>, matcher: ReturnType<typeof buildMatcher>): Observation {
  if (method === "two-stage") {
    const v = u.verification;
    return { intent: v?.intent.kind === "phase" ? `phase:${v.intent.phase}` : v?.intent.kind === "turn" ? "turn" : "none",
      canonical: v?.canonical ?? "", heard: u.text ?? combineHits(u.hits, phrases.meanings).heard.join(" + "), note: v?.reason ?? "stage 2: no confirmation; no action",
      busyMs: u.busyMs, audioMs: u.audioMs, speechMs: u.speechMs, decisionMs: u.decisionMs };
  }
  let combined: Combined;
  if (method === "asr" && u.text !== undefined) {
    if (u.startedAt === undefined || u.endedAt === undefined) matcher.resetUtterances();
    const match = u.startedAt !== undefined && u.endedAt !== undefined
      ? matcher.matchUtterance({ text: u.text, speechMs: u.speechMs, startedAt: u.startedAt, endedAt: u.endedAt })
      : matcher.match(u.text, u.speechMs);
    combined = { canonical: match.canonical, tags: [], heard: [u.text], ambiguous: match.ambiguous.map(names => ({ spoken: match.spoken ?? "", names })) };
  } else combined = combineHits(u.hits.filter(hit => hit.keyword !== "_"), phrases.meanings);
  let intent = "none";
  if (combined.canonical && prompt.sim.mine && !(method === "kws" && isChatter(combined, phrases.meanings, u.speechMs))) {
    const sim = prompt.sim;
    const state = { ...ygoModule.initialState({ seatCount: 2 }), phase: sim.phase, turn: sim.turn, turnSeat: sim.mine ? 0 : 1 };
    const parsed = interpret(combined.canonical, { state, players: [{ seat: 0, displayName: "Me" }, { seat: 1, displayName: "Opponent" }], me: 0, trayOpen: false, cardNames: [] });
    intent = parsed.kind === "phase" ? `phase:${parsed.phase}` : parsed.kind === "name" ? "none" : parsed.kind;
  }
  return { intent, heard: method === "asr" ? u.text ?? "" : combined.heard.join(" + "), canonical: combined.canonical, busyMs: u.busyMs, audioMs: u.audioMs, speechMs: u.speechMs, decisionMs: u.decisionMs };
}

export type RunResult = Awaited<ReturnType<typeof replay>>;

/** Offline audio uses the live client's exact 20 ms energy gate, then the existing bundled worker and matcher. */
export async function replay(set: TestSet, method: Method, signal: AbortSignal, progress: (done: number, total: number) => void) {
  const missing = await checkAssets(method, signal); if (missing) throw new Error(missing);
  signal.throwIfAborted();
  const phrases = buildGatePhrases(sp);
  let matcher = buildMatcher([], { phasesAndTurnsOnly: true });

  let load: KwsReady | undefined;
  let rejectPending: ((reason: Error) => void) | undefined;
  let receiver: ((u: KwsUtterance) => void) | undefined;
  let failure: Error | undefined;
  const fail = (error: Error) => { failure = error; rejectPending?.(error); rejectPending = undefined; };
  let currentPrompt: Prompt | undefined;
  const options = { pcmInput: true,
    onReady: (info: KwsReady) => { load = info; }, onError: (message: string) => fail(new Error(message)),
    onUtterance: (u: KwsUtterance) => { try { receiver?.(u); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); } } };
  const client = method === "two-stage" ? new TwoStageClient({ ...options, phrases, context: () => {
    if (!currentPrompt) throw new Error("Clip has no label");
    const sim = currentPrompt.sim;
    return { state: { ...ygoModule.initialState({ seatCount: 2 }), phase: sim.phase, turn: sim.turn, turnSeat: sim.mine ? 0 : 1 },
      players: [{ seat: 0, displayName: "Me" }, { seat: 1, displayName: "Opponent" }], me: 0, trayOpen: false, cardNames: [] };
  } }) : new KwsClient({ ...options, base: method === "asr" ? ASR_BASE : KWS_BASE,
    defaultKeywords: phrases.lines.join("\n"), keywords: "", boost: 1.5, threshold: 0.25 });
  const abort = () => { fail(new DOMException("Replay cancelled", "AbortError")); client.stop(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await client.start();
    if (!load) throw failure ?? new Error("Listener stopped before initialization");
    if (!load.accepted) throw new Error("Worker rejected the phrase list");
    const started = performance.now(); const clips: ClipResult[] = [];
    for (const clip of set.clips) {
      signal.throwIfAborted(); if (failure) throw failure;
      const prompt = set.prompts.find(p => p.id === clip.promptId); if (!prompt) throw new Error("Clip has no label");
      currentPrompt = prompt;
      client.metrics.setIdle(prompt.category !== "command");
      client.resetPcm();
      matcher = buildMatcher([], { phasesAndTurnsOnly: true });
      const observations: Observation[] = [];
      // Reset label state for every utterance: a false turn must not hide all later chatter activations.
      const observe = (u: KwsUtterance) => {
        const observation = decideUtterance(u, method, prompt, phrases, matcher);
        if (method === "asr") client.metrics.verification(observation.intent !== "none");
        observations.push(observation);
      };
      receiver = observe;
      const padded = new Float32Array(clip.pcm.length + SAMPLE_RATE); padded.set(clip.pcm);
      let serial = client.pushPcm(new Float32Array(0));
      for (let at = 0; at < padded.length; at += 320) {
        if (failure) throw failure; signal.throwIfAborted();
        const next = client.pushPcm(padded.slice(at, at + 320));
        if (next !== serial) {
          serial = next;
          // Worker messages cannot arrive until this synchronous PCM push yields.
          const pending = new Promise<void>((resolve, reject) => {
            rejectPending = reject;
            receiver = u => { observe(u); resolve(); };
          });
          const waitMs = method === "two-stage" && !client.metrics.snapshot().stage2.load ? 180000 : 60000;
          const timer = setTimeout(() => fail(new Error("Worker utterance timed out")), waitMs);
          try { await pending; } finally { clearTimeout(timer); rejectPending = undefined; }
        }
        // Let Cancel and progress render while feeding a long chatter recording.
        if (at % 32000 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      clips.push({ promptId: clip.promptId, durationMs: clip.pcm.length / 16, observations }); progress(clips.length, set.clips.length);
    }
    signal.throwIfAborted(); if (failure) throw failure;
    client.metrics.setIdle(false);
    const measurements: MetricsSnapshot = client.metrics.snapshot();
    const recordedMs = clips.reduce((sum, clip) => sum + clip.durationMs, 0);
    const idleRecordedMs = clips.reduce((sum, clip) => sum + (set.prompts.find(p => p.id === clip.promptId)?.category !== "command" ? clip.durationMs : 0), 0);
    return { measurements, recordedAudioCpu: { stage1: cpuShare(measurements.stage1.busyMs, recordedMs), stage2: cpuShare(measurements.stage2.busyMs, recordedMs) },
      idleRecordedAudioCpu: { stage1: cpuShare(measurements.stage1.idleBusyMs, idleRecordedMs), stage2: cpuShare(measurements.stage2.idleBusyMs, idleRecordedMs) }, method, corpusId: set.id, revision: set.revision, recordedClips: set.clips.length, totalPrompts: set.prompts.length,
      completedAt: new Date().toISOString(), elapsedMs: performance.now() - started, load,
      settings: { phraseOptions: GATE_PHRASE_OPTIONS, matcher: { ...DEFAULTS, phasesAndTurnsOnly: true }, cards: [], workerBoost: 1.5, workerThreshold: 0.25, statePolicy: "label state reset per utterance", gate: "KwsClient 16 kHz / 20 ms", vocabulary: "phases and turns only", keywordLines: phrases.lines, latency: "gate tail in audio time + elapsed wall time after submission; accelerated replay, not real-time microphone latency", cpu: "worker elapsed work / actual replay wall time (excludes initial model load)", idle: "near-miss and chatter clips; accelerated replay wall time", stage2Load: method === "two-stage" ? "lazy on first hit" : method === "asr" ? "at listener start" : "not used" },
      scores: score(set.prompts, clips) };
  } finally { signal.removeEventListener("abort", abort); client.stop(); }
}
