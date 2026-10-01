import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { itWithCores, needs } from "./support/cores.js";
import { loadOwners, ownerOf, ownersOf, parseOwners, siteFromText, UNOWNED } from "../scripts/lib/owners.js";

const rows = loadOwners();
const CENSUS = resolve(__dirname, "../../../.status/nduel-census-B2.json");

describe("owners.tsv", () => {
  it("parses every row and every tag looks like a task tag", () => {
    expect(rows.length).toBeGreaterThan(40);
    for (const row of rows) expect(row.tag).toMatch(/^[A-Z][A-Z0-9]*$/);
  });

  it("rejects a bad row", () => {
    expect(() => parseOwners("a.cpp\t*\tx-y\tT3")).toThrow(/lines/);
    expect(() => parseOwners("a.cpp\t*")).toThrow(/need/);
    expect(parseOwners("# comment\n\n")).toEqual([]);
  });

  it("owns a site by function", () => {
    expect(ownerOf({ file: "playerop.cpp", line: 482, fn: "field::process(SelectChain)" }, rows)).toBe("T3");
    expect(ownerOf({ file: "field.cpp", fn: "field::filter_affected_cards", line: 1560 }, rows)).toBe("F02");
    expect(ownerOf({ file: "operations.cpp", fn: "field::process(ChangePos)", line: 5231 }, rows)).toBe("T8");
    expect(ownerOf({ file: "effect.cpp", fn: "effect::is_activateable" }, rows)).toBe("F6");
    expect(ownerOf({ file: "libduel.cpp", fn: "lua:NegateSummon" }, rows)).toBe("F6");
  });

  it("owns a site by line range when it has no function, and uses the file base name", () => {
    expect(ownerOf({ file: "/tmp/tree/processor.cpp", line: 4974 }, rows)).toBe("T4");
    expect(ownerOf({ file: "processor.cpp", line: 4956 }, rows)).toBe("T5B");
    expect(ownerOf({ file: "operations.cpp", line: 1205 }, rows)).toBe("T9");
    expect(ownerOf({ file: "operations.cpp", line: 1210 }, rows)).toBe("T8");
  });

  it("lists every candidate, most specific first", () => {
    expect(ownersOf({ file: "operations.cpp", line: 1205 }, rows)).toEqual(["T9", "T8"]);
  });

  it("gives UNOWNED to an unknown site", () => {
    expect(ownerOf({ file: "processor.cpp", fn: "field::process(IdleCommand)", line: 1610 }, rows)).toBe(UNOWNED);
    expect(ownerOf({ file: "nothing.cpp", line: 1 }, rows)).toBe(UNOWNED);
    expect(ownerOf({ file: "processor.cpp", line: 1087 }, rows)).toBe(UNOWNED);
  });

  it("finds a site in a trap or sanitizer line", () => {
    expect(siteFromText("runtime error at tree/processor.cpp:1087:27: index 255")).toEqual({ file: "processor.cpp", line: 1087 });
    expect(siteFromText("no site here")).toBeNull();
  });

  itWithCores("places the census sites of B2 (test data)", needs.localFile("B2 census file (.status, gitignored, not a core)", CENSUS, "Run the nduel census for B2 to write it."), () => {
    const census = JSON.parse(readFileSync(CENSUS, "utf8")) as { census: Array<{ file: string; line: number; fn: string }> };
    const owners = census.census.map((site) => [`${site.file}:${site.line}`, ownerOf(site, rows)] as const);
    const by = new Map(owners);
    expect(by.get("playerop.cpp:482")).toBe("T3");
    expect(by.get("processor.cpp:308")).toBe("T3");
    expect(by.get("field.cpp:1560")).toBe("F02");
    expect(by.get("field.cpp:1645")).toBe("F02");
    expect(by.get("operations.cpp:5231")).toBe("T8");
    expect(by.get("libduel.cpp:900")).toBe("F3");
    // Sites that no brief names stay visible.
    expect(by.get("processor.cpp:1639")).toBe(UNOWNED);
    expect(by.get("field.cpp:687")).toBe(UNOWNED);
  });
});
