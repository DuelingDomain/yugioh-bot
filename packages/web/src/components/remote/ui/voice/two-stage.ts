import { interpret, type GrammarContext, type VoiceIntent } from "../grammar";
import { AudioInput, joinAudio, type AudioEnd } from "./audio-input";
import { ASR_BASE, KWS_BASE, type KwsClientOptions, type KwsUtterance } from "./kws-client";
import { VoiceMetrics } from "./metrics";
import { buildPhrases, type PhraseSet } from "./phrases";
import { heardPhaseOf, judgePhaseWord, VOICE_PHASES } from "./phase-plausibility";
import type { SentencePiece } from "./sentencepiece";
import { matchPhasePhrase } from "./speech-matcher";
import { SpeechWorker } from "./worker-client";

/** Recall-oriented starting point, to be selected by real-audio measurement rather than assumed optimal. */
export const GATE_PHRASE_OPTIONS = { phasesAndTurnsOnly: true, boost: 1.5, thresholdShift: -0.25 } as const;
export const buildGatePhrases = (sp: SentencePiece) => buildPhrases([], sp, GATE_PHRASE_OPTIONS);
type PhaseIntent = Extract<VoiceIntent, { kind: "phase" | "turn" }>;
export type Verification =
  | { stage1: "miss"; stage2: "skipped"; canonical: ""; intent: { kind: "none" }; reason: string }
  | { stage1: "hit"; stage2: "skipped"; canonical: ""; intent: { kind: "none" }; reason: string }
  | { stage1: "hit"; stage2: "confirmed"; canonical: string; intent: PhaseIntent; reason: string }
  | { stage1: "hit"; stage2: "rejected"; canonical: string; intent: { kind: "none" }; reason: string };

/** Public decision boundary: no hit means no decoder call; only a legal phase/turn confirmation can produce an action. */
export async function verifyKeywordHit(options: {
  utterance: KwsUtterance; phrases: PhraseSet; metrics: VoiceMetrics;
  decode(): Promise<{ text: string; busyMs: number; audioMs: number }>;
  context(): GrammarContext;
}): Promise<KwsUtterance & { verification: Verification }> {
  const { utterance: u, metrics } = options;
  const hits = u.hits.filter(hit => options.phrases.meanings.has(hit.keyword));
  metrics.hit(hits.length);
  if (!hits.length) return { ...u, verification: { stage1: "miss", stage2: "skipped", canonical: "", intent: { kind: "none" }, reason: "stage 1: no phase/turn keyword; stage 2 skipped" } };
  metrics.run();
  let decoded;
  try { decoded = await options.decode(); }
  catch (error) {
    metrics.verification(false);
    return { ...u, verification: { stage1: "hit", stage2: "rejected", canonical: "", intent: { kind: "none" }, reason: `stage 1: hit; stage 2 rejected: ${error instanceof Error ? error.message : String(error)}` } };
  }
  const canonical = matchPhasePhrase(decoded.text, u.speechMs);
  const context = options.context();
  const intent = canonical && context.state.turnSeat === context.me ? interpret(canonical, context) : { kind: "none" } as const;
  const confirmed = intent.kind === "phase" || intent.kind === "turn";
  metrics.verification(confirmed);
  let reason = "transcript is not a whole phase/turn phrase";
  if (canonical) {
    const phase = VOICE_PHASES.find(p => p === context.state.phase);
    const heard = heardPhaseOf(canonical);
    const verdict = phase && heard ? judgePhaseWord(phase, context.state.turn, context.state.turnSeat === context.me, heard) : null;
    reason = verdict && !verdict.accept ? verdict.reason : context.state.turnSeat !== context.me ? "not your turn" : "game state rejected the command (legal phase / pending action)";
  }
  const verification: Verification = confirmed
    ? { stage1: "hit", stage2: "confirmed", canonical, intent, reason: "stage 1: hit; stage 2 confirmed whole phrase and game-state legality" }
    : { stage1: "hit", stage2: "rejected", canonical, intent: { kind: "none" }, reason: `stage 1: hit; stage 2 rejected: ${reason}` };
  return { ...u, text: decoded.text, busyMs: u.busyMs + decoded.busyMs, verification };
}

export type TwoStageOptions = Omit<KwsClientOptions, "base" | "defaultKeywords" | "keywords" | "boost" | "threshold"> & {
  phrases: PhraseSet; context(): GrammarContext;
};

/** Owns both workers and utterance audio. Only AudioInput opens a microphone/worklet. */
export class TwoStageClient {
  readonly metrics = new VoiceMetrics();
  private readonly keyword: SpeechWorker;
  private verifier: SpeechWorker | undefined;
  private readonly input: AudioInput;
  private chunks: Float32Array[] = [];
  private queue = Promise.resolve();
  private queued = 0;
  private stopped = false;
  constructor(private readonly options: TwoStageOptions) {
    this.keyword = new SpeechWorker({ type: "init", base: KWS_BASE, defaultKeywords: options.phrases.lines.join("\n"), keywords: "", boost: 1.5, threshold: 0.25 }, {
      work: (busyMs, audioMs) => this.metrics.work({ stage: "stage1", busyMs, audioMs }), error: options.onError,
    });
    this.input = new AudioInput({ ...options,
      onFrames: samples => { this.chunks.push(samples); this.keyword.send({ type: "frames", samples }); },
      onReset: () => { this.chunks = []; this.keyword.send({ type: "reset" }); },
      onEnd: timing => {
        const samples = joinAudio(this.chunks); this.chunks = [];
        // KWS keeps streaming independently while the verifier is loading or decoding a previous hit.
        void this.keyword.end(timing.id).then(result => {
          if (this.stopped) return;
          const u = { ...result, ...timing };
          const hitCount = result.hits.filter(hit => options.phrases.meanings.has(hit.keyword)).length;
          if (!hitCount) {
            this.deliver({ ...u, verification: { stage1: "miss", stage2: "skipped", canonical: "", intent: { kind: "none" }, reason: "stage 1: no phase/turn keyword; stage 2 skipped" } }, timing); return;
          }
          if (++this.queued > 4) { this.queued--; this.metrics.hit(hitCount); this.metrics.queueDrop(); this.deliver({ ...u, verification: {
            stage1: "hit", stage2: "skipped", canonical: "", intent: { kind: "none" }, reason: "stage 1: hit; stage 2 skipped: verifier queue full; no action",
          } }, timing); return; }
          this.queue = this.queue.then(async () => {
            if (this.stopped) return;
            const verified = await verifyKeywordHit({ utterance: u, phrases: options.phrases, metrics: this.metrics,
              context: options.context, decode: () => this.decode(timing.id, samples) });
            this.deliver(verified, timing);
          }).catch(error => { if (!this.stopped) options.onError(String(error)); }).finally(() => { this.queued--; });
        }).catch(() => {});
      },
    });
  }
  private async decode(id: number, samples: Float32Array) {
    if (!this.verifier) {
      this.verifier = new SpeechWorker({ type: "init", base: ASR_BASE, defaultKeywords: "", keywords: "", boost: 0, threshold: 0 }, {
        work: (busyMs, audioMs) => this.metrics.work({ stage: "stage2", busyMs, audioMs }), error: this.options.onError,
      });
      const info = await this.verifier.start();
      this.metrics.load("stage2", info);
    }
    const result = await this.verifier.decode(id, samples);
    if (!("text" in result)) throw new Error("Speech worker returned no transcript");
    return result;
  }
  private deliver(u: KwsUtterance, timing: AudioEnd) {
    if (this.stopped) return;
    const decisionMs = timing.tailMs + performance.now() - timing.submittedAt;
    this.metrics.decision(decisionMs); this.options.onUtterance({ ...u, decisionMs });
  }
  async start() {
    const ready = await this.keyword.start(); if (this.stopped) return;
    this.metrics.load("stage1", ready); await this.input.start(); if (this.stopped) return;
    this.metrics.start(); this.options.onReady(ready);
  }
  /** Vocabulary is fixed for the lifetime of this comparison method. */
  setKeywords() {}
  pushPcm(samples: Float32Array) { return this.input.pushPcm(samples); }
  resetPcm() { this.input.resetPcm(); }
  stop() { this.stopped = true; this.input.stop(); this.keyword.stop(); this.verifier?.stop(); this.chunks = []; this.metrics.stop(); }
}
