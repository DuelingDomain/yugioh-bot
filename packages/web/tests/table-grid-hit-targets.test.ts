import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Owner rule for the 4-way grid: your hand may lie a little over your field, but one click never meets a hand card and
// a zone at once, and a field target wins during a zone or card pick. jsdom applies no CSS, so these tests read the
// stylesheets; the hit tests themselves ran in a browser (elementFromPoint at 1920x1080, 1280x800 and 1024x768).
const field = readFileSync(join(__dirname, "../src/components/duel/field.module.css"), "utf8");
const grid = readFileSync(join(__dirname, "../src/components/duel/table/grid-stage.module.css"), "utf8");

describe("4-way grid: your hand never blocks your Spell/Trap row", () => {
  it("lets clicks through the empty hand lane and gives the pointer back only to the cards", () => {
    expect(field).toMatch(/:global\(\[data-grid-stage\]\) \.sfHand \{\s*pointer-events: none;/);
    expect(field).toMatch(/:global\(\[data-grid-stage\]\) \.sfHand \.handCard \{\s*pointer-events: auto;/);
  });

  it("keeps the visible rest lift of a legal or selected card on that card", () => {
    expect(field).toMatch(
      /\.sfHand \.handLocal \.handCard \.zone\[data-legal="true"\] \.zoneHit::before,\s*:global\(\[data-grid-stage\]\) \.sfHand \.handLocal \.handCard \.zone\[data-selected="true"\] \.zoneHit::before \{[^}]*bottom: 100%;[^}]*height: calc\(var\(--lh\) \* 0\.05\);/,
    );
    expect(field).toMatch(/\.zone\[data-selected="true"\] \.zoneHit::before \{\s*height: calc\(var\(--lh\) \* 0\.12\);/);
  });

  it("makes the whole hand click-through in a field pick, stronger than the rule that gives the cards the pointer", () => {
    expect(grid).toMatch(
      /\.board\.board\[data-pick-kind="field"\] :global\(\[data-hand-seat\]\),\s*\.board\.board\[data-pick-kind="field"\] :global\(\[data-hand-seat\]\) \*,\s*\.board\.board\[data-pick-kind="field"\] :global\(\[data-hand-seat\]\) \*::before \{\s*pointer-events: none;/,
    );
  });
});
