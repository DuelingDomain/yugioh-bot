import {
  activate, defineScenario, endTurn, expectBoard, expectPrompt, pickOpponent, select, normalSummon, faceDown as set,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";

const ELF = "Mystical Elf", OX = "Battle Ox", MAGE = "Performage Hat Tricker";
export const CONTROL_OWNER_RETURN_SCENARIOS: Scenario[] = [];
for (const domain of [false, true]) for (const format of ["ffa3", "ffa4", "tag", "1v1"] as const) {
  const seats: DuelistId[] = format === "1v1" ? ["p0", "p1"] : format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const owners = format === "1v1" ? ["p1"] as DuelistId[] : format === "ffa3" ? ["p2"] as DuelistId[] : ["p2", "p3"] as DuelistId[];
  for (const owner of owners) {
    const oi = seats.indexOf(owner), thief: DuelistId = format === "tag" && oi % 2 === 0 ? "p1" : "p0";
    const ti = seats.indexOf(thief);
    const sealSetup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" } : {}) };
    const sealBoard: BoardExpect = {};
    for (const [i, seat] of seats.entries()) {
      const drawn = i === 0 ? Number(domain && format !== "1v1") : Number(i <= ti);
      sealSetup[seat] = { monsters: seat === owner ? [OX, ELF] : [],
        hand: seat === thief ? ["Change of Heart", "Owner's Seal"] : [], deck: Array(20).fill(ELF),
        ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
      sealBoard[seat] = { monsters: seat === owner ? [OX, ELF] : [],
        lp: format === "tag" ? 16000 : 8000, spells: [], grave: seat === thief ? ["Change of Heart", "Owner's Seal"] : [],
        hand: Array(drawn).fill(ELF), deckCount: 20 - drawn, banished: [], extra: [],
        ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}) };
    }
    CONTROL_OWNER_RETURN_SCENARIOS.push(defineScenario({
      id: `owner-control-${format}-${domain ? "domain" : "standard"}-owners-seal-real-${owner}`,
      title: `Owner's Seal returns the stolen monster to its real owner ${owner}`,
      source: "Stock Owner's Seal 9720537; owner decision 2026-10-02 afternoon",
      rules: ["R-COMMON-RETURN-TO-OWNER"], tags: ["owner-return", "stock-card", format], setup: sealSetup,
      steps: [...seats.slice(0, ti).map(seat => endTurn(seat)), activate("Change of Heart", thief),
        select({ card: OX, owner }), expectPrompt({ by: thief, context: "action" }),
        activate("Owner's Seal", thief), expectPrompt({ by: thief, context: "action" }), expectBoard(sealBoard)],
    }));
    const goyoSetup: Scenario["setup"] = { ...sealSetup, [thief]: { ...sealSetup[thief], monsters: ["Goyo Emperor"], hand: ["Change of Heart", "Summoned Skull"] } };
    const goyoBoard: BoardExpect = { ...sealBoard, [thief]: { ...sealBoard[thief], monsters: ["Summoned Skull"], grave: ["Change of Heart", "Goyo Emperor"] } };
    CONTROL_OWNER_RETURN_SCENARIOS.push(defineScenario({
      id: `owner-control-${format}-${domain ? "domain" : "standard"}-goyo-emperor-real-${owner}`,
      title: `Goyo Emperor returns the stolen monster to its real owner ${owner} when it leaves`,
      source: "Stock Goyo Emperor 59255742; owner decision 2026-10-02 afternoon",
      rules: ["R-COMMON-RETURN-TO-OWNER"], tags: ["owner-return", "stock-card", format], setup: goyoSetup,
      steps: [...seats.slice(0, ti).map(seat => endTurn(seat)), activate("Change of Heart", thief),
        select({ card: OX, owner }), expectPrompt({ by: thief, context: "action" }),
        normalSummon("Summoned Skull", thief), select({ card: "Goyo Emperor", owner: thief }),
        expectPrompt({ by: thief, context: "action" }), expectBoard(goyoBoard)],
    }));
    const victim: DuelistId = format === "tag" ? (oi % 2 === 0 ? "p1" : "p0") : format === "1v1" ? "p0" : "p1";
    const setup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" } : {}) };
    const board = (returned: boolean): BoardExpect => Object.fromEntries(seats.map((seat, i) => {
      const drawn = (i === 0 ? Number(domain && format !== "1v1") : Number(i <= oi)) + Number(returned && i === (oi + 1) % seats.length);
      return [seat, { monsters: [...(seat === (returned ? owner : victim) ? [MAGE] : []), ...(seat === (returned ? victim : owner) ? [OX] : []), ...(seat !== owner && seat !== victim && format.startsWith("ffa") ? [ELF] : [])],
        lp: format === "tag" ? 16000 : 8000, spells: [], grave: seat === owner ? ["Offerings to the Doomed", "Trick Box"] : [],
        hand: Array(drawn).fill(ELF), deckCount: 20 - drawn, banished: [], extra: [],
        ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}) }];
    }));
    for (const seat of seats) setup[seat] = { monsters: seat === owner ? [MAGE] : seat === victim ? [OX] : format.startsWith("ffa") ? [ELF] : [],
      hand: seat === owner ? ["Offerings to the Doomed"] : [], spells: seat === owner ? [set("Trick Box")] : [],
      deck: Array(20).fill(ELF), ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
    const steps: Step[] = [...seats.slice(0, oi).map(seat => endTurn(seat)), activate("Offerings to the Doomed", owner),
      select({ card: MAGE, owner }), activate("Trick Box", owner),
      ...(format.startsWith("ffa") || format === "tag" ? [pickOpponent(victim, owner)] : []),
      expectPrompt({ by: owner, context: "action" }), expectBoard(board(false)), endTurn(owner),
      expectPrompt({ by: seats[(oi + 1) % seats.length], context: "action" }), expectBoard(board(true))];
    CONTROL_OWNER_RETURN_SCENARIOS.push(defineScenario({
      id: `owner-control-${format}-${domain ? "domain" : "standard"}-trick-box-real-${owner}`,
      title: `Stock Trick Box returns the Performage to its real owner ${owner} at End Phase`,
      source: "Stock Trick Box 93983867; owner decision 2026-10-02 afternoon",
      rules: ["R-COMMON-RETURN-TO-OWNER"], tags: ["owner-return", "stock-card", format], setup, steps,
    }));
  }
}

// One Owner's Seal must retain two different owner seats in the same activation.
for (const domain of [false, true]) {
  const setup: Scenario["setup"] = { format: "ffa4", ...(domain ? { mode: "domain" } : {}) };
  const board: BoardExpect = {};
  for (const seat of ["p0", "p1", "p2", "p3"] as const) {
    const monsters = seat === "p2" ? [OX, ELF] : seat === "p3" ? ["Summoned Skull", ELF] : [ELF];
    setup[seat] = { monsters, hand: seat === "p0" ? ["Change of Heart", "Mind Control", "Owner's Seal"] : [],
      deck: Array(20).fill(ELF), ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
    board[seat] = { monsters, spells: [], grave: seat === "p0" ? ["Change of Heart", "Mind Control", "Owner's Seal"] : [],
      lp: 8000, hand: seat === "p0" && domain ? [ELF] : [], deckCount: seat === "p0" && domain ? 19 : 20,
      banished: [], extra: [], ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}) };
  }
  CONTROL_OWNER_RETURN_SCENARIOS.push(defineScenario({
    id: `owner-control-ffa4-${domain ? "domain" : "standard"}-owners-seal-two-real-owners`,
    title: "One Owner's Seal returns stolen monsters to p2 and p3",
    source: "Stock Owner's Seal 9720537; owner decision 2026-10-02 afternoon",
    rules: ["R-COMMON-RETURN-TO-OWNER"], tags: ["owner-return", "stock-card", "ffa4"], setup,
    steps: [activate("Change of Heart", "p0"), pickOpponent("p2", "p0"), select({ card: OX, owner: "p2" }),
      activate("Mind Control", "p0"), pickOpponent("p3", "p0"), select({ card: "Summoned Skull", owner: "p3" }),
      activate("Owner's Seal", "p0"), expectPrompt({ by: "p0", context: "action" }), expectBoard(board)],
  }));
}
