import { clang, crackle, growl, pops, shimmer, thump, whoosh, type Rng, type Synth } from "./attack-audio";
import type { SceneCueName } from "./fx3d/scene-plan";

/**
 * The sounds of the trap and effect set pieces (fx3d/scene-plan.ts lists when each one plays).
 * All of them are synthesized from the same building blocks as the attack sounds. `t` is the start
 * on the audio clock in seconds; `g` is the loudness (about 0.6 to 1.2).
 */
export function sceneSound(s: Synth, cue: SceneCueName, t: number, g: number, rng: Rng): void {
  switch (cue) {
    case "mirror-rise":
      // A glassy shimmer that climbs as the barrier stands up.
      shimmer(s, t, 0.55, 880, [1, 1.5, 2, 2.99], 0.012 * g, 0.18, 7);
      whoosh(s, t, 0.4, 1800, 5200, 0.03 * g, 2);
      break;
    case "mirror-reflect":
      // The zap that throws the attack back.
      s.tone({ freq: 2400, freqEnd: 300, type: "sawtooth", start: t, duration: 0.28, peak: 0.035 * g, attack: 0.002, lowpass: 3200 });
      crackle(s, t, 0.22, 0.05 * g, rng);
      clang(s, t, 0.05 * g, 1320);
      thump(s, t + 0.02, 0.1 * g, 150, 44, 0.3);
      break;
    case "armor-clank":
      clang(s, t, 0.09 * g, 260);
      clang(s, t + 0.05, 0.05 * g, 410);
      thump(s, t, 0.08 * g, 90, 40, 0.2);
      break;
    case "armor-boom":
      thump(s, t, 0.2 * g, 100, 28, 0.55);
      s.burst({ start: t, duration: 0.5, peak: 0.09 * g, filter: "lowpass", freq: 2200, freqEnd: 140 });
      pops(s, t + 0.03, 8, 0.3, 0.05 * g, 900, 4200, rng);
      break;
    case "tidal":
      // A roar that swells with the wave and drains away.
      s.burst({ start: t, duration: 1.1, peak: 0.1 * g, filter: "bandpass", freq: 300, freqEnd: 900, q: 0.8, attack: 0.5 });
      s.burst({ start: t + 0.25, duration: 0.8, peak: 0.05 * g, filter: "highpass", freq: 2500, attack: 0.4 });
      s.tone({ freq: 70, freqEnd: 40, type: "sine", start: t + 0.2, duration: 0.9, peak: 0.08 * g, attack: 0.4 });
      break;
    case "black-hole":
      // A falling whoomp: pitch drops into the hole, then a sub thud.
      s.tone({ freq: 420, freqEnd: 34, type: "sine", start: t, duration: 0.7, peak: 0.12 * g, attack: 0.05 });
      growl(s, t, 0.6, 160, 40, 0.05 * g, 5, 60);
      whoosh(s, t + 0.1, 0.5, 1400, 120, 0.05 * g);
      thump(s, t + 0.55, 0.14 * g, 80, 30, 0.4);
      break;
    case "thunder":
      s.burst({ start: t, duration: 0.09, peak: 0.12 * g, filter: "highpass", freq: 1800 });
      crackle(s, t, 0.3, 0.06 * g, rng);
      s.burst({ start: t + 0.04, duration: 0.9, peak: 0.1 * g, filter: "lowpass", freq: 700, freqEnd: 70, attack: 0.02 });
      thump(s, t + 0.03, 0.14 * g, 70, 28, 0.6);
      break;
    case "fall-rumble":
      s.tone({ freq: 110, freqEnd: 32, type: "triangle", start: t, duration: 0.8, peak: 0.07 * g, attack: 0.15, lowpass: 500 });
      s.burst({ start: t, duration: 0.8, peak: 0.06 * g, filter: "lowpass", freq: 500, freqEnd: 90, attack: 0.2 });
      pops(s, t + 0.2, 6, 0.5, 0.03 * g, 200, 900, rng);
      break;
    case "chain-rattle":
      for (let i = 0; i < 7; i += 1) {
        const at = t + i * 0.045 + rng() * 0.012;
        s.tone({ freq: 1800 + rng() * 1400, type: "square", start: at, duration: 0.03, peak: 0.012 * g, attack: 0.001, lowpass: 5000 });
        s.burst({ start: at, duration: 0.03, peak: 0.02 * g, filter: "bandpass", freq: 3200 + rng() * 1500, q: 3 });
      }
      break;
    case "trap-glyph":
      shimmer(s, t, 0.4, 660, [1, 1.5, 2.25], 0.01 * g, 0.12, 8);
      whoosh(s, t, 0.3, 500, 2200, 0.025 * g);
      break;
    case "spell-burst":
      shimmer(s, t, 0.4, 990, [1, 1.26, 1.5, 2], 0.011 * g, 0.01, 5);
      s.burst({ start: t, duration: 0.2, peak: 0.05 * g, filter: "highpass", freq: 2600, freqEnd: 6000 });
      thump(s, t, 0.09 * g, 130, 40, 0.3);
      break;
    case "energy-strike":
      whoosh(s, t, 0.35, 700, 3200, 0.05 * g, 1.6);
      s.tone({ freq: 900, freqEnd: 180, type: "sawtooth", start: t, duration: 0.33, peak: 0.03 * g, attack: 0.01, lowpass: 2600 });
      thump(s, t + 0.3, 0.1 * g, 110, 38, 0.3);
      break;
    case "gust":
      // Wind: a band of noise that sweeps up and fades.
      s.burst({ start: t, duration: 0.9, peak: 0.07 * g, filter: "bandpass", freq: 500, freqEnd: 2200, q: 0.9, attack: 0.3 });
      whoosh(s, t + 0.1, 0.6, 900, 3000, 0.035 * g, 2);
      break;
    case "rift":
      // A tear in the air: a rising shimmer over a low pulse.
      shimmer(s, t, 0.7, 520, [1, 1.5, 2.01, 3], 0.01 * g, 0.2, 6);
      s.tone({ freq: 90, freqEnd: 50, type: "sine", start: t, duration: 0.7, peak: 0.07 * g, attack: 0.2 });
      crackle(s, t + 0.1, 0.4, 0.03 * g, rng);
      break;
    case "shock-boom":
      // One big pulse: a deep thump and a short roar.
      thump(s, t, 0.2 * g, 90, 28, 0.6);
      s.burst({ start: t, duration: 0.6, peak: 0.08 * g, filter: "lowpass", freq: 1800, freqEnd: 120 });
      clang(s, t + 0.02, 0.04 * g, 180);
      break;
  }
}

/** The cues above, for the audio layer to test membership. */
export const SCENE_CUES: readonly SceneCueName[] = [
  "mirror-rise", "mirror-reflect", "armor-clank", "armor-boom", "tidal", "black-hole",
  "thunder", "fall-rumble", "chain-rattle", "trap-glyph", "spell-burst", "energy-strike", "gust", "rift", "shock-boom",
];
