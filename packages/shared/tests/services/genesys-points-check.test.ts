import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareGenesysPoints } from "../../src/maintenance/check-genesys-points.js";

const official = JSON.parse(readFileSync(new URL("../fixtures/genesys-official-2026-10-05.json", import.meta.url), "utf8")) as Record<string, number>;
const card = (name: string, points: number, id = 1) => ({ id, name, points, artworkIds: [id] });

describe("official Genesys points comparison", () => {
  it.each([14_614, 14_541])("checks a %s-row saved response before operator approval", count => {
    const directory = mkdtempSync(join(tmpdir(), "genesys-check-"));
    try {
      const entries = Object.entries(official);
      const path = join(directory, "snapshot.json");
      writeFileSync(path, JSON.stringify({ data: Array.from({ length: count }, (_, index) => ({
        id: index + 1, name: entries[index]?.[0] ?? `Zero card ${index}`,
        misc_info: [entries[index] ? { genesys_points: entries[index][1] } : {}], card_images: [{ id: index + 1 }],
      })) }));
      const check = () => execFileSync(process.execPath, ["--import", "tsx",
        fileURLToPath(new URL("../../src/maintenance/check-genesys-points.ts", import.meta.url)), "--api-snapshot", path],
      { encoding: "utf8", stdio: "pipe" });
      if (count === 14_614) {
        expect(JSON.parse(check())).toMatchObject({
          revision: "tcg-sha256-e2f9c29e9589771fd6f613c4b9d617ce86529f1d5aed548e97c7ed19d490977b",
          checked: 750, missingCards: [], unexpectedCards: [], pointMismatches: [],
        });
      } else expect(check).toThrow(/incomplete card list/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("uses the complete 750-card Konami baseline", () => {
    expect(Object.keys(official)).toHaveLength(750);
    const cards = Object.entries(official).map(([name, points], index) => card(name, points, index + 1));
    expect(compareGenesysPoints(cards, official)).toEqual({ checked: 750, nameMismatches: [], pointMismatches: [], missingCards: [], unexpectedCards: [] });
  });

  it("reports both verified spelling differences without hiding their points", () => {
    const expected = { "Stellarnova Binding": official["Stellarnova Binding"], "Exstellarknight Constellar Ptolemy O7": official["Exstellarknight Constellar Ptolemy O7"] };
    const report = compareGenesysPoints([card("Stellarnova Bonds", 3), card("Exstellarknight Constellar Ptolemy Ω7", 5, 2)], expected);
    expect(report.nameMismatches).toEqual([
      { officialName: "Stellarnova Binding", sourceName: "Stellarnova Bonds" },
      { officialName: "Exstellarknight Constellar Ptolemy O7", sourceName: "Exstellarknight Constellar Ptolemy Ω7" },
    ]);
    expect(report.checked).toBe(2);
    expect(report.pointMismatches).toEqual([]);
    expect(report.missingCards).toEqual([]);
    expect(report.unexpectedCards).toEqual([]);
  });

  it("reports wrong values, missing cards, new pointed cards and aliases with wrong points", () => {
    const report = compareGenesysPoints([card("A Hero Lives", 20), card("Stellarnova Bonds", 8, 2), card("New Card", 4, 3), card("Zero Card", 0, 4)],
      { "A Hero Lives": 30, "Stellarnova Binding": 3, "Missing Card": 5 });
    expect(report.pointMismatches).toEqual([
      { officialName: "A Hero Lives", sourceName: "A Hero Lives", expected: 30, actual: 20 },
      { officialName: "Stellarnova Binding", sourceName: "Stellarnova Bonds", expected: 3, actual: 8 },
    ]);
    expect(report.missingCards).toEqual(["Missing Card"]);
    expect(report.unexpectedCards).toEqual(["New Card"]);
  });
});
