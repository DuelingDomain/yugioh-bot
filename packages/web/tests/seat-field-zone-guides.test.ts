import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../src/components/duel/field.module.css"), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

// A zone of a 3 or 4 seat board is one card wide. The 1v1 monster zone draws a second, landscape guide and lays a
// defense card on its side at full size; in a seat that spills half a zone to both sides (a ghost grid over the
// monster row, and a sideways card over its neighbours).
describe("seat field zone guides", () => {
  it("draws no landscape guide on monster zones of a seat", () => {
    const hidden = rule(`.seatField .zone[data-kind="mz"] .zoneHit::before,\n.seatField .zone[data-kind="emz"] .zoneHit::before`);
    expect(hidden).toContain("content: none;");
  });

  it("keeps the landscape guide on the 1v1 monster zone", () => {
    const base = rule(`.zone[data-kind="mz"] .zoneHit::before,\n.zone[data-kind="emz"] .zoneHit::before`);
    expect(base).toContain('content: "";');
    expect(base).toContain("width: var(--z);");
  });

  it("shrinks a card in defense to the zone width", () => {
    const turned = rule(`.seatField .cardFace[data-defense="true"],\n.seatField .artWrap[data-defense="true"] > .cardBack`);
    expect(turned).toContain("transform: rotate(90deg) scale(var(--dfit));");
  });

  it("uses the same ratio as the zone width (--cw) for the fit", () => {
    const cw = /--cw:\s*calc\(var\(--z\)\s*\*\s*([\d.]+)\)/.exec(css.slice(css.indexOf("one seat of a 3 or 4 seat table")));
    const fit = /--dfit:\s*([\d.]+);/.exec(css);
    expect(cw).not.toBeNull();
    expect(fit).not.toBeNull();
    expect(Number(fit![1])).toBeCloseTo(Number(cw![1]), 3);
  });

  it("sizes the usable glow of a defense card to the turned card", () => {
    const glow = rule('.seatField .zone[data-defense="true"] .glow');
    expect(glow).toContain("var(--dfit)");
  });
});
