import { describe, expect, it, vi } from "vitest";
import { decodeYdke, encodeYdke, parseYdk, serializeYdk, splitImportText } from "../../src/decks/formats.js";

const empty = { main: [], extra: [], side: [] };

describe("YDKE", () => {
  it("encodes and decodes with browser globals and no Node Buffer", () => {
    vi.stubGlobal("Buffer", undefined);
    try {
      expect(encodeYdke({ ...empty, main: [89631139] })).toBe("ydke://o6lXBQ==!!!");
      expect(decodeYdke("ydke://o6lXBQ==!!!")).toEqual({ deck: { ...empty, main: [89631139] } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the external Blue-Eyes byte vector and explicit little-endian order", () => {
    expect(encodeYdke({ ...empty, main: [89631139] })).toBe("ydke://o6lXBQ==!!!");
    expect(decodeYdke("ydke://o6lXBQ==!!!")).toEqual({ deck: { ...empty, main: [89631139] } });
    expect(encodeYdke({ ...empty, main: [0x04030201] })).toBe("ydke://AQIDBA==!!!");
    expect(decodeYdke("ydke://!!!")).toEqual({ deck: empty });
  });

  it("preserves sections, order, copies and artwork ids; ignores Deck Master", () => {
    const deck = { main: [89631139, 89631133, 89631139], extra: [44508094], side: [0xffffffff], deckMaster: 42 };
    expect(decodeYdke(encodeYdke(deck))).toEqual({ deck: { main: deck.main, extra: deck.extra, side: deck.side } });
  });

  it("accepts omitted padding, URL-safe input and outer whitespace/BOM", () => {
    expect(decodeYdke("\uFEFF YDKE://o6lXBQ!!! \r\n")).toEqual({ deck: { ...empty, main: [89631139] } });
    expect(decodeYdke("ydke://_____w!!!")).toEqual({ deck: { ...empty, main: [0xffffffff] } });
  });

  it.each([
    "ydke://o6lXBQ==", "ydke://o6lXBQ==!!", // contract requires three separators
    "ydke://o6lXBQ==!!!rvTMAg==", "ydke://!!!!", "ydke://!!!trailing",
    "ydke://o6lXBQ==!!!\nydke://!!!", "https://o6lXBQ==!!!",
    "ydke://o6lX BQ==!!!", "ydke://o6lXBQ%3D%3D!!!",
    "ydke://o6lXBQ=!!!", "ydke://o6lXBQ===!!!", "ydke://o6l=XBQ!!!",
    "ydke://A!!!", "ydke://o6lXBR==!!!", // noncanonical unused bits
    "ydke://o6lXBQA=!!!", "ydke://AAAAAA==!!!",
  ])("rejects malformed input %s", (text) => {
    expect(decodeYdke(text)).toHaveProperty("error.code");
  });

  it.each([0, -1, 1.5, 0x100000000, NaN])("refuses to encode invalid passcode %s", (code) => {
    expect(() => encodeYdke({ ...empty, main: [code] })).toThrow();
  });
});

describe("YDK", () => {
  it.each([
    ["#maindeck", "#extradeck", "!sidedeck"],
    ["#MAINDECK", "#EXTRADECK", "!SIDEDECK"],
    ["#Main Deck", "#Extra Deck", "!Side Deck"],
    ["# main", "# extra", "! side"],
    ["#main: cards", "#extradeck: cards", "!sidedeck: cards"],
  ])("keeps cards in their sections with headers %s / %s / %s", (main, extra, side) => {
    expect(parseYdk(`${main}\n1\n${extra}\n2\n${side}\n3`)).toEqual({
      deck: { main: [1], extra: [2], side: [3] }, issues: [],
    });
  });

  it("accepts header labels, case and spaces", () => {
    expect(parseYdk(" # MAIN Deck \n1\n# Extra deck\n2\n! SIDE Deck\n3")).toEqual({
      deck: { main: [1], extra: [2], side: [3] }, issues: [],
    });
  });

  it("keeps 20 issues and counts the rest while retaining later valid cards", () => {
    const result = parseYdk(`#main\n${"bad\n".repeat(10000)}1`);
    expect(result.deck.main).toEqual([1]);
    expect(result.issues).toHaveLength(21);
    expect(result.issues[19]).toMatchObject({ line: 21 });
    expect(result.issues[20]).toMatchObject({ code: "more_issues", message: "and 9980 more issues", count: 9980 });
  });

  it("accepts full-line slash comments without dropping card copies", () => {
    expect(parseYdk("// exported deck\r\n#main\r\n1\r\n// card name\r\n1\r\n#extra\r\n!side\r\n")).toEqual({
      deck: { main: [1, 1], extra: [], side: [] }, issues: [],
    });
  });

  it.each([
    ["#main\n1\n#main\n2", "duplicate_section", 3],
    ["#extra\n2\n#main\n1", "section_order", 3],
    ["!side\n3\n#extra\n2", "section_order", 3],
  ])("reports repeated or reversed section headers in %s", (text, code, line) => {
    expect(parseYdk(text as string).issues).toContainEqual(expect.objectContaining({ code, line }));
  });

  it("reads comments, CRLF, BOM, empty sections and explicit Deck Master", () => {
    expect(parseYdk("\uFEFF#created by someone\r\n#deckmaster\r\n9\r\n#main\r\n1\r\n1\r\n# comment\r\n#extra\r\n2\r\n!side\r\n")).toEqual({
      deck: { main: [1, 1], extra: [2], side: [], deckMaster: 9 }, issues: [],
    });
  });

  it("reports invalid passcodes and retains valid lines with one-based line numbers", () => {
    const result = parseYdk("#main\n1\n123junk\n4294967296\n0\n#extra\n2\n!side\n3");
    expect(result.deck).toEqual({ main: [1], extra: [2], side: [3] });
    expect(result.issues.map(issue => issue.line)).toEqual([3, 4, 5]);
  });

  it.each(["#deckmaster\n", "#deckmaster\nabc", "#deckmaster\n0", "#deckmaster\n1\n2", "#deckmaster\n1\n#main\n2\n#deckmaster\n3"])('reports malformed master %s', text => {
    expect(parseYdk(text).issues.length).toBeGreaterThan(0);
  });

  it("matches section headers exactly and diagnoses bare passcodes or empty input", () => {
    expect(parseYdk("#mainly\n1").deck.main).toEqual([]);
    expect(parseYdk("1\n2").issues.length).toBeGreaterThan(0);
    expect(parseYdk("\uFEFF\r\n").issues.length).toBeGreaterThan(0);
  });

  it("serializes the existing YDK layout and round-trips Deck Master", () => {
    const deck = { main: [1, 1], extra: [2], side: [3], deckMaster: 9 };
    expect(serializeYdk(deck)).toBe("#deckmaster\n9\n#main\n1\n1\n#extra\n2\n!side\n3\n");
    expect(parseYdk(serializeYdk(deck))).toEqual({ deck, issues: [] });
  });
});

describe("splitImportText", () => {
  it("clamps filename names without splitting Unicode pairs or keeping trailing spaces", () => {
    expect(splitImportText("#main\n1", `${"a".repeat(99)}😀.ydk`)[0].name).toBe("a".repeat(99));
    expect(splitImportText("#main\n1", `${"a".repeat(98)}😀.ydk`)[0].name).toBe(`${"a".repeat(98)}😀`);
    expect(splitImportText("#main\n1", `${"a".repeat(99)} more.ydk`)[0].name).toBe("a".repeat(99));
  });

  it("keeps a whole YDK source and cleans its filename", () => {
    const text = "#main\r\n1\r\n#extra\r\n2";
    expect(splitImportText(text, "folder\\Blue_Eyes.ydk")).toEqual([{ name: "Blue Eyes", text, kind: "ydk" }]);
    expect(splitImportText(text, "Branded.YDKE")[0].name).toBe("Branded");
    expect(splitImportText(text, ".txt")[0].name).toBe("Untitled deck");
    expect(splitImportText(text, `${"a".repeat(140)}.ydk`)[0].name).toHaveLength(100);
  });

  it("splits each nonblank YDKE line and retains malformed lines for diagnosis", () => {
    expect(splitImportText("\uFEFF ydke://!!!\r\n\r\nydke://o6lXBQ==!!!\r\nwrapped")).toEqual([
      { name: "Imported deck 1", text: "ydke://!!!", kind: "ydke" },
      { name: "Imported deck 2", text: "ydke://o6lXBQ==!!!", kind: "ydke" },
      { name: "Imported deck 3", text: "wrapped", kind: "ydke" },
    ]);
  });

  it("returns a row for an empty or invalid source", () => {
    expect(splitImportText("", "empty.txt")).toEqual([{ name: "empty", text: "", kind: "ydk" }]);
  });
});
