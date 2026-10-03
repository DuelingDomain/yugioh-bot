import { describe, expect, it } from "vitest";
import {
  initialOf,
  packsOf,
  parsePreflight,
  mainShortfallSummary,
  mainShortfallFix,
  extraShortfallSummary,
  plural,
  poolSources,
  setupRows,
  splitPreflight,
  startBlocker,
  startSummary,
} from "../../src/components/draft/lobby/lobby-model";

describe("startBlocker", () => {
  const base = { isTheme: false, themeCount: 0, uniqueThemes: true };

  it("needs two players", () => {
    expect(startBlocker({ ...base, playerCount: 1 })).toBe("Need 1 more player to start.");
    expect(startBlocker({ ...base, playerCount: 0 })).toBe("Need 2 more players to start.");
  });

  it("lets a cube draft with two players start", () => {
    expect(startBlocker({ ...base, playerCount: 2 })).toBeNull();
  });

  it("needs a theme in a theme draft", () => {
    expect(startBlocker({ ...base, isTheme: true, playerCount: 2, themeCount: 0 })).toBe("Add a theme first.");
  });

  it("needs one theme per player when themes are unique", () => {
    expect(startBlocker({ ...base, isTheme: true, playerCount: 4, themeCount: 3 })).toBe("Add 1 more theme. Each of the 4 players needs their own.");
    expect(startBlocker({ ...base, isTheme: true, playerCount: 4, themeCount: 1 })).toBe("Add 3 more themes. Each of the 4 players needs their own.");
    expect(startBlocker({ ...base, isTheme: true, playerCount: 4, themeCount: 4 })).toBeNull();
  });

  it("allows fewer themes than players when themes can repeat", () => {
    expect(startBlocker({ ...base, isTheme: true, uniqueThemes: false, playerCount: 4, themeCount: 1 })).toBeNull();
  });

  it("reports the player shortage before the theme shortage", () => {
    expect(startBlocker({ ...base, isTheme: true, playerCount: 1, themeCount: 0 })).toBe("Need 1 more player to start.");
  });
});

describe("startSummary", () => {
  it("describes the packs a cube draft deals", () => {
    expect(startSummary({ packsPerPlayer: 3, packSize: 15, randomizeSeats: true }, 4)).toEqual({
      before: "Deals ",
      strong: "3 packs of 15",
      after: " to each of the 4 players. Seats are shuffled. Nobody can join after this.",
    });
  });

  it("leaves out the shuffle sentence when seats are not shuffled", () => {
    expect(startSummary({ packsPerPlayer: 1, packSize: 40, randomizeSeats: false }, 2).after).toBe(" to each of the 2 players. Nobody can join after this.");
  });

  it("derives the pack count when the config has none", () => {
    expect(packsOf({ cardsPerPlayer: 45, packSize: 15 })).toBe(3);
  });

  it("gives real main and Extra numbers for a theme draft", () => {
    const s = startSummary({ mode: "theme", cardsPerPlayer: 40, extraDeckEnabled: true, extraDeckSize: 15, themeSelection: "player_pick" }, 3);
    expect(s.before).toContain("Gives each of the 3 players a theme. Anyone without one gets one at random.");
    expect(s.strong).toBe("40 main deck and 15 Extra deck cards");
  });

  it("drops the Extra part when it is off", () => {
    expect(startSummary({ mode: "theme", cardsPerPlayer: 44, extraDeckEnabled: false }, 3).strong).toBe("44 main deck cards");
  });

  it("says every theme is random in random mode", () => {
    expect(startSummary({ mode: "theme", themeSelection: "random" }, 3).before).toContain("a random theme");
  });

  it("promises the host's own picks, not a random fallback, when the host assigns themes", () => {
    const s = startSummary({ mode: "theme", themeSelection: "host_assigned" }, 3);
    expect(s.before).toContain("the theme the host set for them");
    expect(s.before).not.toContain("random");
  });
});

describe("setupRows", () => {
  it.each([
    [45, "45 s"], [60, "1 min"], [90, "1 min 30 s"], [600, "10 min"],
  ])("formats %i seconds as %s for both kinds of lobby", (seconds, text) => {
    for (const mode of ["booster", "theme"] as const) {
      expect(setupRows({ mode, pickSeconds: seconds }).find((row) => row.label === "Pick duration")?.value).toBe(text);
    }
  });
  it("lists the cube setup, with passing only when it alternates", () => {
    const rows = setupRows({ cardsPerPlayer: 40, packsPerPlayer: 3, packSize: 15, pickSeconds: 45, alternatePassDirection: true, randomizeSeats: true });
    expect(rows).toEqual([
      { label: "Each player", value: "40 cards" },
      { label: "Packs", value: "3 of 15" },
      { label: "Pick duration", value: "45 s" },
      { label: "Passing", value: "Left, then right" },
      { label: "Seats", value: "Shuffled at the start" },
    ]);
    expect(setupRows({ packSize: 15, packsPerPlayer: 3 }).some((r) => r.label === "Passing")).toBe(false);
  });

  it("lists the theme setup", () => {
    expect(setupRows({ mode: "theme", cardsPerPlayer: 40, extraDeckSize: 15, themePackSize: 3, pickSeconds: 45, themeSelection: "player_pick", uniqueThemes: true })).toEqual([
      { label: "Themes", value: "Players pick, all different" },
      { label: "Main deck", value: "40 picks" },
      { label: "Extra deck", value: "15 picks" },
      { label: "Each pick", value: "3 choices" },
      { label: "Pick duration", value: "45 s" },
      { label: "Passed cards", value: "Can come back" },
    ]);
  });

  it("covers random themes, no Extra deck and burned cards", () => {
    const rows = setupRows({ mode: "theme", themeSelection: "random", uniqueThemes: false, extraDeckEnabled: false, burnUnpicked: true });
    expect(rows.find((r) => r.label === "Themes")?.value).toBe("Random");
    expect(rows.find((r) => r.label === "Extra deck")?.value).toBe("Off");
    expect(rows.find((r) => r.label === "Passed cards")?.value).toBe("Burned");
  });
});

describe("preflight presentation", () => {
  it("parses the server's main pool shortfall, including names containing colons", () => {
    const raw = "Mind: Control: Main pool has 12 cards but needs at least 42 for a 40-card main deck (3 choices/pick).";
    expect(parsePreflight(raw, ["Mind: Control"])).toEqual({
      name: "Mind: Control", shortfall: { kind: "main", have: 12, need: 42 }, raw,
    });
  });

  it("parses the server's Extra pool shortfall", () => {
    const raw = "Toon: Extra pool has 3 cards but needs 17 for a full 15-card Extra Deck; players may end with fewer Extra cards.";
    expect(parsePreflight(raw, ["Toon"])).toEqual({ name: "Toon", shortfall: { kind: "extra", have: 3, need: 17 }, raw });
  });

  it.each(["Main", "Extra"])("parses a singular card and an empty %s pool", (pool) => {
    const kind = pool.toLowerCase();
    const atLeast = pool === "Main" ? "at least " : "";
    expect(parsePreflight(`Toon: ${pool} pool has 1 card but needs ${atLeast}17`, ["Toon"]).shortfall).toEqual({ kind, have: 1, need: 17 });
    expect(parsePreflight(`Toon: ${pool} pool has 0 cards but needs ${atLeast}17`, ["Toon"]).shortfall).toEqual({ kind, have: 0, need: 17 });
  });

  it.each([
    "Unknown check: Something changed.",
    "Toon: Main pool is too small.",
    "Toon: Extra pool has many cards but needs 17",
    "Toon: Prefix Main pool has 1 card but needs at least 42",
    "Main pool has 1 card but needs at least 42",
  ])("preserves unmatched text: %s", (raw) => {
    const issue = parsePreflight(raw, ["Toon"]);
    expect(issue.shortfall).toBeNull();
    expect(issue.raw).toBe(raw);
  });

  it("uses the existing fallback name split", () => {
    expect(parsePreflight("Toon: Main pool has 1 card but needs at least 42", []).shortfall).toEqual({ kind: "main", have: 1, need: 42 });
  });

  it("summarizes one, two or three small main pools", () => {
    expect(mainShortfallSummary([])).toBeNull();
    expect(mainShortfallSummary(["Gaia knights"])).toBe("Gaia knights can't be drafted yet. Its main pool is too small.");
    expect(mainShortfallSummary(["Gaia knights", "Toon"])).toBe("Gaia knights and Toon can't be drafted yet. Their main pools are too small.");
    expect(mainShortfallSummary(["Gaia knights", "Toon", "Despia"])).toBe("Gaia knights, Toon and Despia can't be drafted yet. Their main pools are too small.");
  });

  it.each([
    [1, "Add cards to the cube, or remove the theme."],
    [2, "Add cards to those cubes, or remove those themes."],
    [3, "Add cards to those cubes, or remove those themes."],
  ])("offers a repair for %i small main pools", (count, text) => {
    expect(mainShortfallFix(count)).toBe(text);
  });

  it("summarizes singular and plural Extra pool warnings", () => {
    expect(extraShortfallSummary(0)).toBeNull();
    expect(extraShortfallSummary(1)).toBe("1 theme may run short on Extra deck cards, so that player could end with fewer. You can start anyway.");
    expect(extraShortfallSummary(3)).toBe("3 themes may run short on Extra deck cards, so those players could end with fewer. You can start anyway.");
  });
});

describe("small helpers", () => {
  it("pluralises", () => {
    expect(plural(1, "player")).toBe("1 player");
    expect(plural(2, "player")).toBe("2 players");
    expect(plural(1, "more theme")).toBe("1 more theme");
  });

  it("describes pool sources", () => {
    expect(poolSources(2, 36)).toBe("2 sets and 36 passcodes");
    expect(poolSources(1, 0)).toBe("1 set");
    expect(poolSources(0, 1)).toBe("1 passcode");
    expect(poolSources(0, 0)).toBe("");
  });

  it("takes the first letter for the seat monogram", () => {
    expect(initialOf("duelist.josh")).toBe("D");
    expect(initialOf("  kestrel")).toBe("K");
    expect(initialOf("")).toBe("?");
  });

  it("splits a preflight line at the cube name", () => {
    expect(splitPreflight("Blue-Eyes: needs 42", ["Blue-Eyes"])).toEqual({ name: "Blue-Eyes", rest: "needs 42" });
    expect(splitPreflight("Mind: Control: bad", ["Mind: Control"])).toEqual({ name: "Mind: Control", rest: "bad" });
    expect(splitPreflight("Sky Striker: low", [])).toEqual({ name: "Sky Striker", rest: "low" });
    expect(splitPreflight("No prefix here", [])).toEqual({ name: null, rest: "No prefix here" });
  });
});
