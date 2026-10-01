import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRows, parseAdrRules, parseRuleDeclarations, renderTable, unknownRules } from "../scripts/rule-coverage.js";

const adr = [
  "## Common",
  "",
  "- `[R-COMMON-A]` **Alpha.** First rule.",
  "- Bullet with no id.",
  "- `[R-TAG-B-2]` Second rule | with a pipe.",
  "  - `[R-FFA-NESTED]` not a top-level bullet.",
  "- `[R-FFA-C]` Third rule.",
].join("\n");

describe("rule coverage parser", () => {
  it("reads the ids and the text of the rule bullets", () => {
    const rules = parseAdrRules(adr);
    expect(rules.map((r) => r.id)).toEqual(["R-COMMON-A", "R-TAG-B-2", "R-FFA-C"]);
    expect(rules[0]!.title).toBe("Alpha. First rule.");
  });

  it("reads the real ADR and finds every id once", () => {
    const real = parseAdrRules(
      readFileSync(new URL("../../../docs/adr/0002-multiplayer-duel-rules.md", import.meta.url), "utf8"),
    );
    expect(real.length).toBeGreaterThanOrEqual(25);
    expect(new Set(real.map((r) => r.id)).size).toBe(real.length);
  });

  it("finds the ids in rules arrays only", () => {
    const source = `const a = { rules: ["R-COMMON-A", 'R-TAG-B-2'], x: 1 };\nconst b = "R-FFA-C";\nrules:[\`R-FFA-C\`]`;
    expect(parseRuleDeclarations(source).sort()).toEqual(["R-COMMON-A", "R-FFA-C", "R-TAG-B-2"]);
  });

  it("sets the status of each rule", () => {
    const rules = parseAdrRules(adr);
    const rows = buildRows(rules, [
      { rule: "R-COMMON-A", ref: { test: "t.test.ts", pending: false } },
      { rule: "R-COMMON-A", ref: { test: "mp-1", pending: true } },
      { rule: "R-TAG-B-2", ref: { test: "mp-2", pending: true } },
    ]);
    expect(rows.map((r) => r.status)).toEqual(["covered", "pending only", "none"]);
    const table = renderTable(rows, 2);
    expect(table).toContain("1 covered, 1 pending only, 1 none. 2 catalog entries");
    expect(table).toContain("with a pipe");
    expect(table).toContain("`mp-2` (pending)");
  });

  it("reports unknown ids", () => {
    expect(unknownRules(["R-COMMON-A"], [{ rule: "R-COMMON-A" }, { rule: "R-FFA-X" }, { rule: "R-FFA-X" }])).toEqual(["R-FFA-X"]);
  });
});
