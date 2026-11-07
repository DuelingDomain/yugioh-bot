"use client";

import type { KwsHit } from "./kws-glue";
import type { KwsWorkerIn, KwsWorkerOut } from "./kws-worker";

/** Where prepare.mts puts the module, the model and the worker; served by /dev/vision-assets. */
export const KWS_BASE = "/dev/vision-assets/kws/";

export type KwsUtterance = { id: number; hits: KwsHit[]; speechMs: number; busyMs: number; audioMs: number };
export type KwsReady = { fetchMs: number; initMs: number; totalMs: number; bytes: number; heapBytes: number; accepted: boolean };
export type KwsClientOptions = {
  base?: string;
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

// Same mic tap and speech gate as use-voice.ts: 20 ms frames at 16 kHz, a short preroll, an end after about 0.56 s of quiet.
const WORKLET = `class T extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('pcm-tap',T)`;
const FRAME = 320; const PREROLL = 15; const START_FRAMES = 3; const END_FRAMES = 28; const MIN_SPEECH = 8; const MAX_FRAMES = 700;

/** Mic -> worker. The worker only hears audio while the energy gate is open (plus preroll), so a silent player costs little. Audio stays in the page. */
export class KwsClient {
  private worker: Worker | null = null;
  private stream: MediaStream | undefined;
  private context: AudioContext | undefined;
  private disposed = false;
  private serial = 0;
  private readonly started = performance.now();
  private spoken = new Map<number, number>();
  constructor(private readonly options: KwsClientOptions) {}

  private send(message: KwsWorkerIn, transfer: Transferable[] = []) { this.worker?.postMessage(message, transfer); }

  async start(): Promise<void> {
    const o = this.options; const base = o.base ?? KWS_BASE;
    const worker = new Worker(`${base}worker.js`, { type: "module" });
    this.worker = worker;
    worker.onerror = event => o.onError(event.message || "Speech worker failed");
    worker.onmessage = (event: MessageEvent<KwsWorkerOut>) => {
      const m = event.data;
      if (m.type === "ready") o.onReady({ fetchMs: m.fetchMs, initMs: m.initMs, totalMs: performance.now() - this.started, bytes: m.bytes, heapBytes: m.heapBytes, accepted: m.accepted });
      else if (m.type === "keywords") o.onKeywords?.(m.accepted);
      else if (m.type === "utterance") { const speechMs = this.spoken.get(m.id) ?? 0; this.spoken.delete(m.id); o.onUtterance({ id: m.id, hits: m.hits, speechMs, busyMs: m.busyMs, audioMs: m.audioMs }); }
      else if (m.type === "error") o.onError(m.message);
    };
    this.send({ type: "init", base, defaultKeywords: o.defaultKeywords, keywords: o.keywords, boost: o.boost, threshold: o.threshold });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.disposed) { this.stream.getTracks().forEach(track => track.stop()); return; }
      const context = this.context = new AudioContext();
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      const source = context.createMediaStreamSource(this.stream);
      const node = new AudioWorkletNode(context, "pcm-tap");
      const mute = context.createGain(); mute.gain.value = 0; source.connect(node); node.connect(mute).connect(context.destination);
      this.tap(node, context.sampleRate / 16000);
    } catch (error) { o.onError((error as Error).message || "Microphone unavailable"); }
  }

  /** New phrase list (a different deck, or new boost and threshold values). */
  setKeywords(keywords: string) { this.send({ type: "keywords", keywords }); }

  private tap(node: AudioWorkletNode, ratio: number) {
    let position = 0; let last = 0; const samples: number[] = [];
    let noise = 0.01; let loud = 0; let quiet = 0; let inSpeech = false; let spoken = 0; let total = 0; let lastLevelAt = 0;
    const preroll: Float32Array[] = [];
    const frame = (pcm: Float32Array) => {
      let sum = 0; for (const value of pcm) sum += value * value;
      const rms = Math.sqrt(sum / pcm.length);
      const now = performance.now();
      if (now - lastLevelAt > 60) { lastLevelAt = now; this.options.onLevel?.(Math.min(1, rms * 8), inSpeech); }
      if (!inSpeech) {
        noise = Math.min(0.05, noise * 0.995 + rms * 0.005);
        loud = rms > Math.max(0.018, noise * 3.2) ? loud + 1 : 0;
        preroll.push(pcm); if (preroll.length > PREROLL) preroll.shift();
        if (loud >= START_FRAMES) {
          inSpeech = true; spoken = START_FRAMES; total = preroll.length; quiet = 0; loud = 0;
          for (const old of preroll.splice(0)) this.send({ type: "frames", samples: old }, [old.buffer]);
        }
        return;
      }
      this.send({ type: "frames", samples: pcm }, [pcm.buffer]); total++;
      if (rms > Math.max(0.018, noise * 2.4)) { spoken++; quiet = 0; } else quiet++;
      if (quiet >= END_FRAMES || total >= MAX_FRAMES) {
        inSpeech = false;
        if (spoken < MIN_SPEECH) this.send({ type: "reset" });
        else { const id = ++this.serial; this.spoken.set(id, spoken * 20); this.send({ type: "end", id }); }
        spoken = 0; total = 0; quiet = 0; loud = 0;
      }
    };
    node.port.onmessage = event => {
      const input = event.data as Float32Array;
      for (const value of input) {
        while (position < 1) { samples.push(last + (value - last) * position); position += ratio; }
        position -= 1; last = value;
      }
      while (samples.length >= FRAME) frame(Float32Array.from(samples.splice(0, FRAME)));
    };
  }

  stop() {
    this.disposed = true;
    this.stream?.getTracks().forEach(track => track.stop());
    void this.context?.close();
    this.worker?.terminate(); this.worker = null;
  }
}
