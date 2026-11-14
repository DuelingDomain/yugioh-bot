"use client";

import { resumeAudioContext } from "./audio-resume";
import type { KwsStatus } from "./kws-client";

export type AudioEnd = { id: number; speechMs: number; startedAt: number; endedAt: number; submittedAt: number; tailMs: number };
export type AudioInputOptions = {
  pcmInput?: boolean; deviceId?: string;
  onStatus?(status: KwsStatus): void;
  onLevel?(level: number, speaking: boolean): void;
  onFrames(samples: Float32Array): void;
  onEnd(end: AudioEnd): void;
  onReset(): void;
  onError(message: string): void;
};

// 20 ms frames at 16 kHz. Keep short commands together across pauses up to 0.9 s (previously 0.56 s).
const WORKLET = `class T extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('pcm-tap',T)`;
const FRAME = 320; const PREROLL = 15; const START_FRAMES = 3; const END_FRAMES = 45; const MIN_SPEECH = 8; const MAX_FRAMES = 700;

/** One microphone/worklet and one gate, shared by all three listening methods. */
export class AudioInput {
  private stream: MediaStream | undefined;
  private context: AudioContext | undefined;
  private disposed = false;
  private frames = 0;
  private lastFrameAt = performance.now();
  private statusTimer: ReturnType<typeof setInterval> | undefined;
  private serial = 0;
  private inputPcm: ((samples: Float32Array) => void) | undefined;
  constructor(private readonly options: AudioInputOptions) {}
  async start() {
    const o = this.options;
    if (o.pcmInput) { this.inputPcm = this.tap(1); return; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(o.deviceId ? { deviceId: { ideal: o.deviceId } } : {}) } });
      if (this.disposed) { this.stream.getTracks().forEach(track => track.stop()); return; }
      const context = this.context = new AudioContext();
      context.addEventListener("statechange", () => this.report());
      await resumeAudioContext(context);
      if (this.disposed) return;
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      if (this.disposed) return;
      const source = context.createMediaStreamSource(this.stream);
      const node = new AudioWorkletNode(context, "pcm-tap");
      const mute = context.createGain(); mute.gain.value = 0; source.connect(node); node.connect(mute).connect(context.destination);
      this.inputPcm = this.tap(context.sampleRate / 16000);
      node.port.onmessage = event => this.inputPcm?.(event.data);
      this.lastFrameAt = performance.now(); this.frames = 0;
      let counted = 0; let countedAt = performance.now(); this.fps = 0;
      this.statusTimer = setInterval(() => {
        const now = performance.now();
        this.fps = (this.frames - counted) / Math.max(0.001, (now - countedAt) / 1000); counted = this.frames; countedAt = now;
        this.report();
      }, 500);
    } catch (error) { o.onError(error instanceof Error ? error.message : "Microphone unavailable"); throw error; }
  }

  private fps = 0;
  private report() {
    const track = this.stream?.getAudioTracks()[0]; const context = this.context;
    if (!track || !context || this.disposed) return;
    this.options.onStatus?.({ micName: track.label || "default microphone", contextState: context.state, sampleRate: context.sampleRate, muted: track.muted, enabled: track.enabled,
      framesPerSecond: this.fps, silentMs: performance.now() - this.lastFrameAt });
  }

  pushPcm(samples: Float32Array): number {
    if (!this.options.pcmInput || this.disposed) throw new Error("PCM input is not active");
    this.inputPcm?.(samples); return this.serial;
  }
  resetPcm() {
    if (!this.options.pcmInput || this.disposed) throw new Error("PCM input is not active");
    this.inputPcm = this.tap(1); this.options.onReset();
  }
  private tap(ratio: number) {
    let position = 0; let last = 0; const samples: number[] = [];
    let noise = 0.01; let loud = 0; let quiet = 0; let inSpeech = false; let spoken = 0; let total = 0; let lastLevelAt = 0;
    let startedAt = 0; let endedAt = 0;
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
          startedAt = (this.frames - START_FRAMES) * 20; endedAt = this.frames * 20;
          for (const old of preroll.splice(0)) this.options.onFrames(old);
        }
        return;
      }
      this.options.onFrames(pcm); total++;
      if (rms > Math.max(0.018, noise * 2.4)) { spoken++; quiet = 0; endedAt = this.frames * 20; } else quiet++;
      if (quiet >= END_FRAMES || total >= MAX_FRAMES) {
        inSpeech = false;
        if (spoken < MIN_SPEECH) this.options.onReset();
        else this.options.onEnd({ id: ++this.serial, speechMs: spoken * 20, startedAt, endedAt, submittedAt: performance.now(), tailMs: this.frames * 20 - endedAt });
        spoken = 0; total = 0; quiet = 0; loud = 0;
      }
    };
    return (input: Float32Array) => {
      for (const value of input) {
        while (position < 1) { samples.push(last + (value - last) * position); position += ratio; }
        position -= 1; last = value;
      }
      this.lastFrameAt = performance.now();
      while (samples.length >= FRAME) { this.frames++; frame(Float32Array.from(samples.splice(0, FRAME))); }
    };
  }

  stop() {
    this.disposed = true; clearInterval(this.statusTimer);
    this.stream?.getTracks().forEach(track => track.stop());
    void this.context?.close();
  }
}

export function joinAudio(chunks: readonly Float32Array[]) {
  const samples = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0; for (const chunk of chunks) { samples.set(chunk, at); at += chunk.length; }
  return samples;
}
