import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { picksExtraZone } from "../src/components/duel/table/grid-stage";

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

describe("4-way grid: the phase hub yields to an Extra Monster Zone target", () => {
  it("finds an Extra Monster Zone key (monster zone, sequence 5 or 6)", () => {
    expect(picksExtraZone(["0:4:5"])).toBe(true);
    expect(picksExtraZone(new Set(["2:4:6"]))).toBe(true);
    expect(picksExtraZone(["0:4:4", "0:8:5", "0:2:6"])).toBe(false);
    expect(picksExtraZone([])).toBe(false);
  });

  it("makes the hub click-through while such a zone is a target", () => {
    expect(grid).toMatch(/\.board\[data-emz-pick="true"\] \.hub,\s*\.board\[data-emz-pick="true"\] \.hub \* \{\s*pointer-events: none;/);
  });
});

describe("4-way HUD: the prompt dock stays in the corner column", () => {
  const shell = readFileSync(join(__dirname, "../src/components/duel/table/table-shell.module.css"), "utf8");
  it("is as wide as the column and grows to the left only for a long prompt", () => {
    expect(shell).toMatch(
      /\.hudPrompt\[data-mode="flow"\] \{[^}]*width: max-content;\s*min-width: 100%;\s*max-width: min\(380px, 34vw\);[^}]*pointer-events: auto;/,
    );
  });
});
