import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The grid stage keeps no values only to silence the unused-variable check.
describe("grid-stage source", () => {
  it("has no `void name;` statements that only mark a value as used", () => {
    const source = readFileSync(join(__dirname, "../src/components/duel/table/grid-stage.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*void [A-Za-z_$][\w$]*;\s*$/m);
  });
});
