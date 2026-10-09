import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCardList, LIST_MAX_CHARS } from "@/lib/card-list-parser";

describe("parseCardList", () => {
  it.each(["3 Dark Hole", "3x Dark Hole", "x3 Dark Hole", "Dark Hole x3", "Dark Hole (x3)"])("parses %s", (text) => {
    expect(parseCardList(text)).toMatchObject([{ query: "Dark Hole", copies: 3, pool: "main", original: text }]);
  });

  it("parses names and counted or bare passcodes without expanding copies", () => {
    expect(parseCardList("Dark Hole\n44095762\n3 44095762").map(({ query, copies }) => [query, copies])).toEqual([
      ["Dark Hole", 1], [44095762, 1], [44095762, 3],
    ]);
  });

  it("handles BOM, CRLF, comments, notes, curly quotes and headers without discarding titles", () => {
    const entries = parseCardList('\uFEFF// comment\r\n#comment\r\n\r\nEngines\r\n4 Gravekeeper’s Spy\r\nMaxx “C”\r\nExtra Deck:\r\nShooting Star Dragon (Soul-Linked to Quasar)\r\n#main\r\nDark Hole (x3) (note)\r\n#extra\r\nDark Hole\r\n!side\r\nDark Hole');
    expect(entries.map(({ query, copies, pool }) => [query, copies, pool])).toEqual([
      ["Engines", 1, "main"], ["Gravekeeper’s Spy", 4, "main"], ['Maxx “C”', 1, "main"],
      ["Shooting Star Dragon", 1, "extra"], ["Dark Hole", 3, "main"], ["Dark Hole", 1, "extra"], ["Dark Hole", 1, "main"],
    ]);
  });

  it("strips a trailing [Extra] or [Main] marker and files the line in that pool", () => {
    const entries = parseCardList("3 Dark Hole [Main]\n1 Shooting Star Dragon [Extra]\nGaia Drake, the Universal Force x2 [extra]\nMain:\n1 Dark Magician [extra deck]\nExtra:\n2 Cyber Dragon [Main]");
    expect(entries.map(({ query, copies, pool }) => [query, copies, pool])).toEqual([
      ["Dark Hole", 3, "main"], ["Shooting Star Dragon", 1, "extra"], ["Gaia Drake, the Universal Force", 2, "extra"],
      ["Dark Magician", 1, "extra"], ["Cyber Dragon", 2, "main"],
    ]);
    expect(parseCardList("[Extra]")).toEqual([]);
  });

  it("strips the marker when a note or a count follows it", () => {
    const entries = parseCardList("Dark Hole [Extra] (note)\nDecode Talker [Extra] x2\nCyber Dragon [Extra] (x3)\nGaia Drake [Main] (old) [Extra]\n2 Rescue Rabbit [Extra] (note)");
    expect(entries.map(({ query, copies, pool }) => [query, copies, pool])).toEqual([
      ["Dark Hole", 1, "extra"], ["Decode Talker", 2, "extra"], ["Cyber Dragon", 3, "extra"], ["Gaia Drake", 1, "extra"], ["Rescue Rabbit", 2, "extra"],
    ]);
  });

  it("marks counted lines so section titles and prose do not use the lookup budget first", () => {
    const entries = parseCardList("Engines\n3 Dark Hole\nDark Hole x2\nFlip Notes");
    expect(entries.map(({ query, counted }) => [query, counted ?? false])).toEqual([
      ["Engines", false], ["Dark Hole", true], ["Dark Hole", true], ["Flip Notes", false],
    ]);
  });

  it("reuses YDK parsing for main, extra, side and deckmaster", () => {
    expect(parseCardList("#created by owner\n#main\n44095762\n44095762\n#extra\n44508094\n!side\n53129443\n#deckmaster\n89631139")
      .map(({ query, copies, pool }) => [query, copies, pool])).toEqual([
      [44095762, 1, "main"], [44095762, 1, "main"], [44508094, 1, "extra"], [53129443, 1, "main"], [89631139, 1, "main"],
    ]);
    expect(() => parseCardList("#deckmaster\n1\n#deckmaster\n2")).toThrow(/multiple/);
    expect(() => parseCardList("#deckmaster\nnope")).toThrow(/Invalid Deck Master/);
  });

  it("treats #side as main consistently in passcode and name lists", () => {
    expect(parseCardList("#main\n1\n#extra\n2\n#side\n3").map(({ query, pool }) => [query, pool])).toEqual([
      [1, "main"], [2, "extra"], [3, "main"],
    ]);
  });

  it("does not treat a card before a section header as a duplicate document label", () => {
    const entries = parseCardList("Last updated: Oct 4th\nCurrent Size: 3\n\n\nDark Hole\n#extra\n2 Dark Hole");
    expect(entries.filter((entry) => entry.heading)).toEqual([]);
  });

  it("reuses ydke links, including extra and side", () => {
    const encode = (code: number) => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(code); return bytes.toString("base64"); };
    expect(parseCardList(`ydke://${encode(44095762)}!${encode(44508094)}!${encode(53129443)}!`)
      .map(({ query, pool }) => [query, pool])).toEqual([[44095762, "main"], [44508094, "extra"], [53129443, "main"]]);
    expect(() => parseCardList("ydke://%%%!!!")).toThrow();
  });

  it("parses the trimmed real Google Doc export, retaining headings and all four typos", () => {
    const entries = parseCardList(readFileSync(new URL("./fixtures/cube-list.txt", import.meta.url), "utf8"));
    const cards = entries.filter((entry) => /^\d+ /.test(entry.original));
    expect(cards).toHaveLength(13);
    expect(cards.reduce((sum, entry) => sum + entry.copies, 0)).toBe(37);
    expect(entries.filter((entry) => !/^\d+ /.test(entry.original)).map((entry) => entry.query)).toEqual([
      "Engines", "Flip.dek", "Chaos Dragon", "Artifact", "Glue",
    ]);
    expect(cards.map((entry) => entry.query)).toContain("Shooting Star Dragon");
  });

  it("enforces input and distinct limits before any resolution", () => {
    expect(() => parseCardList("x".repeat(LIST_MAX_CHARS + 1))).toThrow(/large/);
    expect(() => parseCardList(Array.from({ length: 1001 }, (_, i) => `Card ${i}`).join("\n"))).toThrow(/1000/);
    expect(parseCardList("Dark Hole\ndark-hole\nDark Hole x3")).toHaveLength(3);
    expect(() => parseCardList("0 Dark Hole")).toThrow(/count/i);
    expect(() => parseCardList("999999999999999999999 Dark Hole")).toThrow(/count/i);
    expect(() => parseCardList("   ")).toThrow(/list/i);
  });
});
