import {
  activate, defineScenario, endTurn, expectBoard, expectPickSeats, expectPrompt, expectTurn, faceDown,
  normalSummon, pickOpponent, select, xyz, type Scenario, type Step,
} from "../../support/dsl.js";
import { COMPARE_GAP_SCENARIOS } from "./compare-gaps.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_COPY_SCENARIOS } from "./tag-copies.js";

const ELF = "Mystical Elf";
const UTOPIA = "Number 39: Utopia";
const DRAGON = "Blue-Eyes White Dragon";
const SOURCE = "Owner 2026-10-18; docs/adr/0002-multiplayer-duel-rules.md [R-TAG-SHARED-CARDS] [R-TAG-PARTNER] [R-TAG-ORDER]";

function tagScenario(id: string, card: number, title: string, setup: Scenario["setup"], steps: Step[]): Scenario {
  return defineScenario({ id: `unban-audit-tag-${id}`, title, source: SOURCE,
    rules: ["R-TAG-SHARED-CARDS", "R-TAG-PARTNER", "R-TAG-ORDER"], tags: ["multiplayer", "unban-audit", "tag", `card:${card}`],
    setup: { format: "tag", skipOpeningDraw: true, deckSize: 20, ...setup }, steps });
}

function skipTurn(card: "Tellarknight Ptolemaeus" | "The Six Shinobi"): Scenario {
  const pto = card === "Tellarknight Ptolemaeus";
  const samurai = ["The Six Samurai - Zanji", "The Six Samurai - Yaichi", "The Six Samurai - Yariza",
    "The Six Samurai - Nisashi", "The Six Samurai - Kamon", "Legendary Six Samurai - Shi En"];
  const scenario = tagScenario(`${pto ? "ptolemaeus" : "six-shinobi"}-far-member-unsupported`, pto ? 18326736 : 6357341,
    `${card}: selecting p3 incorrectly skips p1; Tag member binding is unsupported`,
    pto ? { p0: { monsters: [xyz(card, Array(7).fill(ELF))] } }
      : { p0: { spells: [faceDown(card)], monsters: samurai.slice(0, 3) }, p2: { monsters: samurai.slice(3) } },
    [activate(card, "p0"), expectPickSeats(["p1", "p3"], "p0"), pickOpponent("p3", "p0"),
      expectBoard(pto ? { p0: { grave: Array(7).fill(ELF), zones: { m0: { card, materials: 0 } } } }
        : { p0: { grave: [card], spells: [], monsters: samurai.slice(0, 3) }, p2: { monsters: samurai.slice(3) } }),
      endTurn("p0"), expectTurn("p2"), endTurn("p2"), expectTurn("p3"), endTurn("p3"),
      expectTurn("p0"), endTurn("p0"), expectTurn("p1"),
      expectBoard({ p1: { hand: [ELF], deckCount: 19 }, p2: { hand: [ELF], deckCount: 19 }, p3: { hand: [ELF], deckCount: 19 } })]);
  // This records the engine gap. It is not evidence for allowing the card in Tag.
  return defineScenario({ ...scenario, rules: [], tags: [...scenario.tags, "unsupported"] });
}

const doom = tagScenario("doom-virus-opposing-field", 22804644,
  "Doom Virus Dragon destroys the opposing field and keeps its partner's cards",
  { p0: { hand: ["The Fang of Critias", "Crush Card Virus"], extra: ["Doom Virus Dragon"] },
    p1: { hand: [DRAGON], monsters: [DRAGON] }, p2: { hand: [DRAGON], monsters: [DRAGON] }, p3: { monsters: [DRAGON] } },
  [activate("The Fang of Critias", "p0"), expectPickSeats(["p1", "p3"], "p0"), pickOpponent("p1", "p0"),
    expectPrompt({ by: "p0", context: "action" }),
    expectBoard({ p0: { monsters: ["Doom Virus Dragon"], hand: [], grave: ["The Fang of Critias", "Crush Card Virus"] },
      p1: { monsters: [], hand: [], grave: [DRAGON, DRAGON] }, p2: { monsters: [DRAGON], hand: [DRAGON], grave: [] },
      p3: { monsters: [], hand: [], grave: [DRAGON] } })]);

function grisaille(): Scenario {
  const card = "Grisaille Prison";
  const locked = { p0: { zones: { m1: { card: UTOPIA, negated: true } } },
    p1: { zones: { m0: { card: UTOPIA, negated: true } } }, p2: { zones: { m0: { card: UTOPIA, negated: true } } },
    p3: { zones: { m0: { card: UTOPIA, negated: true } } } };
  const clear = { p0: { zones: { m1: { card: UTOPIA, negated: false } } },
    p1: { zones: { m0: { card: UTOPIA, negated: false } } }, p2: { zones: { m0: { card: UTOPIA, negated: false } } },
    p3: { zones: { m0: { card: UTOPIA, negated: false } } } };
  return tagScenario("grisaille-next-opposing-end", 22888900,
    "Grisaille Prison negates all four fields until the next opposing End Phase",
    { p0: { hand: ["Summoned Skull"], spells: [faceDown(card)], monsters: [ELF, UTOPIA] },
      p1: { monsters: [UTOPIA] }, p2: { monsters: [UTOPIA] }, p3: { monsters: [UTOPIA] } },
    [normalSummon("Summoned Skull", "p0"), select({ card: ELF, owner: "p0" }), activate(card, "p0"),
      expectBoard(locked), endTurn("p0"), expectTurn("p1"), expectBoard(locked),
      endTurn("p1"), expectTurn("p2"), expectBoard(clear),
      expectBoard({ p0: { grave: [ELF, card], spells: [], monsters: ["Summoned Skull", UTOPIA] } })]);
}

const kaiserFfa3 = COMPARE_GAP_SCENARIOS.find(scenario => scenario.id === "compare-gaps-ffa3-kaiser-colosseum-limit-counts-the-summoner-only")!;
const kaiserFfa4 = structuredClone(kaiserFfa3);
kaiserFfa4.setup = { ...kaiserFfa4.setup, format: "ffa4", p3: { monsters: ["Beaver Warrior"] } };
for (const step of kaiserFfa4.steps) if (step.op === "expectBoard") {
  step.board.p3 = { lp: 8000, monsters: ["Beaver Warrior"], spells: [], grave: [], banished: [] };
}
const kaiser = [
  { ...kaiserFfa3, id: "unban-audit-kaiser-ffa3" },
  { ...kaiserFfa4, id: "unban-audit-kaiser-ffa4" },
  ...TAG_COPY_SCENARIOS.filter(scenario => scenario.id.startsWith("tag-copies-kaiser-colosseum-")).map(scenario => ({ ...scenario,
    id: scenario.id.includes("partner-monster") ? "unban-audit-kaiser-tag-partner-limit" : "unban-audit-kaiser-tag-within-limit" })),
].map(scenario => defineScenario({ ...scenario, setup: { ...scenario.setup, skipOpeningDraw: true } }));

const standard = [doom, skipTurn("Tellarknight Ptolemaeus"), skipTurn("The Six Shinobi"), grisaille(), ...kaiser];
export const UNBAN_AUDIT_TAG_SCENARIOS: Scenario[] = [...standard, ...standard.map(domainVariant)];
