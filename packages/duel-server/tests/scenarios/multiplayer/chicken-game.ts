import {
  activate, attack, choose, defineScenario, endTurn, expectBoard, expectEliminated, faceDown, pickOpponent, surrender,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";

const SOURCE = "https://github.com/DuelingDomain/yugioh-bot/issues/449 [R-FFA-LP-COMPARE]";
const seat = (i: number) => `p${i}` as DuelistId;
const standard: Scenario[] = [];

// Replay 160: the 7000-LP recipient is not the unique lowest player. Use two
// separate 2400-ATK monsters to attack both recipients in the same Battle Phase.
for (const format of ["ffa3", "ffa4"] as const) {
  const lowest = format === "ffa4" ? "p3" : "p2";
  for (let controller = 0; controller < (format === "ffa4" ? 4 : 3); controller++) {
    const setup: Scenario["setup"] = {
      format, skipOpeningDraw: true,
      p0: { lp: 7000 }, p1: { lp: 8000, monsters: ["Red-Eyes Black Dragon", "Red-Eyes Black Dragon"] },
      p2: { lp: format === "ffa4" ? 7000 : 1850 }, ...(format === "ffa4" ? { p3: { lp: 1850 } } : {}),
    };
    setup[seat(controller)]!.field = "Chicken Game";
    standard.push(defineScenario({
      id: `chicken-game-${format}-replay160-controller${controller}`,
      title: `${format}: only the 1850-LP player avoids 2400 direct damage (controller p${controller})`,
      source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", format, "card:67616300"], setup,
      steps: [...Array.from({ length: format === "ffa4" ? 4 : 3 }, (_, i) => endTurn(seat(i))), endTurn("p0"),
        attack({ card: "Red-Eyes Black Dragon", seq: 0 }, "direct", "p1"), pickOpponent("p0", "p1"),
        expectBoard({ p0: { lp: 4600 }, p1: { lp: 8000 }, [lowest]: { lp: 1850 } }),
        attack({ card: "Red-Eyes Black Dragon", seq: 1 }, "direct", "p1"), pickOpponent(lowest, "p1"),
        expectBoard({ p0: { lp: 4600 }, p1: { lp: 8000 }, p2: { lp: format === "ffa4" ? 7000 : 1850 },
          ...(format === "ffa4" ? { p3: { lp: 1850 } } : {}) })],
    }));
  }

  // Tremendous Fire damages an opponent and its own controller in one chain,
  // exercising EFFECT_NO_EFFECT_DAMAGE as well as the battle-damage path.
  for (const [label, points, protectedSeats] of [
    ["mixed", [7000, 8000, 1850, 7000], [2]],
    ["controller-lowest", [1850, 8000, 7000, 7000], [0]],
    ["recipient-lowest", [8000, 1850, 7000, 7000], [1]],
    ["partial-tie", [7000, 7000, 8000, 9000], []],
    ["all-equal", [7000, 7000, 7000, 7000], []],
  ] as const) {
    const setup: Scenario["setup"] = { format, skipOpeningDraw: true };
    const board: BoardExpect = {};
    for (let i = 0; i < (format === "ffa4" ? 4 : 3); i++) {
      setup[seat(i)] = { lp: points[i] };
      board[seat(i)] = { lp: points[i] - (protectedSeats.some(p => p === i) ? 0 : i === 0 ? 500 : i === 1 ? 1000 : 0) };
    }
    setup.p0!.hand = ["Tremendous Fire"];
    setup.p2!.field = "Chicken Game";
    standard.push(defineScenario({
      id: `chicken-game-${format}-effect-${label}`, title: `${format}: ${label} protection follows each damage recipient`,
      source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", format, "card:67616300"], setup,
      steps: [activate("Tremendous Fire"), pickOpponent("p1"), expectBoard(board)],
    }));
  }

  // The surrendered seat retains 1850 LP; a raw minimum including it would
  // incorrectly leave the now-lowest 7000-LP survivor unprotected.
  const steps: Step[] = [surrender("p2"), expectEliminated("p2"), activate("Tremendous Fire"),
    ...(format === "ffa4" ? [pickOpponent("p1")] : []),
    expectBoard({ p0: { lp: 7000 }, p1: { lp: 8000 }, ...(format === "ffa4" ? { p3: { lp: 8000 } } : {}) })];
  standard.push(defineScenario({
    id: `chicken-game-${format}-eliminated-lowest`, title: `${format}: positive-LP eliminated players do not prevent protection`,
    source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", format, "card:67616300"],
    setup: { format, skipOpeningDraw: true, p0: { lp: 7000, hand: ["Tremendous Fire"] },
      p1: { lp: 9000, field: "Chicken Game" }, p2: { lp: 1850 }, ...(format === "ffa4" ? { p3: { lp: 8000 } } : {}) }, steps,
  }));

  standard.push(defineScenario({
    id: `chicken-game-${format}-simultaneous-damage`,
    title: `${format}: Tremendous Fire checks both recipients before its simultaneous damage`,
    source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", format, "card:67616300"],
    setup: { format, skipOpeningDraw: true, p0: { lp: 7000, hand: ["Tremendous Fire"] },
      p1: { lp: 7200 }, p2: { lp: 8000, field: "Chicken Game" }, ...(format === "ffa4" ? { p3: { lp: 8000 } } : {}) },
    // Sequential damage to p1 first would make p0 lose its protection and take 500.
    steps: [activate("Tremendous Fire"), pickOpponent("p1"), expectBoard({ p0: { lp: 7000 }, p1: { lp: 6200 } })],
  }));

  standard.push(defineScenario({
    id: `chicken-game-${format}-rank-changes-between-effects`,
    title: `${format}: becoming tied-lowest removes protection for the next damage effect`,
    source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", format, "card:67616300"],
    setup: { format, skipOpeningDraw: true, p0: { lp: 7000, hand: ["Hinotama", "Tremendous Fire"] },
      p1: { lp: 7500 }, p2: { lp: 8000, field: "Chicken Game" }, ...(format === "ffa4" ? { p3: { lp: 8000 } } : {}) },
    steps: [activate("Hinotama"), pickOpponent("p1"), expectBoard({ p0: { lp: 7000 }, p1: { lp: 7000 } }),
      activate("Tremendous Fire"), pickOpponent("p1"), expectBoard({ p0: { lp: 6500 }, p1: { lp: 6000 } })],
  }));

  for (const method of ["destroy", "negate"] as const) {
    const card = method === "destroy" ? "Mystical Space Typhoon" : "Magic Deflector";
    standard.push(defineScenario({
      id: `chicken-game-${format}-${method}-stops-protection`, title: `${format}: ${method} Chicken Game stops its seat protections`,
      source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", format, "card:67616300"],
      setup: { format, skipOpeningDraw: true,
        p0: { lp: 1850, hand: ["Tremendous Fire", ...(method === "destroy" ? [card] : [])],
          ...(method === "negate" ? { spells: [faceDown(card)] } : {}) },
        p1: { lp: 8000, field: "Chicken Game" }, p2: { lp: 7000 }, ...(format === "ffa4" ? { p3: { lp: 7000 } } : {}) },
      steps: [activate(card), activate("Tremendous Fire"), pickOpponent("p1"),
        expectBoard({ p0: { lp: 1350, grave: [card, "Tremendous Fire"] }, p1: { lp: 7000,
          ...(method === "destroy" ? { spells: [], grave: ["Chicken Game"] } : { spells: ["Chicken Game"] }) } })],
    }));
  }

  standard.push(defineScenario({
    id: `chicken-game-${format}-stock-ignition`, title: `${format}: Chicken Game keeps its LP cost and destroy option`,
    source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", format, "card:67616300"],
    setup: { format, skipOpeningDraw: true, p0: { lp: 1850, field: "Chicken Game", hand: ["Tremendous Fire"] },
      p1: { lp: 8000 }, p2: { lp: 7000 }, ...(format === "ffa4" ? { p3: { lp: 7000 } } : {}) },
    steps: [activate("Chicken Game"), choose("Destroy this card"), activate("Tremendous Fire"), pickOpponent("p1"),
      expectBoard({ p0: { lp: 350, spells: [], grave: ["Chicken Game", "Tremendous Fire"] }, p1: { lp: 7000 } })],
  }));

  standard.push(defineScenario({
    id: `chicken-game-${format}-pseudo-space-copy`, title: `${format}: copied protection works and expires with Pseudo Space's copy`,
    source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", format, "card:67616300"],
    setup: { format, skipOpeningDraw: true, p0: { lp: 1850, field: "Pseudo Space", grave: ["Chicken Game"], hand: ["Tremendous Fire"] },
      p1: { lp: 8000, hand: ["Hinotama"] }, p2: { lp: 7000 }, ...(format === "ffa4" ? { p3: { lp: 7000 } } : {}) },
    steps: [activate("Pseudo Space"), activate("Tremendous Fire"), pickOpponent("p1"),
      expectBoard({ p0: { lp: 1850, banished: ["Chicken Game"] }, p1: { lp: 7000 } }),
      endTurn("p0"), activate("Hinotama", "p1"), pickOpponent("p0", "p1"),
      expectBoard({ p0: { lp: 1350, spells: ["Pseudo Space"] }, p1: { lp: 7000 } })],
  }));

  for (const effect of ["change-damage", "no-effect-damage"] as const) {
    standard.push(defineScenario({
      id: `chicken-game-${format}-pseudo-space-preserves-${effect}`,
      title: `${format}: copying Chicken Game preserves Pseudo Space's pre-existing ${effect} effect`,
      source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", format, "card:67616300", `preserve-${effect}`],
      setup: { format, skipOpeningDraw: true,
        p0: { lp: 1850, field: "Pseudo Space", grave: ["Chicken Game"], hand: ["Tremendous Fire"] },
        p1: { lp: 8000 }, p2: { lp: 7000 }, ...(format === "ffa4" ? { p3: { lp: 7000 } } : {}) },
      steps: [activate("Pseudo Space"), activate("Tremendous Fire"), pickOpponent("p1"),
        expectBoard({ p0: { lp: effect === "change-damage" ? 1850 : 1950, banished: ["Chicken Game"] },
          p1: { lp: effect === "change-damage" ? 8000 : 7000 } })],
    }));
  }
}

// Tag keeps the stock comparison between the two shared team pools.
for (const [label, own, other, ownAfter, otherAfter] of [
  ["own-lower", 6000, 8000, 6000, 7000], ["other-lower", 8000, 7000, 7500, 7000],
  ["equal", 8000, 8000, 7500, 7000],
] as const) {
  standard.push(defineScenario({
    id: `chicken-game-tag-${label}`, title: `Tag: ${label} uses shared team LP`,
    source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "tag", "card:67616300"],
    setup: { format: "tag", skipOpeningDraw: true, p0: { lp: own, field: "Chicken Game", hand: ["Tremendous Fire"] },
      p1: { lp: other }, p2: { lp: own }, p3: { lp: other } },
    steps: [activate("Tremendous Fire"), expectBoard({ p0: { lp: ownAfter }, p1: { lp: otherAfter },
      p2: { lp: ownAfter }, p3: { lp: otherAfter } })],
  }));
}

export const CHICKEN_GAME_SCENARIOS = standard.flatMap(s => [s, domainVariant(s)]);
