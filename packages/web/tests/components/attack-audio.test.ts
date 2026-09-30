import { describe, expect, it } from "vitest";
import { scheduleBattleSound, SIG, shatter, lpTick, type BattleSoundPlan, type BurstOpts, type Synth, type ToneOpts } from "../../src/components/duel/attack-audio";
import { battleTiming, STYLE_IDS, type AttackStyleId, type BattleKind } from "../../src/components/duel/attack-styles";

function recorder() {
  const tones: ToneOpts[] = [];
  const bursts: BurstOpts[] = [];
  const synth: Synth = { tone: (o) => tones.push(o), burst: (o) => bursts.push(o) };
  return { synth, tones, bursts };
}

function plan(kind: BattleKind, attacker: AttackStyleId, defender: AttackStyleId | null, extra: Partial<BattleSoundPlan> = {}): BattleSoundPlan {
  const timing = battleTiming(kind, attacker, defender);
  return {
    kind, reduced: false, timing, seed: 7, lpAt: [timing.impactMs],
    attacker: { style: attacker, signature: null },
    defender: defender ? { style: defender, signature: null } : null,
    ...extra,
  };
}

/** A stable description of what a style sounds like, to tell two styles apart. */
function fingerprint(style: AttackStyleId): string {
  const r = recorder();
  scheduleBattleSound(r.synth, plan("win", style, "impact", { lpAt: [] }), 0);
  const t = r.tones.map((o) => `${o.type}:${Math.round(o.freq)}:${o.vibrato ? "v" : ""}`).join("|");
  const b = r.bursts.map((o) => `${o.filter}:${Math.round(o.freq)}`).join("|");
  return `${t}#${b}`;
}

describe("attack sounds", () => {
  it("gives every style its own sound", () => {
    const prints = STYLE_IDS.map(fingerprint);
    expect(new Set(prints).size).toBe(STYLE_IDS.length);
  });

  it("schedules a charge before, and the hit at, the strike's impact time", () => {
    for (const style of STYLE_IDS) {
      const r = recorder();
      const p = plan("win", style, "impact", { lpAt: [] });
      scheduleBattleSound(r.synth, p, 10);
      const impactAt = 10 + p.timing.impactMs / 1000;
      const starts = [...r.tones.map((o) => o.start), ...r.bursts.map((o) => o.start)];
      expect(Math.min(...starts)).toBeCloseTo(10, 2);
      expect(starts.some((s) => s < impactAt - 0.05)).toBe(true);
      expect(starts.some((s) => Math.abs(s - impactAt) < 0.011)).toBe(true);
      // the sound of the hit is the loudest thing of the whole play
      const loudest = Math.max(...r.tones.map((o) => o.peak), ...r.bursts.map((o) => o.peak));
      const atHit = [...r.tones, ...r.bursts].filter((o) => Math.abs(o.start - impactAt) < 0.011).map((o) => o.peak);
      expect(Math.max(...atHit)).toBeGreaterThanOrEqual(loudest * 0.4);
    }
  });

  it("only produces finite, non-negative times and levels", () => {
    for (const a of STYLE_IDS) {
      for (const kind of ["win", "lose", "tie", "held", "direct"] as const) {
        for (const reduced of [false, true]) {
          const r = recorder();
          const d = kind === "direct" ? null : "claw";
          const base = plan(kind, a, d);
          scheduleBattleSound(r.synth, { ...base, reduced, timing: reduced ? { ...base.timing, impactMs: 260, attackerDamageMs: 420 } : base.timing }, 0);
          for (const o of [...r.tones, ...r.bursts]) {
            expect(Number.isFinite(o.start) && o.start >= 0).toBe(true);
            expect(o.duration).toBeGreaterThan(0);
            expect(o.peak).toBeGreaterThan(0);
            expect(o.peak).toBeLessThanOrEqual(0.25);
          }
        }
      }
    }
  });

  it("plays the counter strike only after the attacker's hit, and lands it at the counter's impact", () => {
    const r = recorder();
    const p = plan("lose", "slash", "beam", { lpAt: [] });
    scheduleBattleSound(r.synth, p, 0);
    const impactAt = p.timing.impactMs / 1000;
    const counterImpact = p.timing.attackerDamageMs / 1000;
    // the beam's laser (a sawtooth at 720 Hz) belongs to the counter and starts after the attacker's impact
    const laser = r.tones.filter((o) => o.type === "sawtooth" && o.freq === 720);
    expect(laser.length).toBe(1);
    expect(laser[0].start).toBeGreaterThan(impactAt);
    // the zap of the counter's hit lands on the counter's impact time
    const zap = r.tones.find((o) => o.type === "sine" && o.freq === 2200 && o.freqEnd === 160);
    expect(zap?.start).toBeCloseTo(counterImpact, 3);
    expect(counterImpact).toBeGreaterThan(impactAt);
  });

  it("adds the recoil of a tie after the first hit", () => {
    const r = recorder();
    const p = plan("tie", "impact", "impact", { lpAt: [] });
    scheduleBattleSound(r.synth, p, 0);
    const late = r.tones.filter((o) => o.start > p.timing.impactMs / 1000 + 0.15);
    expect(late.length).toBeGreaterThan(0);
  });

  it("layers a signature on top of its style", () => {
    for (const code of Object.values(SIG)) {
      const style: AttackStyleId = code === SIG.CYBER_DRAGON ? "beam" : code === SIG.DARK_MAGICIAN || code === SIG.DARK_MAGICIAN_GIRL ? "arcane" : code === SIG.RED_EYES ? "flame" : "lightning";
      const plain = recorder();
      scheduleBattleSound(plain.synth, plan("win", style, "impact", { lpAt: [] }), 0);
      const sig = recorder();
      scheduleBattleSound(sig.synth, plan("win", style, "impact", { lpAt: [], attacker: { style, signature: code } }), 0);
      expect(sig.tones.length + sig.bursts.length).toBeGreaterThan(plain.tones.length + plain.bursts.length);
    }
  });

  it("ticks the LP roll at each damage time and sounds a destroyed card's shatter", () => {
    const r = recorder();
    scheduleBattleSound(r.synth, plan("win", "slash", "impact", { lpAt: [520, 1060] }), 0);
    const ticks = (at: number) => r.tones.filter((o) => o.type === "square" && Math.abs(o.start - at) < 0.001);
    expect(ticks(0.52).length).toBe(1);
    expect(ticks(1.06).length).toBe(1);

    const s = recorder();
    shatter(s.synth, 2, 1);
    expect(s.tones.length + s.bursts.length).toBeGreaterThan(5);
    expect(Math.min(...s.tones.map((o) => o.start), ...s.bursts.map((o) => o.start))).toBe(2);
    const l = recorder();
    lpTick(l.synth, 1);
    expect(l.tones.length).toBe(9);
  });
});
