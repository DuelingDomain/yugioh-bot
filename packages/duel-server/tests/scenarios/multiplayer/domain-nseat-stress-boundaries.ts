import { activate, endTurn, expectNotOffered, normalSummon, select, type Scenario } from "../../support/dsl.js";
import { PARTNER, turnsBefore, type Format, type Seat } from "./seat-kit.js";
import { stressBoard as board, stressScenario as scenario, stressSetup as setup } from "./domain-nseat-stress.js";

const OUT = { inZone: false, returns: 0, nextCost: 0 };
export const DOMAIN_NSEAT_STRESS_BOUNDARIES: Scenario[] = [];
for (const [format, seat] of [["ffa3", "p2"], ["ffa4", "p3"], ["tag", "p2"], ["tag", "p3"]] as Array<[Format, Seat]>) {
  DOMAIN_NSEAT_STRESS_BOUNDARIES.push(scenario(format, `proper-fusion-filter-rejects-incompatible-master-by-${seat}`, {
    setup: setup(format, { [seat]: { deckMaster: "Gaia the Dragon Champion", hand: ["Polymerization"],
      monsters: ["Elemental HERO Avian", "Elemental HERO Burstinatrix"], extra: ["Elemental HERO Flame Wingman", "Elemental HERO Phoenix Enforcer"] } }),
    steps: [...turnsBefore(format, seat), activate("Polymerization", seat),
      expectNotOffered("choice", "Gaia the Dragon Champion", seat), select("Elemental HERO Flame Wingman"),
      select("Elemental HERO Avian", "Elemental HERO Burstinatrix"),
      board(format, { [seat]: { monsters: ["Elemental HERO Flame Wingman"],
        grave: ["Polymerization", "Elemental HERO Avian", "Elemental HERO Burstinatrix"] } })],
  }));
}

for (const seat of ["p2", "p3"] as const) {
  const partner = PARTNER[seat];
  const tagSetup = setup("tag", { [partner]: { deckMaster: "Elemental HERO Avian" },
    [seat]: { hand: ["Polymerization"], monsters: ["Elemental HERO Burstinatrix"], extra: ["Elemental HERO Flame Wingman"] } });
  DOMAIN_NSEAT_STRESS_BOUNDARIES.push(
    scenario("tag", `matching-partner-zone-master-is-not-material-by-${seat}`, {
      setup: tagSetup,
      steps: [...turnsBefore("tag", seat), expectNotOffered("activate", "Polymerization", seat), endTurn(seat),
        board("tag", { [seat]: { monsters: ["Elemental HERO Burstinatrix"] } })],
    }),
    scenario("tag", `matching-partner-field-master-is-material-by-${seat}`, {
      setup: tagSetup,
      steps: [...turnsBefore("tag", seat).flatMap((step) => step.op === "phase" && step.by === partner
        ? [normalSummon({ card: "Elemental HERO Avian", from: "dmz" }, partner), step] : [step]),
        board("tag", { [partner]: { monsters: ["Elemental HERO Avian"], deckMaster: OUT }, [seat]: { monsters: ["Elemental HERO Burstinatrix"] } }),
        activate("Polymerization", seat), select("Elemental HERO Avian", "Elemental HERO Burstinatrix"),
        board("tag", { [partner]: { grave: ["Elemental HERO Avian"], deckMaster: OUT },
          [seat]: { monsters: ["Elemental HERO Flame Wingman"], grave: ["Polymerization", "Elemental HERO Burstinatrix"] } })],
    }),
  );
}
