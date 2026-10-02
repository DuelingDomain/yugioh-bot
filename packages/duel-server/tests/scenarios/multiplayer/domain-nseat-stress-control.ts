import { activate, attack, endTurn, expectEliminated, expectPickOptions, expectPrompt, expectResult, faceDown, no, normalSummon, pickOpponent, select, surrender, type Scenario } from "../../support/dsl.js";
import { SEATS, turnsBefore, type Seat } from "./seat-kit.js";
import { stressBoard as board, stressScenario as scenario, stressSetup as setup, STRESS_MASTERS as MASTERS } from "./domain-nseat-stress.js";

const OUT = { inZone: false, returns: 0, nextCost: 0 };
export const DOMAIN_NSEAT_STRESS_CONTROL: Scenario[] = [];
for (const format of ["ffa3", "ffa4", "tag"] as const) {
  const owner: Seat = format === "ffa3" ? "p2" : "p3";
  const summon = [...turnsBefore(format, owner), normalSummon({ card: MASTERS[owner], from: "dmz" }, owner), endTurn(owner)];
  DOMAIN_NSEAT_STRESS_CONTROL.push(
    scenario(format, "temporary-control-return-keeps-the-master-on-field", {
      setup: setup(format, { p0: { hand: ["Change of Heart"] }, [owner]: { monsters: ["Mystical Elf"] } }),
      steps: [...summon, activate("Change of Heart", "p0"), select({ card: MASTERS[owner], owner }), endTurn("p0"),
        expectPrompt({ by: "p1", context: "action" }),
        board(format, { p0: { grave: ["Change of Heart"] }, [owner]: { monsters: ["Mystical Elf", MASTERS[owner]], deckMaster: OUT } })],
    }),
    scenario(format, "battle-on-stolen-master-damages-current-controller", {
      setup: setup(format, { p0: { hand: ["Snatch Steal"] }, p1: { monsters: ["Blue-Eyes White Dragon"] } }),
      steps: [...summon, activate("Snatch Steal", "p0"), select({ card: MASTERS[owner], owner }), endTurn("p0"),
        attack("Blue-Eyes White Dragon", { card: MASTERS[owner], owner: "p0" }, "p1"),
        expectPrompt({ by: owner, context: "deck-master-recall" }), no(owner),
        board(format, { p0: { lp: format === "tag" ? 14300 : format === "ffa4" ? 6300 : 6700, grave: ["Snatch Steal"] },
          p1: { monsters: ["Blue-Eyes White Dragon"] }, [owner]: { grave: [MASTERS[owner]], deckMaster: OUT } })],
    }),
    scenario(format, "bounce-goes-to-original-owner-hand", {
      setup: setup(format, { p0: { spells: [faceDown("Compulsory Evacuation Device")] } }),
      steps: [...turnsBefore(format, owner), normalSummon({ card: MASTERS[owner], from: "dmz" }, owner), activate("Compulsory Evacuation Device", "p0"),
        expectPrompt({ by: owner, context: "deck-master-recall" }), no(owner),
        board(format, { p0: { grave: ["Compulsory Evacuation Device"] }, [owner]: { hand: { include: [MASTERS[owner]], count: 2 }, deckMaster: OUT } })],
    }),
    scenario(format, "opponent-compare-counts-the-field-master", {
      setup: setup(format, { p0: { spells: [faceDown("Pineapple Blast")] }, p1: { monsters: ["Silver Fang"] }, [owner]: { monsters: ["Mystical Elf"] } }),
      steps: [...summon, normalSummon({ card: MASTERS.p0, from: "dmz" }, "p0"), activate("Pineapple Blast", "p0"),
        ...(format === "tag" ? [pickOpponent(owner, "p0")] : []),
        expectPickOptions({ include: [{ card: MASTERS[owner], seat: owner }, { card: "Mystical Elf", seat: owner }], count: format === "tag" ? 3 : 2 }, owner),
        select({ card: MASTERS[owner], owner }),
        board(format, { p0: { monsters: [MASTERS.p0], grave: ["Pineapple Blast"], deckMaster: OUT },
          p1: format === "tag" ? { grave: ["Silver Fang"] } : { monsters: ["Silver Fang"] },
          [owner]: { monsters: [MASTERS[owner]], grave: ["Mystical Elf"], deckMaster: OUT } })],
    }),
    scenario(format, "drawing-empty-deck-loses-seat-or-team", {
      setup: { ...setup(format), deckSize: 1 },
      rules: [format === "tag" ? "R-TAG-LOSS" : "R-FFA-ELIMINATION"],
      steps: [...SEATS[format].map((seat) => endTurn(seat)), ...(format === "tag" ? [endTurn("p0")] : []),
        expectEliminated(format === "tag" ? ["p1", "p3"] : SEATS[format].slice(0, -1)),
        expectResult({ team: format === "tag" ? 0 : SEATS[format].length - 1, reason: "drawn" }),
        board(format, Object.fromEntries((format === "tag" ? ["p1", "p3"] : SEATS[format].slice(0, -1)).map((s) => [s, { deckMaster: OUT, hand: [], deckCount: 0 }])) )],
    }),
    scenario(format, "all-sides-lose-together-with-masters-in-their-zones", {
      setup: setup(format, Object.fromEntries(SEATS[format].map((seat) => [seat, { lp: 100, ...(seat === "p0" ? { hand: ["Dark Snake Syndrome"] } : {}) }]))),
      rules: ["R-COMMON-EACH-PLAYER", format === "tag" ? "R-TAG-LOSS" : "R-FFA-ELIMINATION"],
      // Dark Snake Syndrome uses the owner's Standby Phase, not the Tag partner's.
      steps: [activate("Dark Snake Syndrome", "p0"), ...SEATS[format].flatMap((seat) => [endTurn(seat),
        ...(format === "tag" && seat === "p1" ? [expectPrompt({ by: "p2", context: "action" }),
          board("tag", { p0: { lp: 100, spells: ["Dark Snake Syndrome"] }, p1: { lp: 100 } })] : [])]),
        expectResult({ team: null, reason: "lp" }),
        ...(format === "tag" ? [] : [expectEliminated(SEATS[format])]),
        board(format, Object.fromEntries(SEATS[format].map((seat) => [seat, { lp: 0,
          ...(format === "tag" ? (seat === "p0" ? { spells: ["Dark Snake Syndrome"] } : {}) : { hand: [], deckMaster: OUT }) }])) )],
    }),
    scenario(format, "recovery-goes-to-late-seat-or-its-team", {
      setup: setup(format, { [owner]: { hand: ["Dian Keto the Cure Master"] } }),
      rules: [format === "tag" ? "R-TAG-LP" : "R-FFA-LP"],
      steps: [...turnsBefore(format, owner), activate("Dian Keto the Cure Master", owner),
        board(format, { [owner]: { lp: format === "tag" ? 17000 : 9000, grave: ["Dian Keto the Cure Master"] } })],
    }),
  );
}

for (const format of ["ffa3", "ffa4"] as const) {
  DOMAIN_NSEAT_STRESS_CONTROL.push(scenario(format, "lost-thief-sends-master-to-living-owner-grave", {
    setup: setup(format, { p0: { hand: ["Change of Heart"] }, p2: { monsters: ["Mystical Elf"] } }),
    steps: [...turnsBefore(format, "p2"), normalSummon({ card: MASTERS.p2, from: "dmz" }, "p2"),
      ...SEATS[format].slice(2).map((seat) => endTurn(seat)), activate("Change of Heart", "p0"), select({ card: MASTERS.p2, owner: "p2" }),
      surrender("p0"), expectPrompt({ by: "p2", context: "deck-master-recall" }), no("p2"), expectEliminated("p0"),
      board(format, { p0: { hand: [], deckMaster: OUT }, p2: { monsters: ["Mystical Elf"], grave: [MASTERS.p2], deckMaster: OUT } })],
  }));
}

for (const format of ["ffa3", "ffa4"] as const) {
  const owner = SEATS[format].at(-1)!;
  DOMAIN_NSEAT_STRESS_CONTROL.push(scenario(format, "first-battle-window-skips-seat-lost-before-first-turn", {
    setup: setup(format, {}, false), rules: ["R-FFA-NO-ATTACK", "R-FFA-ORDER"],
    steps: [surrender(owner), ...SEATS[format].slice(0, -1).map((seat) => endTurn(seat)),
      expectEliminated(owner), expectPrompt({ by: "p0", context: "action", offers: ["to_bp"] }),
      board(format, { [owner]: { hand: [], deckMaster: OUT } })],
  }));
}
