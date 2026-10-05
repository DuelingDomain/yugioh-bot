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

  it("keeps the HUD room hand inside its strip so it barely reaches the Spell/Trap row", () => {
    // --lk 0.89 + the 0.95 drawn size leave a small part of a zone height of overlap; no lift reserve (cards that lift
    // rise over the row), and the strip has no bottom reserve because the room has no station track.
    expect(css).toMatch(/\[data-hud="room"\]\) \.playmat \{[^}]*--lk: 0\.89;/);
    expect(css).toMatch(/\[data-hud="room"\]\) \.playmat \{[^}]*--lift-k: 0;[^}]*--mark-k: 0;/);
    expect(css).not.toMatch(/@media \(hover: none\) \{\s*:global\(\[data-hud="room"\]\)/);
  });

  it("lets only the resting box of a HUD room hand card take the pointer, never the grown hover picture", () => {
    // The hover grows the card over the Spell/Trap row; that picture must not steal a click meant for a zone.
    expect(css).toMatch(/:global\(\[data-hud="room"\]\) \.handLocal \.handCard \.frame \{\s*pointer-events: none;/);
    // A legal or selected card rests a little higher than its box: a strip above the box keeps that edge on the card.
    expect(css).toMatch(/\.zone\[data-legal="true"\] \.zoneHit::before,[^{]*\.zone\[data-selected="true"\] \.zoneHit::before \{[^}]*bottom: 100%;[^}]*height: calc\(var\(--lh\) \* 0\.05\);/);
    expect(css).toMatch(/\.zone\[data-selected="true"\] \.zoneHit::before \{\s*height: calc\(var\(--lh\) \* 0\.12\);/);
  });
});
