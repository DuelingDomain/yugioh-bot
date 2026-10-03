import { activate, endTurn, expectNotOffered, expectOffered, expectPickOptions, normalSummon, select, specialSummon, type Scenario } from "../../support/dsl.js";
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
  // Gaia is legal for a proper Fusion Summon when its materials are present. An ordinary
  // Extra Deck query must still exclude its Deck Master zone, even with those materials.
  const materials = ["Gaia The Fierce Knight", "Curse of Dragon", "Elemental HERO Avian", "Elemental HERO Burstinatrix"];
  const extra = ["Elemental HERO Flame Wingman", "Elemental HERO Phoenix Enforcer"];
  DOMAIN_NSEAT_STRESS_BOUNDARIES.push(
    scenario(format, `ordinary-extra-filter-rejects-master-with-materials-by-${seat}`, {
      setup: setup(format, { [seat]: { deckMaster: "Gaia the Dragon Champion", hand: ["Fusion Conscription"],
        monsters: materials, grave: ["Gaia The Fierce Knight", "Elemental HERO Avian", "Elemental HERO Burstinatrix"], extra } }),
      steps: [...turnsBefore(format, seat), activate("Fusion Conscription", seat),
        expectNotOffered("choice", "Gaia the Dragon Champion", seat),
        expectPickOptions(extra.map(card => ({ card })), seat), select("Elemental HERO Flame Wingman"),
        select({ card: "Elemental HERO Avian", from: "grave" }),
        board(format, { [seat]: { monsters: materials, extra,
          hand: { include: ["Elemental HERO Avian"], exclude: ["Fusion Conscription"], count: 2 },
          grave: ["Fusion Conscription", "Gaia The Fierce Knight", "Elemental HERO Burstinatrix"] } })],
    }),
    scenario(format, `proper-fusion-offers-master-with-materials-by-${seat}`, {
      setup: setup(format, { [seat]: { deckMaster: "Gaia the Dragon Champion", hand: ["Polymerization"],
        monsters: materials, extra } }),
      steps: [...turnsBefore(format, seat), activate("Polymerization", seat),
        expectOffered("choice", "Gaia the Dragon Champion", seat),
        expectPickOptions([...extra, "Gaia the Dragon Champion"].map(card => ({ card })), seat),
        select("Gaia the Dragon Champion"), select("Gaia The Fierce Knight", "Curse of Dragon"),
        board(format, { [seat]: { monsters: ["Gaia the Dragon Champion", "Elemental HERO Avian", "Elemental HERO Burstinatrix"],
          grave: ["Polymerization", "Gaia The Fierce Knight", "Curse of Dragon"],
          extra, hand: { count: 1 }, deckMaster: OUT } })],
    }),
  );
  const opponent = format === "tag" && seat === "p2" ? "p1" : "p0";
  DOMAIN_NSEAT_STRESS_BOUNDARIES.push(scenario(format, `synchro-master-rejects-opponent-material-by-${seat}`, {
    setup: setup(format, { [opponent]: { monsters: ["The Magical King of Dimension Zeta"] },
      [seat]: { deckMaster: "Stardust Dragon", monsters: ["Axe Raider"] } }),
    steps: [...turnsBefore(format, seat), expectNotOffered("specialSummon", { card: "Stardust Dragon", from: "dmz" }, seat),
      endTurn(seat), board(format, { [opponent]: { monsters: ["The Magical King of Dimension Zeta"] }, [seat]: { monsters: ["Axe Raider"] } })],
  }));
}

for (const seat of ["p2", "p3"] as const) {
  const partner = PARTNER[seat];
  const tagSetup = setup("tag", { [partner]: { deckMaster: "Elemental HERO Avian" },
    [seat]: { hand: ["Polymerization"], monsters: ["Elemental HERO Burstinatrix"], extra: ["Elemental HERO Flame Wingman"] } });
  DOMAIN_NSEAT_STRESS_BOUNDARIES.push(
    scenario("tag", `synchro-master-uses-partner-material-by-${seat}`, {
      setup: setup("tag", { [partner]: { monsters: ["The Magical King of Dimension Zeta"] },
        [seat]: { deckMaster: "Stardust Dragon", monsters: ["Axe Raider"] } }),
      steps: [...turnsBefore("tag", seat), specialSummon({ card: "Stardust Dragon", from: "dmz" }, seat),
        select("The Magical King of Dimension Zeta", "Axe Raider"),
        board("tag", { [partner]: { grave: ["The Magical King of Dimension Zeta"] },
          [seat]: { monsters: ["Stardust Dragon"], grave: ["Axe Raider"], deckMaster: OUT } })],
    }),
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
