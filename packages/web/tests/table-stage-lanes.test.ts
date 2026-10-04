import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../src/components/duel/table/table-stage.module.css"), "utf8");
const chainCss = readFileSync(join(__dirname, "../src/components/duel/chain-fx.module.css"), "utf8");

describe("table stage lanes", () => {
  it("puts the yes/no prompt bar in the lower-left lane, out of the middle", () => {
    const rule = css.match(/\[data-slot="prompt"\] :global\(\[data-prompt-panel\]\[data-precheck\]\)\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/top:\s*auto/);
    expect(rule![1]).toMatch(/left:\s*[\d.]+%/);
    expect(rule![1]).toMatch(/bottom:\s*[\d.]+%/);
    expect(rule![1]).toMatch(/translate:\s*none/);
  });

  it("keeps the chain out of that lane: a table shows the strip in the top left corner, never the tall panel", () => {
    // The chain is portaled out of the fx slot, so its placement lives with the chain layer, not the table slot.
    expect(css).not.toMatch(/data-chain-panel/);
    const source = readFileSync(join(__dirname, "../src/components/duel/chain-fx.tsx"), "utf8");
    expect(source).toMatch(/chainPanelForm\(gutter, previous, table != null \|\| phone \|\| blocked\)/);
    const dock = chainCss.match(/\.front\[data-size="strip"\] \.dock\s*\{([^}]*)\}/);
    expect(dock).not.toBeNull();
    expect(dock![1]).toMatch(/inset:\s*var\(--chain-dock-top, 4px\) auto auto/);
    expect(chainCss).not.toMatch(/data-table="ffa3"\] \.panel/);
  });

  it("keeps rival hand backs off the top row of the rival field, on a table stage only", () => {
    const rule = css.match(/\.board :global\(\[data-hand-seat\]\[data-side="opp"\]\)\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/translate:\s*-50%\s*-[0-9]%/);
    const shared = readFileSync(join(__dirname, "../src/components/duel/table/rival-hand.module.css"), "utf8");
    expect(shared).toMatch(/translate:\s*-50%\s*-38%/);
  });
});
