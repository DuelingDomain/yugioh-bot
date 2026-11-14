"use client";

import type { KwsHit } from "./kws-glue";
import { AudioInput, joinAudio, type AudioEnd } from "./audio-input";
import { SpeechWorker, type WorkerUtterance } from "./worker-client";
import { VoiceMetrics } from "./metrics";
import type { Verification } from "./two-stage";

export const KWS_BASE = "/dev/vision-assets/kws/";
export const ASR_BASE = "/dev/vision-assets/asr/";

/** `text` and `passes` come from the speech model worker only. */
export type KwsUtterance = { id: number; hits: KwsHit[]; speechMs: number; busyMs: number; audioMs: number; text?: string; passes?: number; startedAt?: number; endedAt?: number; decisionMs?: number; verification?: Verification };
export type KwsReady = { fetchMs: number; initMs: number; totalMs: number; bytes: number; heapBytes: number; accepted: boolean };
/** What the mic path is doing right now, so a silent mic can be told apart from a suspended context or a muted track. */
export type KwsStatus = { micName: string; contextState: AudioContextState; sampleRate: number; muted: boolean; enabled: boolean; framesPerSecond: number; silentMs: number };
export type KwsClientOptions = {
  base?: string;
  /** Replay only: the caller supplies 16 kHz mono PCM instead of opening a microphone. */
  pcmInput?: boolean;
  /** Preferred microphone (a missing one falls back to the default). */
  deviceId?: string;
  onStatus?(status: KwsStatus): void;
  defaultKeywords: string;
  keywords: string;
  boost: number;
  threshold: number;
  onReady(info: KwsReady): void;
  onUtterance(utterance: KwsUtterance): void;
  onLevel?(level: number, speaking: boolean): void;
  onKeywords?(accepted: boolean): void;
  onError(message: string): void;
};

/** Single-stage listener. Capture and gating are also used by the two-stage coordinator. */
export class KwsClient {
  readonly metrics = new VoiceMetrics();
  private readonly worker: SpeechWorker;
  private readonly input: AudioInput;
  private disposed = false;
  private chunks: Float32Array[] = [];
  private queue = Promise.resolve();
  constructor(private readonly options: KwsClientOptions) {
    const stage = options.base === ASR_BASE ? "stage2" : "stage1";
    this.worker = new SpeechWorker({ type: "init", base: options.base ?? KWS_BASE, defaultKeywords: options.defaultKeywords,
      keywords: options.keywords, boost: options.boost, threshold: options.threshold }, {
      work: (busyMs, audioMs) => this.metrics.work({ stage, busyMs, audioMs }), keywords: options.onKeywords, error: options.onError,
    });
    this.input = new AudioInput({ ...options,
      onFrames: samples => { if (stage === "stage1") this.worker.send({ type: "frames", samples }); else this.chunks.push(samples); },
      onReset: () => { this.chunks = []; if (stage === "stage1") this.worker.send({ type: "reset" }); },
      onEnd: timing => {
        if (stage === "stage1") void this.worker.end(timing.id).then(result => this.deliver(result, timing)).catch(() => {});
        else {
          const samples = joinAudio(this.chunks); this.chunks = [];
          this.queue = this.queue.then(async () => { if (!this.disposed) { this.metrics.run(); this.deliver(await this.worker.decode(timing.id, samples), timing); } }).catch(error => { if (!this.disposed) options.onError(String(error)); });
        }
      },
    });
  }
  async start() {
    const info = await this.worker.start();
    if (this.disposed) return;
    this.metrics.load(this.options.base === ASR_BASE ? "stage2" : "stage1", info);
    await this.input.start(); if (this.disposed) return;
    this.metrics.start(); this.options.onReady(info);
  }
  private deliver(result: WorkerUtterance, timing: AudioEnd) {
    if (this.disposed) return;
    const decisionMs = timing.tailMs + performance.now() - timing.submittedAt;
    this.metrics.decision(decisionMs);
    if (this.options.base !== ASR_BASE) this.metrics.hit(result.hits.filter(hit => hit.keyword !== "_").length);
    this.options.onUtterance({ ...result, ...timing, decisionMs });
  }
  setKeywords(keywords: string) { this.worker.send({ type: "keywords", keywords }); }
  pushPcm(samples: Float32Array) { return this.input.pushPcm(samples); }
  resetPcm() { this.input.resetPcm(); }
  stop() { this.disposed = true; this.input.stop(); this.worker.stop(); this.chunks = []; this.metrics.stop(); }
}
