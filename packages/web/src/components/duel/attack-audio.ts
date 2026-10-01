import { COUNTER_GAP_MS, hasCounterStrike, type AttackStyleId, type BattleKind, type BattleTiming } from "./attack-styles";

/**
 * Sounds for the battle animation, synthesised (there are no audio files).
 *
 * Pure scheduling: every function only calls a `Synth`, which feedback-audio.ts backs with the Web
 * Audio API (and tests back with a recorder). A whole fight is scheduled in one go from its plan,
 * so the sound lines up with the picture: for each strike a charge-up, the travel, and the hit on
 * the same clock as STYLE_TIMING / battleTiming (attack-styles.ts).
 *
 *   slash     drawn-blade "shing", a whoosh, a metal clang and a second cut
 *   claw      a low growl, three raking swipes, three tearing rips
 *   beam      a rising power-up whine, a sustained laser, a zap and a boom
 *   arcane    a shimmering pad with a chime run, a fluttering orb, a bell burst
 *   lightning a mains hum with crackle, a sharp crack, a thunder roll
 *   flame     an inhale, a roar with pops, an explosion and its embers
 *   impact    a rumble, a heavy whump, a sub-bass smash with debris
 *
 * Signature attacks add a layer on top of their style (a dragon's roar, a dark choir, sparkles...).
 * The counterattack is the defender's own style, compressed like its picture, after a clash.
 */

export type ToneOpts = {
  freq: number;
  freqEnd?: number;
  type: OscillatorType;
  start: number;
  duration: number;
  peak: number;
  attack?: number;
  /** Share of the voice sent to the reverb-like bus (0 = dry). */
  send?: number;
  /** Pitch wobble: a growl, a flutter. `cents` is the depth. */
  vibrato?: { hz: number; cents: number };
  /** Low-pass cutoff in Hz, to take the edge off a saw or square. */
  lowpass?: number;
};

export type BurstOpts = {
  start: number;
  duration: number;
  peak: number;
  filter: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
  attack?: number;
  send?: number;
};

export interface Synth {
  tone: (opts: ToneOpts) => void;
  burst: (opts: BurstOpts) => void;
}

/** A side of the fight: its attack style and, when the card has one, its signature passcode. */
export type SoundSide = { style: AttackStyleId; signature: number | null };

export type BattleSoundPlan = {
  kind: BattleKind;
  reduced: boolean;
  attacker: SoundSide;
  /** The defender, when it strikes back or clashes; null for a direct attack. */
  defender: SoundSide | null;
  timing: BattleTiming;
  /** When each LP tally rolls, ms from the start. */
  lpAt: readonly number[];
  seed: number;
};

/** Signature passcodes (see SIGNATURES in attack-styles.ts). */
export const SIG = {
  BLUE_EYES: 89631139,
  DARK_MAGICIAN: 46986414,
  DARK_MAGICIAN_GIRL: 38033121,
  RED_EYES: 74677422,
  CYBER_DRAGON: 70095154,
  SUMMONED_SKULL: 70781052,
} as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

/* ---------- building blocks ---------- */

/** Sub-bass thump with a short muffled knock on top. */
export function thump(s: Synth, t: number, peak: number, f0 = 120, f1 = 36, dur = 0.32): void {
  s.tone({ freq: f0, freqEnd: f1, type: "sine", start: t, duration: dur, peak, attack: 0.003 });
  s.burst({ start: t, duration: 0.12, peak: peak * 0.45, filter: "lowpass", freq: 800, freqEnd: 120 });
}

/** Filtered noise that swells and dies: a whoosh. */
export function whoosh(s: Synth, t: number, dur: number, f0: number, f1: number, peak: number, q = 1.2): void {
  s.burst({ start: t, duration: dur, peak, filter: "bandpass", freq: f0, freqEnd: f1, q, attack: dur * 0.6 });
}

/** Inharmonic partials with a bright strike on top: a blade or armour ringing. */
export function clang(s: Synth, t: number, peak: number, f: number): void {
  const partials: Array<[number, number, number]> = [[1, 1, 0.45], [2.76, 0.6, 0.3], [5.4, 0.35, 0.2], [8.93, 0.2, 0.12]];
  for (const [ratio, level, life] of partials) {
    s.tone({ freq: f * ratio, type: "sine", start: t, duration: life, peak: peak * level, attack: 0.002, send: 0.4 });
  }
  s.burst({ start: t, duration: 0.05, peak: peak * 1.1, filter: "highpass", freq: 3000, freqEnd: 6000 });
}

/** Electric crackle: short bright pops at random gaps, fading (or, with `rise`, building). */
export function crackle(s: Synth, t: number, dur: number, peak: number, rng: Rng, rise = false): void {
  let x = 0;
  while (x < dur) {
    const shape = rise ? x / dur : 1 - x / dur;
    const level = peak * (0.25 + 0.75 * shape) * (0.5 + rng() * 0.5);
    s.burst({ start: t + x, duration: 0.012 + rng() * 0.02, peak: level, filter: "highpass", freq: 2500 + rng() * 3000 });
    x += 0.012 + rng() * 0.045;
  }
}

/** A stack of sines: a shimmer or a chord, optionally wobbling. */
export function shimmer(s: Synth, t: number, dur: number, base: number, ratios: readonly number[], peak: number, attack: number, hz = 6): void {
  for (const ratio of ratios) {
    s.tone({ freq: base * ratio, type: "sine", start: t, duration: dur, peak, attack, send: 0.6, vibrato: { hz, cents: 14 } });
  }
}

/** A growl or roar: a wobbling saw through a low-pass, with formant noise for the throat. */
export function growl(s: Synth, t: number, dur: number, f0: number, f1: number, peak: number, hz = 9, cents = 80): void {
  s.tone({ freq: f0, freqEnd: f1, type: "sawtooth", start: t, duration: dur, peak, attack: Math.min(0.12, dur * 0.4), vibrato: { hz, cents }, lowpass: 900 });
  s.burst({ start: t, duration: dur, peak: peak * 0.9, filter: "bandpass", freq: f0 * 4, freqEnd: f1 * 8, q: 4, attack: dur * 0.5 });
}

/** A run of scattered short pops: embers, debris, sparks. */
export function pops(s: Synth, t: number, count: number, span: number, peak: number, lo: number, hi: number, rng: Rng): void {
  for (let i = 0; i < count; i += 1) {
    const at = t + rng() * span;
    s.burst({ start: at, duration: 0.02 + rng() * 0.02, peak: peak * (1 - (at - t) / (span * 1.4)), filter: "bandpass", freq: lo + rng() * (hi - lo), q: 2 });
  }
}

/* ---------- the styles: charge, travel, hit ---------- */

/** `t` = start of the strike, `d` = seconds until it lands, `g` = loudness (a counter strike is quieter). */
type StyleSound = (s: Synth, t: number, d: number, g: number, rng: Rng) => void;

const slash: StyleSound = (s, t, d, g) => {
  s.tone({ freq: 1800, freqEnd: 4200, type: "sine", start: t, duration: d * 0.5, peak: 0.012 * g, attack: d * 0.3, send: 0.3 });
  s.burst({ start: t, duration: 0.12, peak: 0.02 * g, filter: "highpass", freq: 4000, freqEnd: 7000 });
  whoosh(s, t + d * 0.45, d * 0.55, 900, 3800, 0.05 * g);
  clang(s, t + d, 0.06 * g, 1250);
  s.burst({ start: t + d, duration: 0.07, peak: 0.07 * g, filter: "highpass", freq: 3500 });
  s.burst({ start: t + d + 0.07, duration: 0.09, peak: 0.05 * g, filter: "bandpass", freq: 2600, freqEnd: 1400, q: 1.5 });
  thump(s, t + d, 0.05 * g, 140, 60, 0.15);
};

const claw: StyleSound = (s, t, d, g) => {
  growl(s, t, d * 0.7, 90, 130, 0.03 * g, 18, 60);
  for (let i = 0; i < 3; i += 1) {
    whoosh(s, t + d - 0.24 + i * 0.08, 0.08, 2400, 900, 0.04 * g, 2);
    const at = t + d + i * 0.055 - 0.02;
    s.burst({ start: at, duration: 0.1, peak: 0.05 * g, filter: "bandpass", freq: 1800, freqEnd: 500, q: 1.2 });
    s.burst({ start: at, duration: 0.04, peak: 0.04 * g, filter: "highpass", freq: 3000 });
  }
  thump(s, t + d, 0.07 * g, 110, 45, 0.25);
  growl(s, t + d, 0.22, 75, 60, 0.03 * g, 12, 50);
};

const beam: StyleSound = (s, t, d, g) => {
  s.tone({ freq: 180, freqEnd: 1500, type: "sine", start: t, duration: d * 0.78, peak: 0.028 * g, attack: d * 0.6, send: 0.3 });
  s.tone({ freq: 90, freqEnd: 750, type: "square", start: t, duration: d * 0.78, peak: 0.01 * g, attack: d * 0.5, lowpass: 1200 });
  s.tone({ freq: 2400, freqEnd: 3400, type: "sine", start: t, duration: d * 0.78, peak: 0.006 * g, attack: d * 0.6 });
  s.tone({ freq: 720, freqEnd: 640, type: "sawtooth", start: t + d * 0.7, duration: d * 0.3 + 0.32, peak: 0.03 * g, attack: 0.02, vibrato: { hz: 40, cents: 30 }, lowpass: 3000 });
  s.tone({ freq: 2200, freqEnd: 160, type: "sine", start: t + d, duration: 0.22, peak: 0.07 * g, attack: 0.002, send: 0.5 });
  s.burst({ start: t + d, duration: 0.14, peak: 0.06 * g, filter: "highpass", freq: 2500, freqEnd: 5000 });
  thump(s, t + d, 0.09 * g, 100, 34, 0.4);
};

const arcane: StyleSound = (s, t, d, g) => {
  shimmer(s, t, d * 1.1, 392, [1, 1.5, 2], 0.014 * g, d * 0.5);
  [659, 784, 988, 1319].forEach((f, i) => {
    s.tone({ freq: f, type: "sine", start: t + i * d * 0.12, duration: 0.14, peak: 0.016 * g, attack: 0.004, send: 0.5 });
  });
  s.tone({ freq: 500, freqEnd: 1400, type: "sine", start: t + d * 0.4, duration: d * 0.6, peak: 0.02 * g, attack: d * 0.3, vibrato: { hz: 14, cents: 120 }, send: 0.4 });
  whoosh(s, t + d * 0.4, d * 0.6, 600, 2400, 0.02 * g);
  const bells: Array<[number, number, number]> = [[880, 0.9, 0.04], [1318, 0.8, 0.03], [1760, 0.7, 0.02], [2637, 0.5, 0.012]];
  for (const [f, life, level] of bells) s.tone({ freq: f, type: "sine", start: t + d, duration: life, peak: level * g, attack: 0.003, send: 0.7 });
  s.burst({ start: t + d, duration: 0.25, peak: 0.04 * g, filter: "bandpass", freq: 3000, freqEnd: 800, q: 1 });
  thump(s, t + d, 0.05 * g, 90, 45, 0.25);
};

const lightning: StyleSound = (s, t, d, g, rng) => {
  s.tone({ freq: 55, type: "sawtooth", start: t, duration: d, peak: 0.03 * g, attack: d * 0.8, lowpass: 300 });
  crackle(s, t, d * 0.9, 0.02 * g, rng, true);
  crackle(s, t + d * 0.5, d * 0.5, 0.04 * g, rng, true);
  s.burst({ start: t + d, duration: 0.09, peak: 0.12 * g, filter: "highpass", freq: 1500 });
  s.tone({ freq: 3200, freqEnd: 90, type: "sine", start: t + d, duration: 0.16, peak: 0.07 * g, attack: 0.002, send: 0.5 });
  crackle(s, t + d, 0.4, 0.05 * g, rng);
  s.burst({ start: t + d, duration: 0.8, peak: 0.09 * g, filter: "lowpass", freq: 220, freqEnd: 60, attack: 0.05, send: 0.4 });
  thump(s, t + d, 0.1 * g, 90, 32, 0.4);
};

const flame: StyleSound = (s, t, d, g, rng) => {
  whoosh(s, t, d * 0.8, 250, 900, 0.03 * g, 0.8);
  s.tone({ freq: 70, freqEnd: 100, type: "sawtooth", start: t, duration: d, peak: 0.02 * g, attack: d * 0.6, lowpass: 250 });
  s.burst({ start: t + d * 0.35, duration: d * 0.65 + 0.2, peak: 0.06 * g, filter: "lowpass", freq: 900, freqEnd: 500, attack: d * 0.4 });
  pops(s, t + d * 0.3, 10, d * 0.7, 0.02 * g, 500, 1400, rng);
  thump(s, t + d, 0.12 * g, 100, 28, 0.5);
  s.burst({ start: t + d, duration: 0.5, peak: 0.09 * g, filter: "lowpass", freq: 1800, freqEnd: 150, send: 0.35 });
  pops(s, t + d + 0.05, 8, 0.5, 0.03 * g, 1000, 3000, rng);
};

const impact: StyleSound = (s, t, d, g, rng) => {
  s.tone({ freq: 40, freqEnd: 75, type: "sine", start: t, duration: d * 0.9, peak: 0.05 * g, attack: d * 0.7 });
  s.burst({ start: t, duration: d * 0.9, peak: 0.03 * g, filter: "lowpass", freq: 200, attack: d * 0.7 });
  s.burst({ start: t + d * 0.55, duration: d * 0.4, peak: 0.05 * g, filter: "lowpass", freq: 600, freqEnd: 200, attack: d * 0.3 });
  thump(s, t + d, 0.18 * g, 140, 28, 0.45);
  s.burst({ start: t + d, duration: 0.35, peak: 0.1 * g, filter: "lowpass", freq: 1400, freqEnd: 120 });
  s.burst({ start: t + d, duration: 0.06, peak: 0.08 * g, filter: "highpass", freq: 1800 });
  pops(s, t + d + 0.05, 5, 0.25, 0.03 * g, 600, 2500, rng);
};

export const STYLE_SOUNDS: Record<AttackStyleId, StyleSound> = { slash, claw, beam, arcane, lightning, flame, impact };

/* ---------- signature attacks: a layer on top of the style ---------- */

const SIGNATURE_SOUNDS: Record<number, StyleSound> = {
  // White Lightning: a dragon's roar, a rising white whine, sparkles in the crack.
  [SIG.BLUE_EYES]: (s, t, d, g) => {
    s.tone({ freq: 140, freqEnd: 260, type: "sawtooth", start: t, duration: d * 0.8, peak: 0.04 * g, attack: d * 0.3, vibrato: { hz: 9, cents: 80 }, lowpass: 900 });
    s.burst({ start: t, duration: d * 0.7, peak: 0.04 * g, filter: "bandpass", freq: 500, freqEnd: 1400, q: 4, attack: d * 0.5 });
    s.tone({ freq: 1200, freqEnd: 3600, type: "sine", start: t, duration: d, peak: 0.014 * g, attack: d * 0.8, send: 0.3 });
    [2637, 3136, 3951].forEach((f, i) => s.tone({ freq: f, type: "sine", start: t + d + i * 0.03, duration: 0.5, peak: 0.012 * g, attack: 0.003, send: 0.7 }));
  },
  // Dark Magic Attack: a low dark choir swelling, then a tolling bell that falls.
  [SIG.DARK_MAGICIAN]: (s, t, d, g) => {
    s.tone({ freq: 110, type: "sawtooth", start: t, duration: d + 0.5, peak: 0.025 * g, attack: d * 0.5, vibrato: { hz: 5, cents: 25 }, lowpass: 700, send: 0.4 });
    s.tone({ freq: 165, type: "sawtooth", start: t, duration: d + 0.5, peak: 0.018 * g, attack: d * 0.5, vibrato: { hz: 5.5, cents: 25 }, lowpass: 700, send: 0.4 });
    s.tone({ freq: 660, freqEnd: 330, type: "sine", start: t + d, duration: 0.8, peak: 0.03 * g, attack: 0.003, send: 0.8 });
    s.burst({ start: t + d, duration: 0.5, peak: 0.05 * g, filter: "lowpass", freq: 300, freqEnd: 80 });
  },
  // Dark Burning Attack: a bright run of sparkles up, a heart-shaped burst of chimes.
  [SIG.DARK_MAGICIAN_GIRL]: (s, t, d, g) => {
    for (let i = 0; i < 8; i += 1) {
      s.tone({ freq: 1568 * Math.pow(2, i / 6), type: "sine", start: t + i * (d / 9), duration: 0.14, peak: 0.012 * g, attack: 0.003, send: 0.6 });
    }
    [1046, 1318, 1568, 2093].forEach((f, i) => s.tone({ freq: f, type: "sine", start: t + d + i * 0.02, duration: 0.6, peak: 0.022 * g, attack: 0.003, send: 0.7 }));
    s.burst({ start: t + d, duration: 0.3, peak: 0.04 * g, filter: "highpass", freq: 3000, freqEnd: 6000 });
  },
  // Inferno Fire Blast: a rasping roar and a second blast right behind the first.
  [SIG.RED_EYES]: (s, t, d, g) => {
    s.tone({ freq: 110, freqEnd: 200, type: "sawtooth", start: t, duration: d * 0.85, peak: 0.04 * g, attack: d * 0.3, vibrato: { hz: 11, cents: 90 }, lowpass: 800 });
    s.tone({ freq: 55, freqEnd: 100, type: "square", start: t, duration: d * 0.85, peak: 0.012 * g, attack: d * 0.3, lowpass: 400 });
    s.burst({ start: t, duration: d * 0.75, peak: 0.04 * g, filter: "bandpass", freq: 450, freqEnd: 1200, q: 5, attack: d * 0.5 });
    thump(s, t + d + 0.12, 0.09 * g, 90, 26, 0.45);
  },
  // Evolution Burst: servo steps winding up, pulsing charge, a metal ring under the zap.
  [SIG.CYBER_DRAGON]: (s, t, d, g) => {
    [200, 300, 250, 400, 320, 480].forEach((f, i) => {
      s.tone({ freq: f, type: "square", start: t + i * (d * 0.12), duration: 0.05, peak: 0.008 * g, attack: 0.002, lowpass: 1800 });
    });
    for (let i = 0; i < 3; i += 1) {
      s.tone({ freq: 300 + i * 90, type: "sawtooth", start: t + d * 0.55 + i * 0.09, duration: 0.06, peak: 0.016 * g, attack: 0.004, lowpass: 1500 });
    }
    clang(s, t + d, 0.03 * g, 800);
  },
  // Lightning Strike: a demon's low growl under the build, the crack echoing.
  [SIG.SUMMONED_SKULL]: (s, t, d, g) => {
    s.tone({ freq: 62, freqEnd: 48, type: "sawtooth", start: t, duration: d + 0.2, peak: 0.04 * g, attack: d * 0.5, vibrato: { hz: 6, cents: 100 }, lowpass: 400 });
    s.burst({ start: t + d + 0.1, duration: 0.3, peak: 0.06 * g, filter: "highpass", freq: 1500, send: 0.9 });
    thump(s, t + d + 0.1, 0.07 * g, 80, 30, 0.35);
  },
};

/* ---------- the parts of a fight ---------- */

/** One strike: its style, then its signature layer when the card has one. */
function strike(s: Synth, side: SoundSide, t: number, d: number, g: number, rng: Rng): void {
  STYLE_SOUNDS[side.style](s, t, d, g, rng);
  const layer = side.signature != null ? SIGNATURE_SOUNDS[side.signature] : undefined;
  if (layer) layer(s, t, d, g, rng);
}

/** Two attacks meeting: armour, blade and force ringing off each other. */
export function clash(s: Synth, t: number, g = 1): void {
  clang(s, t, 0.05 * g, 640);
  s.burst({ start: t, duration: 0.1, peak: 0.05 * g, filter: "bandpass", freq: 1800, freqEnd: 700, q: 1.5 });
  thump(s, t, 0.07 * g, 110, 40, 0.22);
}

/** The counterattack begins: a quick reversing sweep, up then back down. */
function reversal(s: Synth, t: number, g = 1): void {
  s.burst({ start: t, duration: 0.14, peak: 0.035 * g, filter: "bandpass", freq: 500, freqEnd: 2600, q: 2, attack: 0.09 });
  s.tone({ freq: 300, freqEnd: 120, type: "triangle", start: t + 0.05, duration: 0.14, peak: 0.02 * g, attack: 0.01 });
}

/** The LP tally rolling: a quick run of falling digital ticks with a low hit under it. */
export function lpTick(s: Synth, t: number, g = 1): void {
  for (let i = 0; i < 8; i += 1) {
    s.tone({ freq: 1000 - i * 55, type: "square", start: t + i * 0.04, duration: 0.03, peak: 0.008 * g, attack: 0.002, lowpass: 2600 });
  }
  s.tone({ freq: 90, freqEnd: 55, type: "sine", start: t, duration: 0.16, peak: 0.05 * g, attack: 0.004 });
}

/** A destroyed monster shattering: glass and stone, then a low crumble. */
export function shatter(s: Synth, t: number, strength = 1, rng: Rng = Math.random): void {
  s.burst({ start: t, duration: 0.22, peak: 0.055 * strength, filter: "highpass", freq: 2200, freqEnd: 5200 });
  s.tone({ freq: 880, freqEnd: 260, type: "triangle", start: t, duration: 0.16, peak: 0.02 * strength, attack: 0.003 });
  for (let i = 0; i < 5; i += 1) {
    s.tone({ freq: 2200 + rng() * 3800, type: "sine", start: t + 0.02 + i * 0.03 + rng() * 0.02, duration: 0.09, peak: 0.011 * strength, attack: 0.002, send: 0.5 });
  }
  s.burst({ start: t + 0.03, duration: 0.32, peak: 0.05 * strength, filter: "lowpass", freq: 900, freqEnd: 120 });
  s.tone({ freq: 90, freqEnd: 40, type: "sine", start: t, duration: 0.24, peak: 0.05 * strength, attack: 0.004 });
}

/**
 * Schedules a whole fight starting at `t` (seconds on the audio clock): the attacker's strike, then
 * whatever follows from the outcome (a clash and the counter strike, the recoil of a tie), and the
 * LP ticks. The break of a destroyed card is sounded by SummonFx at its own moment ("shatter").
 */
export function scheduleBattleSound(synth: Synth, plan: BattleSoundPlan, t: number): void {
  const rng = mulberry32(plan.seed);
  const { timing, kind } = plan;
  const g = plan.reduced ? 0.8 : 1;
  const impactAt = timing.impactMs / 1000;
  strike(synth, plan.attacker, t, impactAt, g, rng);

  if (plan.defender && (hasCounterStrike(kind) || kind === "held")) {
    clash(synth, t + impactAt, g);
  }
  // The defender strikes back after a short pause: a lost fight, a tie, or a blow that bounced off.
  if (hasCounterStrike(kind) && plan.defender) {
    const start = (timing.impactMs + COUNTER_GAP_MS) / 1000;
    const counterDur = Math.max(0.12, (timing.attackerDamageMs - timing.impactMs - COUNTER_GAP_MS) / 1000);
    reversal(synth, t + start - 0.1, g);
    strike(synth, plan.defender, t + start, counterDur, 0.75 * g, rng);
  }
  for (const at of plan.lpAt) lpTick(synth, t + at / 1000, g);
}
