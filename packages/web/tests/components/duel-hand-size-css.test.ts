import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../../src/components/duel/field.module.css"), "utf8");

// Your hand is drawn larger than the room its strip reserves, so it can rise over the front Spell/Trap row
// without shrinking the board. The size probe (FX landing) and the hover lift read --lh / --lhcw, the strip
// height reads --lh-rest. jsdom applies no CSS, so these tests read the stylesheet.
describe("your hand is drawn larger than the strip reserves", () => {
  it("draws the hand at the larger of the reserved size and about 0.95 zone heights (3D mode size)", () => {
    expect(css).toMatch(/--lh-k: 0\.95;/);
    expect(css).toMatch(/--lh-max: 150px;/);
    expect(css).toMatch(/--lh: max\(var\(--lh-rest\), min\(calc\(var\(--z\) \* var\(--lh-k\)\), var\(--lh-max\)\)\);/);
  });

  it("sizes the strip and its lift reserve from the reserved height, not the drawn height", () => {
    expect(css).toMatch(/--bot-res: calc\(var\(--lh-rest\)/);
    expect(css).toMatch(/--bot-h: max\(var\(--tally-h\), calc\(var\(--lh-rest\)/);
    expect(css).toMatch(/--bot-h: calc\(var\(--tally-h\) \+ var\(--gs\) \+ var\(--lh-rest\)/);
    expect(css).toMatch(/grid-template-rows: var\(--tally-h\) calc\(var\(--lh-rest\)/);
  });

  it("keeps the size probe and the hand cards on the drawn size", () => {
    expect(css).toMatch(/--lhcw: calc\(var\(--lh\) \* 0\.686\);/);
    expect(css).toMatch(/\.handSizeProbe\[data-side="you"\] \{\s*width: var\(--lhcw\);/);
    expect(css).toMatch(/\.handLocal \{\s*--cardw: var\(--lhcw\);/);
  });

  it("rests the HUD room hand low, but keeps the higher rest where there is no hover to lift it", () => {
    expect(css).toMatch(/\[data-hud="room"\]\) \.playmat \{[^}]*--lk: 0\.3;/);
    expect(css).toMatch(/@media \(hover: none\) \{\s*:global\(\[data-hud="room"\]\) \.playmat \{\s*--lk: 0\.45;/);
  });
});
