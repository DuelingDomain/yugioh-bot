import { describe, expect, it } from "vitest";
import {
  initialOf,
  packsOf,
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
