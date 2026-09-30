import type { DuelEventKind, DuelFxCue } from "./event-queue";

type Voice = {
  osc: AudioScheduledSourceNode;
  gain: GainNode;
};

/** An engine event kind, or a moment SummonFx reports (hologram rise, slam, shatter). */
export type DuelSoundCue = DuelEventKind | DuelFxCue;

export interface DuelFeedbackAudio {
  unlock: () => Promise<boolean>;
  setMuted: (muted: boolean) => void;
  /** `strength` (about 0.8 to 1.25) scales the slam and shatter cues; other cues ignore it. */
  play: (kind: DuelSoundCue, strength?: number) => void;
  stopAll: () => void;
  dispose: () => void;
}

export function createDuelFeedbackAudio(): DuelFeedbackAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let unlocked = false;
  let muted = true;
  const voices: Voice[] = [];

  function dropVoice(voice: Voice): void {
    const index = voices.indexOf(voice);
    if (index >= 0) voices.splice(index, 1);
  }

  function stopAll(): void {
    const now = ctx?.currentTime ?? 0;
    for (const voice of voices.splice(0)) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(0, now);
        voice.osc.stop(now);
      } catch {
        // already stopped
      }
    }
  }

  function ensureGraph(): AudioContext | null {
    if (ctx) return ctx;
    if (typeof window === "undefined") return null;
    const w = window as Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    return ctx;
  }

  async function unlock(): Promise<boolean> {
    const audio = ensureGraph();
    if (!audio) return false;
    if (audio.state === "suspended") {
      try {
        await audio.resume();
      } catch {
        return false;
      }
    }
    unlocked = audio.state === "running";
    return unlocked;
  }

  function setMuted(next: boolean): void {
    muted = next;
    if (master && ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(next ? 0 : 1, ctx.currentTime);
    }
    if (next) stopAll();
  }

  function tone(
    audio: AudioContext,
    dest: GainNode,
    opts: {
      freq: number;
      freqEnd?: number;
      type: OscillatorType;
      start: number;
      duration: number;
      peak: number;
      attack?: number;
    },
  ): void {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const attack = opts.attack ?? 0.012;
    const t = opts.start;
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd, 1), t + opts.duration);
    }
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(opts.peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);
    osc.connect(gain);
    gain.connect(dest);
    const voice: Voice = { osc, gain };
    voices.push(voice);
    osc.onended = () => dropVoice(voice);
    osc.start(t);
    osc.stop(t + opts.duration + 0.02);
  }

  let noise: AudioBuffer | null = null;

  /** A short burst of filtered noise: the body of a slam or a shattering card. */
  function burst(
    audio: AudioContext,
    dest: GainNode,
    opts: { start: number; duration: number; peak: number; filter: BiquadFilterType; freq: number; freqEnd?: number },
  ): void {
    if (!noise) {
      noise = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.5), audio.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    const src = audio.createBufferSource();
    src.buffer = noise;
    const filter = audio.createBiquadFilter();
    filter.type = opts.filter;
    filter.frequency.setValueAtTime(opts.freq, opts.start);
    if (opts.freqEnd != null) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd, 20), opts.start + opts.duration);
    }
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0, opts.start);
    gain.gain.linearRampToValueAtTime(opts.peak, opts.start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    const voice: Voice = { osc: src, gain };
    voices.push(voice);
    src.onended = () => dropVoice(voice);
    src.start(opts.start);
    src.stop(opts.start + opts.duration + 0.02);
  }

  function play(kind: DuelSoundCue, strength = 1): void {
    if (!unlocked || muted) return;
    const audio = ctx;
    const dest = master;
    if (!audio || !dest || audio.state !== "running") return;
    const t = audio.currentTime;

    switch (kind) {
      case "summon":
        tone(audio, dest, { freq: 392, type: "triangle", start: t, duration: 0.14, peak: 0.045 });
        tone(audio, dest, { freq: 523.25, type: "sine", start: t + 0.05, duration: 0.16, peak: 0.035 });
        break;
      case "set":
        tone(audio, dest, { freq: 196, type: "triangle", start: t, duration: 0.1, peak: 0.028 });
        break;
      case "activate":
        tone(audio, dest, { freq: 659.25, type: "sine", start: t, duration: 0.18, peak: 0.04 });
        tone(audio, dest, { freq: 987.77, type: "sine", start: t + 0.04, duration: 0.14, peak: 0.022 });
        break;
      case "chain-resolving":
        tone(audio, dest, { freq: 784, type: "triangle", start: t, duration: 0.07, peak: 0.03, attack: 0.006 });
        break;
      case "chain-resolved":
        tone(audio, dest, { freq: 523.25, type: "sine", start: t, duration: 0.1, peak: 0.032 });
        tone(audio, dest, { freq: 659.25, type: "sine", start: t + 0.06, duration: 0.14, peak: 0.028 });
        break;
      case "chain-negated":
        tone(audio, dest, {
          freq: 415,
          freqEnd: 233,
          type: "sine",
          start: t,
          duration: 0.16,
          peak: 0.034,
        });
        break;
      case "chain-end":
        tone(audio, dest, { freq: 174.61, type: "sine", start: t, duration: 0.16, peak: 0.026 });
        break;
      case "attack":
        tone(audio, dest, { freq: 98, type: "sine", start: t, duration: 0.12, peak: 0.05, attack: 0.004 });
        tone(audio, dest, { freq: 196, type: "triangle", start: t + 0.02, duration: 0.08, peak: 0.02 });
        break;
      case "phase":
        tone(audio, dest, { freq: 329.63, type: "sine", start: t, duration: 0.16, peak: 0.03 });
        tone(audio, dest, { freq: 493.88, type: "triangle", start: t + 0.06, duration: 0.18, peak: 0.018 });
        break;
      case "holo":
        // A soft rising shimmer while the projection lifts.
        tone(audio, dest, { freq: 220, freqEnd: 740, type: "sine", start: t, duration: 0.34, peak: 0.02, attack: 0.05 });
        tone(audio, dest, { freq: 1318.5, freqEnd: 1760, type: "triangle", start: t + 0.12, duration: 0.24, peak: 0.008, attack: 0.06 });
        break;
      case "slam":
        // Weight: a low drop plus a short muffled knock.
        tone(audio, dest, { freq: 118, freqEnd: 36, type: "sine", start: t, duration: 0.34, peak: 0.16 * strength, attack: 0.004 });
        burst(audio, dest, { start: t, duration: 0.14, peak: 0.07 * strength, filter: "lowpass", freq: 900, freqEnd: 180 });
        break;
      case "shatter":
      case "destroy":
        burst(audio, dest, { start: t, duration: 0.2, peak: 0.05, filter: "highpass", freq: 2200, freqEnd: 5200 });
        tone(audio, dest, { freq: 880, freqEnd: 260, type: "triangle", start: t, duration: 0.16, peak: 0.02, attack: 0.003 });
        break;
      default:
        break;
    }
  }

  function dispose(): void {
    stopAll();
    unlocked = false;
    const audio = ctx;
    ctx = null;
    master = null;
    if (audio) {
      void audio.close().catch(() => undefined);
    }
  }

  return { unlock, setMuted, play, stopAll, dispose };
}
