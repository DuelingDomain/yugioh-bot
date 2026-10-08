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

  it("draws the rival's HUD room hand about 30% larger and keeps its peek under the header pills", () => {
    // 0.47 / 0.36 = 1.31 times the old backs. The part above the board (--ohk x --top-hide = 0.18 zone) is what it was
    // (0.36 x 0.5), so the cards grow downward into the strip the LP tally holds open and never reach the pills.
    const hud = /\[data-hud="room"\]\) \.playmat \{([^}]*)\}/.exec(css)?.[1] ?? "";
    const ohk = Number(/--ohk: ([\d.]+);/.exec(hud)?.[1]);
    const hide = Number(/--top-hide: ([\d.]+);/.exec(hud)?.[1]);
    expect(ohk / 0.36).toBeGreaterThanOrEqual(1.25);
    expect(ohk / 0.36).toBeLessThanOrEqual(1.4);
    expect(ohk * hide).toBeLessThanOrEqual(0.36 * 0.5 + 0.005);
    // The layout reserve (--ohkr = ohk x (1 - hide + 0.05)) stays near the old 0.198, so the board frame does not shrink.
    expect(ohk * (1 - hide + 0.05)).toBeLessThanOrEqual(0.33);
  });
  it("draws your 3-way hand about 1.45x larger than before, on a tall table only, and keeps its element honest", () => {
    // The 3-way stage (not the phone layout) sets the size of your seat field: 1.1 zone heights (was 0.76).
    const block = /:global\(\[data-table-stage="ffa3"\]:not\(\[data-portrait\]\)\) \.seatField \{([^}]*)\}/.exec(css)?.[1] ?? "";
    const lh = Number(/--lh: calc\(var\(--z\) \* ([\d.]+)\);/.exec(block)?.[1]);
    expect(lh).toBeGreaterThanOrEqual(1.0);
    expect(lh).toBeLessThanOrEqual(1.15);
    // It rises over the field's bottom pad (0.125 zone) only, so no zone is covered at rest.
    const rise = Number(/--hand-rise: calc\(var\(--z\) \* ([\d.]+)\);/.exec(block)?.[1]);
    expect(rise).toBeGreaterThan(0);
    expect(rise).toBeLessThanOrEqual(0.125);
    // The strip box is as tall as the cards, the lift and the tag need; real sizes, never a transform on the strip.
    const strip = /:global\(\[data-table-stage="ffa3"\]:not\(\[data-portrait\]\)\) \.sfHand \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(strip).toMatch(/height: calc\(var\(--lh\) \* 1\.12 \+ 6px\);/);
    expect(strip).not.toMatch(/transform|scale|translate/);
    // The hover zoom reads one variable (2x elsewhere); the 3-way table zooms less because its card is already larger.
    expect(css.match(/scale\(var\(--hand-hover, 2\)\)/g)).toHaveLength(3);
    expect(Number(/--hand-hover: ([\d.]+);/.exec(block)?.[1])).toBeGreaterThanOrEqual(1.5);
    // The 4-way grid keeps its own size (--sf-lh) and the default hand stays 0.76.
    expect(css).toMatch(/--lh: var\(--sf-lh, calc\(var\(--z\) \* 0\.76\)\);/);
  });
  it("spreads the wide 3-way hand over 6.8 zone sizes and moves your name label off it", () => {
    // The wide field (data-def-full) is 7.4 zone sizes across, so 6.8 fits inside it; other fields keep the 5.4 default.
    expect(css).toMatch(/\[data-def-full\]\) \.seatField \{\s*--hand-w: 6\.8;/);
    expect(css.match(/--hand-w: [\d.]+;/g)).toEqual(["--hand-w: 6.8;"]);
    expect(css).toMatch(/\.seatField\[data-side="you"\] \.sfName \{\s*left: 0;\s*translate: calc\(-100% - var\(--z\) \* 0\.1\) 100%;/);
  });
});
