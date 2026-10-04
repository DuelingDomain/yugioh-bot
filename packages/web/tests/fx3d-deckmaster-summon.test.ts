import { describe, expect, it } from "vitest";
import {
  DM_PHASES,
  DM_REDUCED_MS,
  DM_SETTLE_MS,
  DM_SLOT_MAX_MS,
  DM_TOTAL_MS,
  dmBeats,
  dmDurationMs,
  dmReducedBeats,
  dmSettleMs,
  tiltDegOfCss,
  tiltRadOf,
} from "../src/components/duel/fx3d/effects/deckmaster-summon-timeline";

const sec = (ms: number) => ms / 1000;

describe("deck master summon timeline", () => {
  it("keeps the authored beats", () => {
    expect(DM_PHASES.fly).toEqual([0, 340]);
    expect(DM_PHASES.rings).toEqual([140, 640]);
    expect(DM_PHASES.cone).toEqual([200, 550]);
    expect(DM_PHASES.build).toEqual([300, 700]);
    expect(DM_PHASES.hold).toEqual([700, 780]);
    expect(DM_PHASES.settle).toEqual([780, 900]);
    expect(DM_PHASES.out).toEqual([880, 1150]);
    expect(DM_SETTLE_MS).toBe(900);
  });

  it("fits the V1 Deck Master summon slot (1.2 s)", () => {
    expect(DM_TOTAL_MS).toBeLessThanOrEqual(DM_SLOT_MAX_MS);
    expect(DM_SLOT_MAX_MS).toBe(1200);
    expect(dmDurationMs(false)).toBe(DM_TOTAL_MS);
    expect(dmDurationMs(true)).toBe(DM_REDUCED_MS);
    expect(DM_REDUCED_MS).toBeLessThan(DM_TOTAL_MS);
    expect(dmSettleMs(false)).toBeLessThan(DM_TOTAL_MS);
    expect(dmSettleMs(true)).toBeLessThan(DM_REDUCED_MS);
    // Every beat ends with the effect.
    for (const [, end] of Object.values(DM_PHASES)) expect(end).toBeLessThanOrEqual(DM_TOTAL_MS);
  });

  it("starts and ends clean", () => {
    const start = dmBeats(0);
    expect(start.settled).toBe(false);
    expect(start.fliers.map((f) => f.p)).toEqual([0, 0, 0]);
    expect(start.fliers.every((f) => f.alpha === 0)).toBe(true);
    expect(start.rings.every((r) => r.alpha === 0)).toBe(true);
    expect(start.holo.alpha).toBe(0);
    expect(start.cone.alpha).toBe(0);
    const end = dmBeats(sec(DM_TOTAL_MS));
    expect(end.settled).toBe(true);
    expect(end.rings.every((r) => r.alpha === 0)).toBe(true);
    expect(end.disc).toBe(0);
    expect(end.cone.alpha).toBe(0);
    expect(end.holo.alpha).toBe(0);
  });

  it("flies the lead picture over 0-340 ms, trail ghosts a beat later", () => {
    const at = (ms: number) => dmBeats(sec(ms)).fliers;
    const [g2, g1, lead] = at(340);
    expect(lead.p).toBe(1);
    expect(g1.p).toBeLessThan(1);
    expect(g2.p).toBeLessThan(g1.p);
    expect(at(60)[2].p).toBeGreaterThan(0);
    // The flier is gone before the hologram has risen.
    for (const f of at(400)) expect(f.alpha).toBe(0);
  });

  it("forms three gold rings 70 ms apart", () => {
    const first = (i: number) => {
      for (let ms = 0; ms < 700; ms += 5) if (dmBeats(sec(ms)).rings[i]!.alpha > 0) return ms;
      return -1;
    };
    expect(first(0)).toBeGreaterThanOrEqual(140);
    expect(first(0)).toBeLessThan(160);
    expect(first(1) - first(0)).toBeGreaterThanOrEqual(60);
    expect(first(1) - first(0)).toBeLessThanOrEqual(80);
    expect(first(2) - first(1)).toBeGreaterThanOrEqual(60);
    // Fully grown by 640 ms.
    expect(dmBeats(sec(640)).rings[2]!.scale).toBeCloseTo(1, 1);
    // Rings and cone fade out in the 880-1150 window.
    expect(dmBeats(sec(880)).rings[1]!.alpha).toBeGreaterThan(0);
    expect(dmBeats(sec(1100)).rings[1]!.alpha).toBe(0);
    expect(dmBeats(sec(1150)).rings[0]!.alpha).toBe(0);
  });

  it("lifts the cone in 200-550 ms", () => {
    expect(dmBeats(sec(200)).cone.grow).toBe(0);
    expect(dmBeats(sec(550)).cone.grow).toBe(1);
    expect(dmBeats(sec(300)).cone.alpha).toBeGreaterThan(0.3);
  });

  it("builds the hologram in 300-700 ms, holds, then sinks onto the card", () => {
    expect(dmBeats(sec(300)).holo.reveal).toBe(0);
    expect(dmBeats(sec(700)).holo.reveal).toBe(1);
    expect(dmBeats(sec(780)).holo.sink).toBe(0);
    expect(dmBeats(sec(900)).holo.sink).toBe(1);
    expect(dmBeats(sec(840)).holo.sink).toBeGreaterThan(0);
    expect(dmBeats(sec(840)).holo.sink).toBeLessThan(1);
    expect(dmBeats(sec(750)).holo.rise).toBeGreaterThan(0.95);
    // Crossfade into the page card: fully visible until 900, gone by 1100.
    expect(dmBeats(sec(900)).holo.alpha).toBe(1);
    expect(dmBeats(sec(1000)).holo.alpha).toBeGreaterThan(0);
    expect(dmBeats(sec(1000)).holo.alpha).toBeLessThan(1);
    expect(dmBeats(sec(1100)).holo.alpha).toBe(0);
  });

  it("blips twice (700-740 and 800-830)", () => {
    expect(dmBeats(sec(720)).holo.glitch).toBe(1);
    expect(dmBeats(sec(815)).holo.glitch).toBe(1);
    expect(dmBeats(sec(760)).holo.glitch).toBe(0);
    expect(dmBeats(sec(600)).holo.glitch).toBe(0);
    expect(dmBeats(sec(850)).holo.glitch).toBe(0);
  });

  it("shows the page card at 900 ms and not before", () => {
    expect(dmBeats(sec(899)).settled).toBe(false);
    expect(dmBeats(sec(900)).settled).toBe(true);
  });

  it("keeps every value finite and every alpha inside 0..1 over the whole run", () => {
    for (let ms = -50; ms <= DM_TOTAL_MS + 100; ms += 7) {
      const b = dmBeats(sec(ms));
      const alphas = [...b.fliers.map((f) => f.alpha), ...b.rings.map((r) => r.alpha), b.disc, b.cone.alpha, b.holo.alpha];
      for (const a of alphas) { expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThanOrEqual(1); }
      for (const v of [b.holo.rise, b.holo.sink, b.holo.scale, b.holo.reveal, b.cone.grow, ...b.rings.map((r) => r.scale)]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("settles monotonically: once settled, always settled", () => {
    let seen = false;
    for (let ms = 0; ms <= DM_TOTAL_MS; ms += 5) {
      const s = dmBeats(sec(ms)).settled;
      if (seen) expect(s).toBe(true);
      seen ||= s;
    }
  });

  it("reduced motion: a ring and a glow for 320 ms, card shown at 100 ms", () => {
    expect(dmReducedBeats(0).ring).toBe(0);
    expect(dmReducedBeats(0.1).ring).toBeGreaterThan(0.9);
    expect(dmReducedBeats(sec(DM_REDUCED_MS)).ring).toBe(0);
    expect(dmReducedBeats(sec(DM_REDUCED_MS)).glow).toBe(0);
    expect(dmReducedBeats(0.099).settled).toBe(false);
    expect(dmReducedBeats(0.1).settled).toBe(true);
  });

  it("reads the table tilt", () => {
    expect(tiltRadOf(15)).toBeCloseTo((15 * Math.PI) / 180);
    expect(tiltRadOf(0)).toBe(0);
    expect(tiltRadOf(-5)).toBe(0);
    expect(tiltRadOf(Number.NaN)).toBe(0);
    expect(tiltRadOf(undefined)).toBe(0);
    expect(tiltRadOf(400)).toBeCloseTo((45 * Math.PI) / 180);
    expect(tiltDegOfCss("15deg")).toBe(15);
    expect(tiltDegOfCss(" 8deg")).toBe(8);
    expect(tiltDegOfCss("0deg")).toBe(0);
    expect(tiltDegOfCss("")).toBe(0);
    expect(tiltDegOfCss(null)).toBe(0);
  });
});
