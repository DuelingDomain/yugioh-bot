import { scheduleBattleSound, shatter, type BattleSoundPlan, type BurstOpts, type Synth, type ToneOpts } from "./attack-audio";
import type { DuelEventKind, DuelFxCue } from "./event-queue";

type Voice = {
  osc: AudioScheduledSourceNode;
  gain: GainNode;
  /** Every node the voice made (filters, sends, the vibrato LFO): disconnected when it ends. */
  nodes: AudioNode[];
};

/** A stopped voice fades out over about this long instead of cutting (a cut clicks). */
const FADE_OUT_S = 0.012;

/** An engine event kind, or a moment SummonFx reports (hologram rise, slam, shatter). */
export type DuelSoundCue = DuelEventKind | DuelFxCue;

export interface DuelFeedbackAudio {
  unlock: () => Promise<boolean>;
  setMuted: (muted: boolean) => void;
  /** Master level 0..1, eased in so a slider drag does not click. Applies while unmuted. */
  setVolume: (volume: number) => void;
  /** `strength` (about 0.8 to 1.25) scales the slam and shatter cues; other cues ignore it. */
  play: (kind: DuelSoundCue, strength?: number) => void;
  /** Schedules a whole battle (strikes, clash, counter, LP ticks) from its plan. */
  playBattle: (plan: BattleSoundPlan) => void;
  stopAll: () => void;
  dispose: () => void;
}

/** A cheap reverb: three filtered, feeding-back echoes summed into `out`. Returns the bus to send voices to. */
function buildWetBus(audio: AudioContext, out: AudioNode): GainNode {
  const bus = audio.createGain();
  const level = audio.createGain();
  level.gain.value = 0.45;
  level.connect(out);
  for (const time of [0.083, 0.127, 0.191]) {
    const delay = audio.createDelay(0.5);
    delay.delayTime.value = time;
    const tone = audio.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2600;
    const feedback = audio.createGain();
    feedback.gain.value = 0.38;
    bus.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(level);
  }
  return bus;
}

export function createDuelFeedbackAudio(): DuelFeedbackAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let unlocked = false;
  let muted = true;
  let volume = 1;
  /** Send bus for the reverb-like tail (a few filtered echoes). */
  let wet: GainNode | null = null;
  const voices: Voice[] = [];
  /** The voices of the fight now sounding: a new fight fades them out (its picture replaced the old one). */
  let battleVoices: Voice[] = [];
  /** While a fight is being scheduled, its voices are collected here. */
  let collecting: Voice[] | null = null;

  function addVoice(voice: Voice): void {
    voices.push(voice);
    collecting?.push(voice);
    voice.osc.onended = () => {
      const index = voices.indexOf(voice);
      if (index >= 0) voices.splice(index, 1);
      // Nothing holds a finished voice in the graph (the send buses and the LFO stay connected otherwise).
      for (const node of voice.nodes) {
        try {
          node.disconnect();
        } catch {
          // already disconnected
        }
      }
    };
  }

  function fadeOut(list: readonly Voice[]): void {
    const now = ctx?.currentTime ?? 0;
    for (const voice of list) {
      try {
        const gain = voice.gain.gain;
        // Hold the level where it is, then glide to silence; a bare cancel would jump the envelope.
        if (typeof gain.cancelAndHoldAtTime === "function") gain.cancelAndHoldAtTime(now);
        else gain.cancelScheduledValues(now);
        gain.setTargetAtTime(0, now, FADE_OUT_S);
        voice.osc.stop(now + FADE_OUT_S * 6);
      } catch {
        // already stopped
      }
    }
  }

  function stopAll(): void {
    fadeOut(voices.splice(0));
    battleVoices = [];
  }

  function ensureGraph(): AudioContext | null {
    if (ctx) return ctx;
    if (typeof window === "undefined") return null;
    const w = window as Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    // Layered attack sounds can stack loud: a limiter keeps the sum from clipping. Set as a limiter
    // (high threshold, fast attack); the defaults (-24 dB, 12:1) would squash every cue flat.
    if (typeof ctx.createDynamicsCompressor === "function") {
      const limiter = ctx.createDynamicsCompressor();
      if (limiter.threshold) {
        limiter.threshold.value = -8;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.2;
      }
      master.connect(limiter);
      limiter.connect(ctx.destination);
    } else {
      master.connect(ctx.destination);
    }
    wet = buildWetBus(ctx, master);
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
      // A short glide, not a step: a step in the middle of a sound clicks.
      master.gain.setTargetAtTime(next ? 0 : volume, ctx.currentTime, FADE_OUT_S);
    }
    if (next) stopAll();
  }

  /** Nothing to hear: muted, still locked, or the volume is at zero (no nodes are built then). */
  function silent(): boolean {
    return !unlocked || muted || volume <= 0;
  }

  function setVolume(next: number): void {
    volume = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 1;
    if (master && ctx && !muted) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
    }
  }

  function tone(
    audio: AudioContext,
    dest: GainNode,
    opts: ToneOpts,
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
    const nodes: AudioNode[] = [osc, gain];
    let out: AudioNode = osc;
    if (opts.lowpass != null) {
      const lp = audio.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(opts.lowpass, t);
      osc.connect(lp);
      out = lp;
      nodes.push(lp);
    }
    out.connect(gain);
    gain.connect(dest);
    const send = sendTo(audio, gain, opts.send);
    if (send) nodes.push(send);
    if (opts.vibrato) {
      const lfo = audio.createOscillator();
      const depth = audio.createGain();
      lfo.frequency.setValueAtTime(opts.vibrato.hz, t);
      depth.gain.setValueAtTime(opts.vibrato.cents, t);
      lfo.connect(depth);
      depth.connect(osc.detune);
      lfo.start(t);
      lfo.stop(t + opts.duration + 0.02);
      nodes.push(lfo, depth);
    }
    addVoice({ osc, gain, nodes });
    osc.start(t);
    osc.stop(t + opts.duration + 0.02);
  }

  /** Routes a voice's output to the reverb-like bus as well, `amount` deep. */
  function sendTo(audio: AudioContext, from: GainNode, amount: number | undefined): GainNode | null {
    if (!wet || !amount) return null;
    const send = audio.createGain();
    send.gain.setValueAtTime(amount, audio.currentTime);
    from.connect(send);
    send.connect(wet);
    return send;
  }

  let noise: AudioBuffer | null = null;

  /** A short burst of filtered noise: the body of a slam or a shattering card. */
  function burst(
    audio: AudioContext,
    dest: GainNode,
    opts: BurstOpts,
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
    if (opts.q != null) filter.Q.setValueAtTime(opts.q, opts.start);
    filter.frequency.setValueAtTime(opts.freq, opts.start);
    if (opts.freqEnd != null) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd, 20), opts.start + opts.duration);
    }
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0, opts.start);
    gain.gain.linearRampToValueAtTime(opts.peak, opts.start + Math.min(opts.attack ?? 0.004, opts.duration * 0.9));
    gain.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    const nodes: AudioNode[] = [src, filter, gain];
    const send = sendTo(audio, gain, opts.send);
    if (send) nodes.push(send);
    addVoice({ osc: src, gain, nodes });
    src.start(opts.start);
    src.stop(opts.start + opts.duration + 0.02);
  }

  function play(kind: DuelSoundCue, strength = 1): void {
    if (silent()) return;
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
        shatter(synthFor(audio, dest), t, strength);
        break;
      case "turn":
        // A card sliding a quarter turn on the mat: a short brush and a soft tap as it settles.
        burst(audio, dest, { start: t, duration: 0.12, peak: 0.02, filter: "bandpass", freq: 1400, freqEnd: 700 });
        tone(audio, dest, { freq: 220, type: "triangle", start: t + 0.2, duration: 0.07, peak: 0.02, attack: 0.004 });
        break;
      case "flip":
        // The card turns over: a quick brush, then a small bright chime as the face shows.
        burst(audio, dest, { start: t, duration: 0.1, peak: 0.024, filter: "bandpass", freq: 1800, freqEnd: 900 });
        tone(audio, dest, { freq: 987.77, type: "sine", start: t + 0.16, duration: 0.16, peak: 0.028 });
        tone(audio, dest, { freq: 1318.5, type: "sine", start: t + 0.2, duration: 0.18, peak: 0.018 });
        break;
      case "fusion":
        // Two voices swirl toward each other and merge into one bright chord.
        tone(audio, dest, { freq: 330, freqEnd: 494, type: "sine", start: t, duration: 0.5, peak: 0.028, attack: 0.08 });
        tone(audio, dest, { freq: 660, freqEnd: 494, type: "triangle", start: t, duration: 0.5, peak: 0.016, attack: 0.08 });
        tone(audio, dest, { freq: 494, type: "sine", start: t + 0.55, duration: 0.3, peak: 0.04, attack: 0.006 });
        tone(audio, dest, { freq: 740, type: "sine", start: t + 0.56, duration: 0.26, peak: 0.024, attack: 0.006 });
        burst(audio, dest, { start: t + 0.55, duration: 0.16, peak: 0.03, filter: "lowpass", freq: 1600, freqEnd: 300 });
        break;
      case "synchro":
        // Tuning rings: a rising ladder of clear tones, then a white flash of noise.
        for (let i = 0; i < 4; i += 1) {
          tone(audio, dest, { freq: 880 * Math.pow(2, i / 4), type: "sine", start: t + i * 0.09, duration: 0.2, peak: 0.02, attack: 0.008 });
        }
        tone(audio, dest, { freq: 1760, freqEnd: 2637, type: "sine", start: t + 0.4, duration: 0.3, peak: 0.02, attack: 0.03 });
        burst(audio, dest, { start: t + 0.56, duration: 0.22, peak: 0.035, filter: "highpass", freq: 1200, freqEnd: 4000 });
        tone(audio, dest, { freq: 1046.5, type: "sine", start: t + 0.58, duration: 0.3, peak: 0.03, attack: 0.005 });
        break;
      case "xyz":
        // A dark swirl underneath, gold orbs circling, then a rising thump as the monster comes up.
        tone(audio, dest, { freq: 70, freqEnd: 52, type: "sine", start: t, duration: 0.7, peak: 0.05, attack: 0.1 });
        for (let i = 0; i < 3; i += 1) {
          tone(audio, dest, { freq: 1568 + i * 220, type: "sine", start: t + 0.15 + i * 0.16, duration: 0.12, peak: 0.014, attack: 0.004 });
        }
        tone(audio, dest, { freq: 90, freqEnd: 160, type: "sine", start: t + 0.72, duration: 0.24, peak: 0.08, attack: 0.006 });
        tone(audio, dest, { freq: 1244.5, type: "triangle", start: t + 0.76, duration: 0.2, peak: 0.02, attack: 0.004 });
        break;
      case "link":
        // Circuit: a run of short digital blips, then a data sweep and a lock-in tone.
        for (let i = 0; i < 6; i += 1) {
          tone(audio, dest, { freq: 1200 + (i % 3) * 300, type: "square", start: t + 0.1 + i * 0.05, duration: 0.03, peak: 0.006, attack: 0.002 });
        }
        tone(audio, dest, { freq: 2400, freqEnd: 600, type: "sawtooth", start: t + 0.28, duration: 0.28, peak: 0.008, attack: 0.01 });
        tone(audio, dest, { freq: 587.33, type: "sine", start: t + 0.58, duration: 0.24, peak: 0.032, attack: 0.005 });
        tone(audio, dest, { freq: 880, type: "sine", start: t + 0.6, duration: 0.2, peak: 0.02, attack: 0.005 });
        break;
      case "ritual":
        // A low swell like a held chord, blue flames hissing, then a bell as the monster rises.
        tone(audio, dest, { freq: 110, type: "sine", start: t, duration: 0.8, peak: 0.04, attack: 0.2 });
        tone(audio, dest, { freq: 164.81, type: "triangle", start: t + 0.05, duration: 0.75, peak: 0.018, attack: 0.22 });
        burst(audio, dest, { start: t + 0.1, duration: 0.5, peak: 0.012, filter: "bandpass", freq: 600, freqEnd: 1800 });
        tone(audio, dest, { freq: 659.25, type: "sine", start: t + 0.64, duration: 0.36, peak: 0.03, attack: 0.006 });
        tone(audio, dest, { freq: 1318.5, type: "sine", start: t + 0.66, duration: 0.3, peak: 0.014, attack: 0.006 });
        break;
      case "pendulum":
        // The pendulum swings: a slow whoosh across, then a chime as the light drops.
        burst(audio, dest, { start: t, duration: 0.5, peak: 0.016, filter: "bandpass", freq: 400, freqEnd: 1600 });
        tone(audio, dest, { freq: 392, freqEnd: 587.33, type: "sine", start: t + 0.05, duration: 0.5, peak: 0.016, attack: 0.1 });
        tone(audio, dest, { freq: 1567.98, type: "sine", start: t + 0.9, duration: 0.3, peak: 0.028, attack: 0.005 });
        tone(audio, dest, { freq: 2093, type: "sine", start: t + 0.94, duration: 0.24, peak: 0.014, attack: 0.005 });
        break;
      default:
        break;
    }
  }

  function synthFor(audio: AudioContext, dest: GainNode): Synth {
    return {
      tone: (opts) => tone(audio, dest, opts),
      burst: (opts) => burst(audio, dest, opts),
    };
  }

  function playBattle(plan: BattleSoundPlan): void {
    if (silent()) return;
    const audio = ctx;
    const dest = master;
    if (!audio || !dest || audio.state !== "running") return;
    // A new fight replaces the picture of the one before it: its pending strikes must not play on.
    fadeOut(battleVoices);
    const mine: Voice[] = [];
    collecting = mine;
    try {
      scheduleBattleSound(synthFor(audio, dest), plan, audio.currentTime + 0.01);
    } finally {
      collecting = null;
    }
    battleVoices = mine;
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

  return { unlock, setMuted, setVolume, play, playBattle, stopAll, dispose };
}
