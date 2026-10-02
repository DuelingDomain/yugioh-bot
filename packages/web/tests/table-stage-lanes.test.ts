import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../src/components/duel/table/table-stage.module.css"), "utf8");

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
    const rule = css.match(/\[data-slot="fx"\] :global\(\[data-chain-panel\]\)\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/align-self:\s*flex-start/);
    expect(rule![1]).toMatch(/max-height:\s*\d+%/);
  });
});
