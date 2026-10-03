import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const file = path.resolve(__dirname, "../../../src/components/dashboard/dashboard.module.css");
const root = postcss.parse(readFileSync(file, "utf8"));

describe("dashboard responsive styles", () => {
  it("stacks the dashboard columns at a 900px sheet width with a selector stronger than the foundation", () => {
    let columns: string | undefined;
    root.walkAtRules("container", (query) => {
      if (query.params.replace(/\s/g, "") !== "(max-width:900px)") return;
      query.walkRules(":global(.ms) .cols:global(.db-cols)", (rule) => {
        rule.walkDecls("grid-template-columns", (decl) => { columns = decl.value; });
      });
    });
    expect(columns).toBe("minmax(0, 1fr)");
  });

  it("wraps dashboard row names between words with a selector stronger than the foundation", () => {
    let wrapping: string | undefined;
    root.walkRules(":global(.ms) .cols:global(.db-cols) :global(.db-row .nm)", (rule) => {
      rule.walkDecls("overflow-wrap", (decl) => { wrapping = decl.value; });
    });
    expect(wrapping).toBe("break-word");
  });
});
