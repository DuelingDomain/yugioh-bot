import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bandHubFit } from "../src/components/duel/phase-hub-model";

// Owner rule for the 4-way grid: your hand may lie a little over your field, but one click never meets a hand card and
// a zone at once, and a field target wins during a zone or card pick. The phase hub never lies over a zone. jsdom applies no CSS, so these tests read the
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

describe("4-way grid: the phase hub sits in the free cells beside the Extra Monster Zones, never over them", () => {
  const hub = readFileSync(join(__dirname, "../src/components/duel/phase-hub.module.css"), "utf8");
  // A cell of the band: the five monster columns (3.73 z wide), 0.075 z apart.
  const cellOf = (z: number) => (3.7303 * z - 4 * 0.075 * z) / 5;

  it("keeps every pair inside its cell and inside the row, side by side or stacked", () => {
    for (let z = 40; z <= 240; z += 0.5) {
      const cell = cellOf(z);
      const fit = bandHubFit(z, cell);
      if (fit.mode === "row") {
        expect(fit.chip * 3.02 + 4, `row z=${z}`).toBeLessThanOrEqual(cell);
        expect(fit.chip + 42, `row text z=${z}`).toBeLessThanOrEqual(z);
        expect(fit.chip).toBeGreaterThanOrEqual(24);
      } else {
        expect(fit.chip * 1.3 + 4, `stack z=${z}`).toBeLessThanOrEqual(cell);
        expect(fit.chip * 2.2 + 4, `stack z=${z}`).toBeLessThanOrEqual(z);
      }
    }
  });

  it("puts a pair side by side on a large board and stacks it on a small one", () => {
    expect(bandHubFit(133.56, cellOf(133.56))).toEqual({ mode: "row", chip: 29 });
    expect(bandHubFit(82.69, cellOf(82.69))).toEqual({ mode: "stack", chip: 24 });
    expect(bandHubFit(58.8, cellOf(58.8))).toEqual({ mode: "stack", chip: 22 });
  });

  it("gives a 1v1-wide cell the 1v1 chip", () => {
    expect(bandHubFit(152, 152)).toEqual({ mode: "row", chip: 38 });
  });

  it("takes the chip size from the grid, breaks the hairline at the zones and drops the text lines when stacked", () => {
    expect(hub).toMatch(/--hc: var\(--hub-hc, clamp\(26px, calc\(var\(--hub-z\) \* 0\.28\), 38px\)\);/);
    expect(hub).toMatch(/:global\(\[data-hub-fit\]\) \.line,\s*:global\(\[data-hub-fit\]\) \.cell\[data-cell\] \.pair::before \{\s*display: none;/);
    expect(hub).toMatch(/:global\(\[data-hub-fit="stack"\]\) \.pair \{\s*flex-direction: column;/);
    expect(hub).toMatch(/:global\(\[data-hub-fit="stack"\]\) \.owner,\s*:global\(\[data-hub-fit="stack"\]\) \.under \{\s*display: none;/);
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
