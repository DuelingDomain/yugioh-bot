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

  it("moves the chain stack up so it never crosses that lane", () => {
    // The stack is portaled out of the fx slot, so its lane rule lives with the chain layer, not the table slot.
    expect(css).not.toMatch(/data-chain-panel/);
    const rule = chainCss.match(/\.front\[data-table\] \.panel\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/align-self:\s*flex-start/);
    expect(rule![1]).toMatch(/max-height:\s*\d+%/);
  });

  it("keeps rival hand backs off the top row of the rival field, on a table stage only", () => {
    const rule = css.match(/\.board :global\(\[data-hand-seat\]\[data-side="opp"\]\)\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/translate:\s*-50%\s*-[0-9]%/);
    const shared = readFileSync(join(__dirname, "../src/components/duel/table/rival-hand.module.css"), "utf8");
    expect(shared).toMatch(/translate:\s*-50%\s*-38%/);
  });
});
