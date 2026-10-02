import { describe, expect, it } from "vitest";
import { expectBoard, expectEliminated, type BoardExpect, type Scenario } from "./support/dsl.js";
import { defineScenarioWithFfaFirstDraw } from "./scenarios/multiplayer/ffa-first-draw.js";

function fixture(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "first-draw-transform",
    title: "An older FFA fixture gets its opening draw",
    source: "ADR-0002 R-FFA-FIRST-DRAW",
    tags: ["first-draw-transform"],
    setup: { format: "ffa3", p0: { hand: ["Raigeki"], deck: ["Pot of Greed", "Silver Fang"] } },
    steps: [expectBoard({
      p0: { hand: ["Raigeki"], deckCount: 20, grave: [], banished: [] },
      p1: { hand: [], deckCount: 20 },
      p2: { hand: [], deckCount: 20 },
    })],
    ...overrides,
  };
}

function board(scenario: Scenario, index = 0): BoardExpect {
  const step = scenario.steps[index];
  if (step?.op !== "expectBoard") throw new Error("The fixture step must check a board.");
  return step.board;
}

describe.each(["ffa3", "ffa4"] as const)("%s first-draw transform", (format) => {
  function ffa(overrides: Partial<Scenario> = {}): Scenario {
    const scenario = fixture(overrides);
    scenario.setup.format = format;
    return scenario;
  }

  it("puts filler before a custom Deck and updates only p0", () => {
    const input = ffa();
    const original = structuredClone(input);
    const result = defineScenarioWithFfaFirstDraw(input);

    expect(result.setup.p0?.deck).toEqual(["Mystical Elf", "Pot of Greed", "Silver Fang"]);
    expect(board(result)).toEqual({
      p0: { hand: ["Raigeki", "Mystical Elf"], deckCount: 19, grave: [], banished: [] },
      p1: { hand: [], deckCount: 20 },
      p2: { hand: [], deckCount: 20 },
    });
    expect(result.tags).toEqual(["first-draw-transform", "ffa-first-draw-included"]);
    expect(input).toEqual(original);
  });

  it("uses the requested filler card", () => {
    const result = defineScenarioWithFfaFirstDraw(ffa(), { card: "Axe Raider" });
    expect(result.setup.p0?.deck).toEqual(["Axe Raider", "Pot of Greed", "Silver Fang"]);
    expect(board(result).p0?.hand).toEqual(["Raigeki", "Axe Raider"]);
  });

  it("draws the custom top card when deckSize is set", () => {
    const input = ffa({
      setup: { deckSize: 3, p0: { hand: ["Raigeki"], deck: ["Pot of Greed", "Silver Fang", "Axe Raider"] } },
      steps: [expectBoard({ p0: { hand: ["Raigeki"], deckCount: 3 } })],
    });
    const result = defineScenarioWithFfaFirstDraw(input);
    expect(result.setup).toEqual(input.setup);
    expect(board(result).p0).toEqual({ hand: ["Raigeki", "Pot of Greed"], deckCount: 2 });
  });

  it("accounts for a custom card already drawn in a later snapshot", () => {
    const result = defineScenarioWithFfaFirstDraw(ffa({
      setup: { deckSize: 3, p0: { deck: ["Pot of Greed", "Silver Fang", "Axe Raider"] } },
      steps: [
        expectBoard({ p0: { hand: [], deckCount: 3 } }),
        expectBoard({ p0: { hand: ["Pot of Greed"], deckCount: 2 } }),
      ],
    }));
    expect(board(result).p0).toEqual({ hand: ["Pot of Greed"], deckCount: 2 });
    expect(board(result, 1).p0).toEqual({ hand: ["Pot of Greed", "Silver Fang"], deckCount: 1 });
  });

  it("accounts for later draws when the hand is exact and deckCount is absent", () => {
    const result = defineScenarioWithFfaFirstDraw(ffa({
      setup: { deckSize: 3, p0: { hand: [{ card: "Raigeki" }], deck: ["Pot of Greed", "Silver Fang", "Axe Raider"] } },
      steps: [expectBoard({ p0: { hand: ["Raigeki", "Pot of Greed"] } })],
    }));
    expect(board(result).p0).toEqual({ hand: ["Raigeki", "Pot of Greed", "Silver Fang"] });
  });

  it("keeps an empty Deck count at zero", () => {
    const result = defineScenarioWithFfaFirstDraw(ffa({
      steps: [expectBoard({ p0: { hand: [], deckCount: 0 } })],
    }));
    expect(board(result).p0).toEqual({ hand: ["Mystical Elf"], deckCount: 0 });
  });

  it("stops changing p0 snapshots after p0 is eliminated", () => {
    const input = ffa({ steps: [
      expectBoard({ p0: { hand: [], deckCount: 20 } }),
      expectEliminated("p0"),
      expectBoard({ p0: { lp: 8000, hand: [], deckCount: 0 }, p1: { hand: [], deckCount: 20 } }),
    ] });
    const result = defineScenarioWithFfaFirstDraw(input);
    expect(board(result).p0).toEqual({ hand: ["Mystical Elf"], deckCount: 19 });
    expect(result.steps.slice(1)).toEqual(input.steps.slice(1));
  });

  it("continues to change p0 after another seat is eliminated", () => {
    const result = defineScenarioWithFfaFirstDraw(ffa({ steps: [
      expectEliminated("p1"),
      expectBoard({ p0: { hand: [], deckCount: 20 } }),
    ] }));
    expect(board(result, 1).p0).toEqual({ hand: ["Mystical Elf"], deckCount: 19 });
  });

  it("leaves a p0 snapshot at zero LP unchanged", () => {
    const input = ffa({ steps: [
      expectBoard({ p0: { lp: 0, hand: [], deckCount: 20 }, p1: { hand: [], deckCount: 20 } }),
      expectBoard({ p0: { lp: 8000, hand: [], deckCount: 20 } }),
    ] });
    const result = defineScenarioWithFfaFirstDraw(input);
    expect(result.steps[0]).toEqual(input.steps[0]);
    expect(board(result, 1).p0).toEqual({ lp: 8000, hand: ["Mystical Elf"], deckCount: 19 });
  });

  it.each(["grave", "banished"] as const)("puts the opening card in the requested %s snapshot", (destination) => {
    const result = defineScenarioWithFfaFirstDraw(ffa(), { destination });
    expect(board(result).p0).toEqual({
      hand: ["Raigeki"], deckCount: 19, grave: [], banished: [], [destination]: ["Mystical Elf"],
    });
  });

  it.each(["hand", "grave", "banished"] as const)("increases a %s count without changing its filters", (destination) => {
    const result = defineScenarioWithFfaFirstDraw(ffa({
      steps: [expectBoard({ p0: { [destination]: { count: 0, exclude: ["Pot of Greed"] }, deckCount: 20 } })],
    }), { destination });
    expect(board(result).p0).toEqual({ [destination]: { count: 1, exclude: ["Pot of Greed"] }, deckCount: 19 });
  });

  it("does not add a hand assertion when only the Deck is checked", () => {
    const result = defineScenarioWithFfaFirstDraw(ffa({ steps: [expectBoard({ p0: { deckCount: 20 } })] }));
    expect(board(result).p0).toEqual({ deckCount: 19 });
  });

  it("leaves a snapshot without p0 unchanged", () => {
    const input = ffa({ steps: [expectBoard({ p1: { hand: [], deckCount: 20 } })] });
    expect(defineScenarioWithFfaFirstDraw(input).steps).toEqual(input.steps);
  });

  it("does not add another opening draw when called twice", () => {
    const result = defineScenarioWithFfaFirstDraw(ffa());
    expect(defineScenarioWithFfaFirstDraw(result)).toBe(result);
  });

  it("honors the opt-out tag without changing the setup or expectations", () => {
    const input = ffa({ tags: ["first-draw-transform", "ffa-first-draw-included"] });
    const original = structuredClone(input);
    expect(defineScenarioWithFfaFirstDraw(input)).toBe(input);
    expect(input).toEqual(original);
  });

  it("leaves a p1 starting-turn fixture unchanged", () => {
    const input = ffa({ setup: { turn: "p1", p0: { deck: ["Pot of Greed"] } } });
    const original = structuredClone(input);
    expect(defineScenarioWithFfaFirstDraw(input)).toBe(input);
    expect(input).toEqual(original);
  });
});

it.each(["tag", "1v1", undefined] as const)("leaves format %s unchanged", (format) => {
  const input = fixture({ setup: { format, p0: { hand: ["Raigeki"], deck: ["Pot of Greed"] } } });
  const original = structuredClone(input);
  expect(defineScenarioWithFfaFirstDraw(input, { card: "Axe Raider", destination: "banished" })).toBe(input);
  expect(input).toEqual(original);
});
