// Rulebook v1.4, lines 287–296: decision-only opponents are chosen during resolution.
import {
  activate, changePosition, choose, defineScenario, eliminate, expectEliminated, expectBoard, expectPickSeats, expectPrompt, endTurn, pass, pickOpponent, raw, select, no, number, surrender, yes,
  type DuelistId, type Scenario,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

const SOURCE_RULE = `${SOURCE}, Domain Format Complete Rulebook v1.4 lines 287–296 (owner approved 2026-10-04)`;
const ELF = "Mystical Elf";
const OX = "Battle Ox";
const GUARDIAN = "Celtic Guardian";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const MST = "Mystical Space Typhoon";
const CHOICE = "Painful Choice";
const SUMMONITE = "Intimidating Ore - Summonite";

export const OPPONENT_DECISION_PICK_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as const).flatMap((format) => {
  const opponents: DuelistId[] = format === "ffa3" ? ["p1", "p2"] : format === "ffa4" ? ["p1", "p2", "p3"] : ["p1", "p3"];
  const picked = opponents.at(-1)!;
  const rest = { p1: { spells: [{ card: MST, pos: "set" as const }] }, p2: {}, ...(format !== "ffa3" ? { p3: {} } : {}) };
  return [
    defineScenario({
      id: `opponent-decision-pick-${format}-earthshaker-all-fields`,
      title: `${format}: Earthshaker selects its deciding opponent after announcing two Attributes and still destroys on every field`,
      source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION", "R-COMMON-ALL-BOTH"],
      tags: ["multiplayer", "opponent-pick", format, "card:60866277"],
      setup: { format, p0: { spells: [{ card: "Earthshaker", pos: "set" }], monsters: [ELF, OX] }, p1: { monsters: [FANG], spells: [{ card: MST, pos: "set" }] }, p2: { monsters: [AXE, "Harpie Lady"] }, ...(format !== "ffa3" ? { p3: { monsters: [GUARDIAN] } } : {}) },
      steps: [
        activate("Earthshaker", "p0"), expectPrompt({ by: "p1", context: "chain" }), pass("p1"),
        expectPrompt({ by: "p0", kind: "cards" }), raw({ selected: ["attr:1", "attr:8"] }, "p0"),
        expectPickSeats(opponents, "p0"), pickOpponent(picked, "p0"),
        expectPrompt({ by: picked, kind: "cards" }), raw({ selected: ["attr:1"] }, picked),
        expectBoard({ p0: { monsters: [ELF], grave: ["Earthshaker", OX] }, p1: { monsters: [], grave: [FANG], spells: [MST] }, p2: { monsters: ["Harpie Lady"], grave: [AXE] }, ...(format !== "ffa3" ? { p3: { monsters: [], grave: [GUARDIAN] } } : {}) }),
      ],
    }),
    defineScenario({
      id: `opponent-decision-pick-${format}-reasoning-level-at-resolution`,
      title: `${format}: Reasoning's deciding opponent declares a Level during resolution`,
      source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION"],
      tags: ["multiplayer", "opponent-pick", format, "card:58577036"],
      setup: { format, p0: { hand: ["Reasoning"], deck: [OX] }, ...rest },
      steps: [
        activate("Reasoning", "p0"), expectPrompt({ by: "p1", context: "chain" }), pass("p1"),
        expectPickSeats(opponents, "p0"), pickOpponent(picked, "p0"),
        number(4, picked),
        expectBoard({ p0: { monsters: [], grave: ["Reasoning", OX], deckCount: 19 }, p1: { spells: [MST] }, p2: { monsters: [], grave: [] }, ...(format !== "ffa3" ? { p3: { monsters: [], grave: [] } } : {}) }),
      ],
    }),
    defineScenario({
      id: `opponent-decision-pick-${format}-scelta-opponent-decides`,
      title: `${format}: Scelta's opponent chooses the mode during resolution and has no resource requirement`,
      source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION"],
      tags: ["multiplayer", "opponent-pick", format, "card:5605529"],
      setup: { format, p0: { hand: ["Vaalmonica Scelta"], deck: ["Vaalmonica Versare"] }, ...rest },
      steps: [
        activate("Vaalmonica Scelta", "p0"), expectPrompt({ by: "p1", context: "chain" }), pass("p1"),
        expectPickSeats(opponents, "p0"), pickOpponent(picked, "p0"),
        choose("Take 500 damage", picked), no("p0"),
        expectBoard({ p0: { lp: (format === "tag" ? 16000 : 8000) - 500, grave: ["Vaalmonica Scelta"], hand: [] }, p1: { spells: [MST] }, p2: { monsters: [], grave: [] }, ...(format !== "ffa3" ? { p3: { monsters: [], grave: [] } } : {}) }),
      ],
    }),
    ...([false, true] as const).map((withScale) => defineScenario({
      id: `opponent-decision-pick-${format}-intonare-${withScale ? "controller" : "opponent"}-chooses-mode`,
      title: `${format}: Intonare picks one deciding opponent at resolution even when the controller chooses its mode`,
      source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION"],
      tags: ["multiplayer", "opponent-pick", format, "card:78598237"],
      setup: { format, p0: { hand: ["Vaalmonica Intonare"], grave: [ELF, OX], ...(withScale ? { pendulum: ["Angello Vaalmonica", null] as [string, null] } : {}) }, ...rest },
      steps: [
        activate("Vaalmonica Intonare", "p0"), expectPrompt({ by: "p1", context: "chain" }), pass("p1"),
        ...(withScale ? [choose("Gain 500 LP", "p0")] : []),
        expectPickSeats(opponents, "p0"), pickOpponent(picked, "p0"),
        ...(!withScale ? [choose("Gain 500 LP", picked)] : []),
        expectPrompt({ by: picked, kind: "cards" }), { op: "select", sels: [OX], by: picked },
        expectBoard({ p0: { lp: (format === "tag" ? 16000 : 8000) + 500, monsters: [OX], grave: [ELF, "Vaalmonica Intonare"] }, p1: { spells: [MST] }, p2: { monsters: [], grave: [] }, ...(format !== "ffa3" ? { p3: { monsters: [], grave: [] } } : {}) }),
      ],
    })),
    defineScenario({
      id: `opponent-decision-pick-${format}-monster-reborn-reborn`,
      title: `${format}: Monster Reborn Reborn picks its deciding opponent at resolution after targeting its own GY`,
      source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION"],
      tags: ["multiplayer", "opponent-pick", format, "card:50213848"],
      setup: { format, p0: { hand: ["Monster Reborn Reborn"], grave: [ELF, OX, GUARDIAN] }, ...rest },
      steps: [
        activate("Monster Reborn Reborn", "p0"), expectPrompt({ by: "p1", context: "chain" }), pass("p1"),
        expectPickSeats(opponents, "p0"), pickOpponent(picked, "p0"),
        expectPrompt({ by: picked, kind: "cards" }), { op: "select", sels: [OX], by: picked },
        expectBoard({ p0: { monsters: [OX], grave: ["Monster Reborn Reborn"], banished: [ELF, GUARDIAN] }, p1: { spells: [MST] }, p2: { monsters: [], grave: [] }, ...(format !== "ffa3" ? { p3: { monsters: [], grave: [] } } : {}) }),
      ],
    }),
    defineScenario({
      id: `opponent-decision-pick-${format}-ariadne-does-not-inherit-destroyer`,
      title: `${format}: Guiding Ariadne chooses any living opponent during resolution instead of binding its destroyer`,
      source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION"],
      tags: ["multiplayer", "opponent-pick", format, "card:98301564"],
      setup: { format, p0: { pendulum: ["Guiding Ariadne", null], deck: ["Solemn Judgment", "Solemn Warning", "Solemn Strike", "Dark Bribe"] }, p1: { hand: [MST] }, p2: {}, ...(format !== "ffa3" ? { p3: {} } : {}) },
      steps: [
        endTurn("p0"), activate(MST, "p1"), yes("p0"), select("Solemn Judgment", "Solemn Warning", "Solemn Strike"),
        expectPickSeats(opponents, "p0"), pickOpponent(picked, "p0"),
        expectPrompt({ by: picked, kind: "cards" }), { op: "select", sels: ["Solemn Strike"], by: picked },
        expectBoard({ p0: { hand: ["Solemn Strike"], spells: [], extra: ["Guiding Ariadne"] }, p1: { hand: [ELF], grave: [MST] }, p2: { hand: [], monsters: [] }, ...(format !== "ffa3" ? { p3: { hand: [], monsters: [] } } : {}) }),
      ],
    }),
    defineScenario({
      id: `opponent-decision-pick-${format}-painful-choice-after-deck-selection`,
      title: `${format}: Painful Choice has a response window and selects five own cards before picking the deciding opponent`,
      source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION"],
      tags: ["multiplayer", "opponent-pick", format, "card:74191942"],
      setup: { format, p0: { hand: [CHOICE], deck: [ELF, OX, GUARDIAN, AXE, FANG, "Beaver Warrior"] }, ...rest },
      steps: [
        activate(CHOICE, "p0"), expectPrompt({ by: "p1", context: "chain" }), pass("p1"),
        expectPrompt({ by: "p0", kind: "cards" }), select(ELF, OX, GUARDIAN, AXE, FANG),
        expectPickSeats(opponents, "p0"), pickOpponent(picked, "p0"),
        expectPrompt({ by: picked, kind: "cards" }), { op: "select", sels: [AXE], by: picked },
        expectBoard({ p0: { hand: [AXE], grave: [CHOICE, ELF, OX, GUARDIAN, FANG] }, p1: { spells: [MST], grave: [], hand: [], monsters: [] }, p2: { hand: [], grave: [], monsters: [] }, ...(format !== "ffa3" ? { p3: { hand: [], grave: [], monsters: [] } } : {}) }),
      ],
    }),
    defineScenario({
      id: `opponent-decision-pick-${format}-summonite-after-own-monster-selection`,
      title: `${format}: Summonite targets three own monsters at activation, then selects one before picking the deciding opponent`,
      source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION"],
      tags: ["multiplayer", "opponent-pick", format, "card:91592030"],
      setup: { format, p0: { spells: [{ card: SUMMONITE, pos: "set" }], grave: [ELF, OX, GUARDIAN] }, ...rest },
      steps: [
        activate(SUMMONITE, "p0"), select(ELF, OX, GUARDIAN),
        expectPrompt({ by: "p1", context: "chain" }), pass("p1"),
        expectPrompt({ by: "p0", kind: "cards" }), select(OX),
        expectPickSeats(opponents, "p0"), pickOpponent(picked, "p0"),
        expectPrompt({ by: picked, kind: "choice" }), choose("Special Summon the chosen monster", picked),
        expectBoard({ p0: { monsters: [OX], grave: [SUMMONITE, ELF, GUARDIAN] }, p1: { spells: [MST], grave: [], monsters: [] }, p2: { grave: [], monsters: [] }, ...(format !== "ffa3" ? { p3: { grave: [], monsters: [] } } : {}) }),
      ],
    }),
    defineScenario({
      id: `opponent-decision-pick-${format}-vaalmonica-versare-resolution`,
      title: `${format}: Vaalmonica Versare chooses its opponent after the response window; the damage is to the activator`,
      source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION"],
      tags: ["multiplayer", "opponent-pick", format, "card:42193638"],
      setup: { format, p0: { hand: ["Vaalmonica Versare"], deck: ["Vaalmonica Scelta"] }, ...rest },
      steps: [
        activate("Vaalmonica Versare", "p0"), expectPrompt({ by: "p1", context: "chain" }), pass("p1"),
        expectPickSeats(opponents, "p0"), pickOpponent(picked, "p0"),
        choose("Take 500 damage", picked), yes("p0"),
        expectBoard({ p0: { lp: (format === "tag" ? 16000 : 8000) - 500, grave: ["Vaalmonica Versare", "Vaalmonica Scelta"] }, p1: { spells: [MST], lp: format === "tag" ? 16000 : 8000 }, p2: { grave: [], monsters: [] }, ...(format !== "ffa3" ? { p3: { grave: [], monsters: [] } } : {}) }),
      ],
    }),
  ];
});

OPPONENT_DECISION_PICK_SCENARIOS.push(defineScenario({
  id: "opponent-decision-pick-ffa4-excludes-eliminated-seat",
  title: "FFA4: Painful Choice offers only living opponents when one seat was eliminated before resolution",
  source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION", "R-FFA-ELIMINATION"],
  tags: ["multiplayer", "opponent-pick", "elimination", "ffa4", "card:74191942"],
  setup: { format: "ffa4", p0: { hand: [CHOICE], monsters: [ELF], deck: [ELF, OX, GUARDIAN, AXE, FANG] }, p1: {}, p2: {}, p3: {} },
  steps: [
    eliminate("p1", 1), changePosition(ELF, "p0"), expectEliminated("p1"),
    activate(CHOICE, "p0"), select(ELF, OX, GUARDIAN, AXE, FANG),
    expectPickSeats(["p2", "p3"], "p0"), pickOpponent("p3", "p0"),
    expectPrompt({ by: "p3", kind: "cards" }), { op: "select", sels: [AXE], by: "p3" },
    expectBoard({ p0: { hand: [AXE], grave: [CHOICE, ELF, OX, GUARDIAN, FANG], monsters: [ELF] }, p2: { hand: [], monsters: [] }, p3: { hand: [], monsters: [] } }),
  ],
}));

// The fixture replaces the library helper with a same-name card wrapper that
// damages an opponent. It must still declare that recipient at activation.
export const OPPONENT_DECISION_WRAPPER_SCENARIOS: Scenario[] = (["ffa3", "ffa4"] as const).map((format) => {
  const opponents: DuelistId[] = format === "ffa3" ? ["p1", "p2"] : ["p1", "p2", "p3"];
  const picked = opponents.at(-1)!;
  return defineScenario({
    id: `opponent-decision-pick-${format}-unrelated-wrapper-still-declares`,
    title: `${format}: a same-name card wrapper still declares its damage recipient at activation`,
    source: "Core patch 0100 analyzer boundary proof (synthetic operation, not a Painful Choice ruling)",
    rules: ["R-FFA-OPP-ONE"], tags: ["multiplayer", "opponent-pick", format, "fixture:unrelated-wrapper"],
    setup: { format, p0: { hand: [CHOICE], deck: [ELF, OX, GUARDIAN, AXE, FANG] }, p1: { spells: [{ card: MST, pos: "set" }] }, p2: {}, ...(format === "ffa4" ? { p3: {} } : {}) },
    steps: [
      activate(CHOICE, "p0"), expectPickSeats(opponents, "p0"), pickOpponent(picked, "p0"),
      expectPrompt({ by: "p1", context: "chain" }), pass("p1"),
      expectBoard({ p0: { lp: 8000, grave: [CHOICE], hand: [] }, p1: { lp: 8000, spells: [MST] }, p2: { lp: picked === "p2" ? 7500 : 8000 }, ...(format === "ffa4" ? { p3: { lp: 7500 } } : {}) }),
    ],
  });
});

OPPONENT_DECISION_PICK_SCENARIOS.push(defineScenario({
  id: "opponent-decision-pick-ffa4-surrender-during-seat-choice",
  title: "FFA4: surrender removes its resolution seat option without reindexing; elimination waits until the chain finishes",
  source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION", "R-FFA-ELIMINATION", "R-COMMON-SURRENDER-EOT"],
  tags: ["multiplayer", "opponent-pick", "elimination", "ffa4", "card:74191942"],
  setup: { format: "ffa4", p0: { hand: [CHOICE], deck: [ELF, OX, GUARDIAN, AXE, FANG] }, p1: {}, p2: {}, p3: {} },
  steps: [
    activate(CHOICE, "p0"), select(ELF, OX, GUARDIAN, AXE, FANG),
    expectPickSeats(["p1", "p2", "p3"], "p0"), surrender("p1"),
    expectPickSeats(["p2", "p3"], "p0"), pickOpponent("p3", "p0"),
    expectPrompt({ by: "p3", kind: "cards" }), { op: "select", sels: [AXE], by: "p3" },
    expectEliminated("p1"),
    expectBoard({ p0: { hand: [AXE], grave: [CHOICE, ELF, OX, GUARDIAN, FANG] }, p2: { hand: [], monsters: [] }, p3: { hand: [], monsters: [] } }),
  ],
}));

// Exercise both Summonite outcomes with the same resolution-time chooser.
OPPONENT_DECISION_PICK_SCENARIOS.push(...OPPONENT_DECISION_PICK_SCENARIOS.filter((s) => s.id.endsWith("summonite-after-own-monster-selection")).map((base) => defineScenario({
  ...base,
  id: base.id.replace("after-own-monster-selection", "other-monsters-outcome"),
  title: `${base.setup.format}: Summonite's selected opponent chooses the other two monsters at resolution`,
  steps: base.steps.map((step) => step.op === "choose" ? { ...step, match: "Special Summon the other monsters" }
    : step.op === "expectBoard" ? { ...step, board: { ...step.board, p0: { monsters: [ELF, GUARDIAN], grave: [SUMMONITE, OX] } } } : step),
})));

OPPONENT_DECISION_PICK_SCENARIOS.push(defineScenario({
  id: "opponent-decision-pick-ffa3-one-living-opponent-is-automatic",
  title: "FFA3: the only living opponent decides without a resolution seat prompt",
  source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION", "R-FFA-ELIMINATION"],
  tags: ["multiplayer", "opponent-pick", "elimination", "ffa3", "card:74191942"],
  setup: { format: "ffa3", p0: { hand: [CHOICE], monsters: [ELF], deck: [ELF, OX, GUARDIAN, AXE, FANG] }, p1: {}, p2: {} },
  steps: [
    eliminate("p1", 1), changePosition(ELF, "p0"), expectEliminated("p1"),
    activate(CHOICE, "p0"), select(ELF, OX, GUARDIAN, AXE, FANG),
    expectPrompt({ by: "p2", kind: "cards" }), { op: "select", sels: [AXE], by: "p2" },
    expectBoard({ p0: { hand: [AXE], grave: [CHOICE, ELF, OX, GUARDIAN, FANG], monsters: [ELF] }, p2: { hand: [], monsters: [] } }),
  ],
}));

OPPONENT_DECISION_PICK_SCENARIOS.push(defineScenario({
  id: "opponent-decision-pick-ffa3-rescute-rescue-condition-does-not-declare",
  title: "FFA3: Rescute Rescue needs one opponent with higher LP but a different opponent may decide at resolution",
  source: SOURCE_RULE, rules: ["R-COMMON-OPP-DECISION", "R-FFA-OPP-ONE"],
  tags: ["multiplayer", "opponent-pick", "ffa3", "card:97926515"],
  setup: { format: "ffa3", p0: { lp: 4000, hand: ["Emerging Emergency Rescute Rescue"], deck: ["Rescue Rabbit", "Rescue Cat", "Rescue Hamster", "Rescue Ferret"] }, p1: { lp: 8000, spells: [{ card: MST, pos: "set" }] }, p2: { lp: 2000 } },
  steps: [
    activate("Emerging Emergency Rescute Rescue", "p0"), expectPrompt({ by: "p1", context: "chain" }), pass("p1"),
    select("Rescue Rabbit", "Rescue Cat", "Rescue Hamster"), expectPickSeats(["p1", "p2"], "p0"), pickOpponent("p2", "p0"),
    expectPrompt({ by: "p2", kind: "cards" }), { op: "select", sels: ["Rescue Cat"], by: "p2" },
    expectBoard({ p0: { lp: 4000, hand: ["Rescue Cat"], grave: ["Emerging Emergency Rescute Rescue"] }, p1: { lp: 8000, spells: [MST] }, p2: { lp: 2000, hand: [], monsters: [] } }),
  ],
}));
