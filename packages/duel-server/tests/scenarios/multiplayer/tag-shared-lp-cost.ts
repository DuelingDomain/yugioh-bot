import { activate, defineScenario, expectNotOffered, expectOffered, expectPrompt, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, PARTNER, SEATS, turnsBefore, type Seat } from "./seat-kit.js";

const CARD = "Cosmic Cyclone";
const SPELL = "Dark Room of Nightmare";

function cost(actor: Seat, lp: number): Scenario {
  const target: Seat = actor === "p2" ? "p3" : "p2";
  const leader = PARTNER[actor];
  const canPay = lp >= 1000;
  return defineScenario({
    id: `tag-${actor}-cosmic-cyclone-shared-lp-${lp}`,
    title: `Tag: ${actor} ${canPay ? "pays 1000 LP from the shared team total" : "cannot pay 1000 LP from a team total of 900"}`,
    source: `${SOURCE} [R-TAG-LP]: a member pays an LP cost from the shared team total`,
    rules: ["R-TAG-LP"],
    tags: ["multiplayer", "tag", "lp-cost", "card:8267140"],
    setup: baseSetup("tag", Object.fromEntries(SEATS.tag.map((seat) => [seat, { spells: [SPELL], ...(seat === leader ? { lp } : {}), ...(seat === actor ? { hand: [CARD] } : {}) }]))),
    steps: [
      ...turnsBefore("tag", actor),
      // The Quick-Play Spell can be offered in Draw and Standby. The action check below requires Main Phase.
      ...Array.from({ length: canPay ? 3 : 0 }, () => ({ op: "pass", by: actor } as const)),
      expectPrompt({ by: actor, context: "action" }),
      ...(canPay ? [expectOffered("activate", CARD, actor), activate(CARD, actor), { op: "select" as const, sels: [{ card: SPELL, owner: target }], by: actor }] : [expectNotOffered("activate", CARD, actor)]),
      everySeat("tag", {
        ...Object.fromEntries(SEATS.tag.map((seat) => [seat, { spells: [SPELL] }])),
        [actor]: { spells: [SPELL], lp: canPay ? lp - 1000 : lp, grave: canPay ? [CARD] : [], hand: canPay ? ["Mystical Elf"] : [CARD, "Mystical Elf"] },
        [target]: { spells: canPay ? [] : [SPELL], banished: canPay ? [SPELL] : [] },
      }),
    ],
  });
}

export const TAG_SHARED_LP_COST_SCENARIOS = [cost("p2", 1200), cost("p3", 1200), cost("p2", 900), cost("p3", 900)];
