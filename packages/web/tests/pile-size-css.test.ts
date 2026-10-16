import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(__dirname, "../src/components/duel", file), "utf8");
const css = read("field.module.css");
const solid = read("solid/table.module.css");

// Deck, Extra Deck, GY, Banished and Field piles are drawn as big as a card on a zone (the owner asked for it), so the
// pile label cannot take room under the card: it sits on a plate over the card's edge.
describe("pile size", () => {
  it("draws piles at the zone card size on every board", () => {
    const pk = [...css.matchAll(/--pk:\s*([\d.]+);/g)].map((m) => m[1]);
    expect(pk.length).toBeGreaterThanOrEqual(3);
    expect(new Set(pk)).toEqual(new Set(["1"]));
  });

  it("puts the pile label on the card, not in its own row", () => {
    const start = css.indexOf("\n.pileLabel {");
    const label = css.slice(start, css.indexOf("}", start));
    expect(label).toContain("position: absolute;");
    expect(label).toContain("background:");
  });

  it("draws 3D piles at least as big as the zone card", () => {
    expect(solid).toContain("width: max(var(--cw), calc(var(--pile) * 0.8));");
  });
});
