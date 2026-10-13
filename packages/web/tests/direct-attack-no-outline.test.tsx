// @vitest-environment jsdom
// A direct attack takes damage on the LP plate and shows a burst at the impact point. No box is drawn around the
// defender's row of Monster Zones (no ring, no wash): the strike styles, the reduced-motion play and the 3D beats.
import { afterEach, describe, expect, it } from "vitest";
import { runAttackFx, type AttackFxPlan, type FxSide } from "@/components/duel/attack-fx";
import { TINTS, type AttackStyleId } from "@/components/duel/attack-styles";

const STYLES: AttackStyleId[] = ["slash", "claw", "beam", "arcane", "lightning", "flame", "impact"];
const CLS = { veil: "veil", frags: "frags", piece: "piece", inner: "inner", caption: "caption", lpFlash: "lpFlash" };
const ROW = { left: 500, top: 80, width: 300, height: 70 };
const PLATE = { left: 40, top: 700, width: 120, height: 40 };

const side = (style: AttackStyleId, left: number, top: number): FxSide => ({
  box: { left, top, width: 60, height: 84 }, el: null, style, tint: TINTS.VIOLET, caption: null, cut: null,
});

const planOf = (style: AttackStyleId, over: Partial<AttackFxPlan>): AttackFxPlan => ({
  reduced: false, kind: "win", attacker: side(style, 300, 500), defender: null, hit: ROW, defenderInDefense: false,
  lpHits: [{ box: PLATE, at: 400, toAttacker: false }], seed: 7,
  timing: { impactMs: 400, attackerDamageMs: 400, targetBreakMs: null, attackerBreakMs: null, totalMs: 1500 } as AttackFxPlan["timing"],
  ...over,
});

/** Run a plan and list what is drawn: svg rects and veils (a filled box), and whether the red LP flash is there. */
function draw(plan: AttackFxPlan) {
  const html = document.createElement("div");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  document.body.append(html, svg);
  const stop = runAttackFx(html, svg, plan, CLS);
  const rects = [...svg.querySelectorAll("rect")].map((r) => ({
    x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")), w: Number(r.getAttribute("width")), h: Number(r.getAttribute("height")),
  }));
  const veils = [...html.querySelectorAll(".veil")].map((v) => v as HTMLElement);
  const lpFlash = html.querySelectorAll(".lpFlash").length;
  const radii = [...svg.querySelectorAll("circle")].map((c) => Number(c.getAttribute("r")));
  const circles = radii.length;
  stop();
  return { rects, veils, lpFlash, circles, radii };
}

/** The rect wraps the row: it starts at or before the row's corner and ends at or after the other one. */
const wrapsRow = (r: { x: number; y: number; w: number; h: number }) =>
  r.x <= ROW.left && r.y <= ROW.top && r.x + r.w >= ROW.left + ROW.width && r.y + r.h >= ROW.top + ROW.height;
const veilOnRow = (v: HTMLElement) => parseFloat(v.style.left) === ROW.left && parseFloat(v.style.top) === ROW.top;

afterEach(() => { document.body.innerHTML = ""; });

describe("a direct hit draws no outline around the defender's row", () => {
  it.each(STYLES)("%s: no rect and no wash on the row, a burst at the impact, the LP flash on the plate", (style) => {
    const out = draw(planOf(style, {}));
    expect(out.rects.filter(wrapsRow)).toEqual([]);
    expect(out.veils.filter(veilOnRow)).toEqual([]);
    expect(out.circles).toBeGreaterThan(0);
    expect(out.lpFlash).toBe(1);
  });

  // The row is wide: a disc sized by its width would cover the board. The disc grows 1.6x, so keep it well inside the row's height.
  it.each(STYLES)("%s: the burst disc stays within the row's height (full, reduced and 3D)", (style) => {
    for (const over of [{}, { reduced: true }, { layer3d: true }] as Array<Partial<AttackFxPlan>>) {
      const { radii } = draw(planOf(style, over));
      expect(radii.length).toBeGreaterThan(0);
      for (const r of radii) expect(r * 1.6).toBeLessThanOrEqual(ROW.height);
    }
  });

  it.each(STYLES)("%s, reduced motion: no rect and no wash on the row", (style) => {
    const out = draw(planOf(style, { reduced: true }));
    expect(out.rects.filter(wrapsRow)).toEqual([]);
    expect(out.veils.filter(veilOnRow)).toEqual([]);
    expect(out.circles).toBeGreaterThan(0);
  });

  it.each(STYLES)("%s, 3D layer: no rect on the row", (style) => {
    const out = draw(planOf(style, { layer3d: true }));
    expect(out.rects.filter(wrapsRow)).toEqual([]);
    expect(out.circles).toBeGreaterThan(0);
  });

  it("still rings a card that is hit (the check can see a ring)", () => {
    const defender = side("slash", 520, 90);
    const out = draw(planOf("slash", { defender, hit: defender.box }));
    expect(out.rects.some((r) => r.x <= defender.box.left && r.x + r.w >= defender.box.left + defender.box.width)).toBe(true);
  });
});
