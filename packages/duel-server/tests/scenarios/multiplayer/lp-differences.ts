import { activate, attack, choose, defineScenario, endTurn, no, pass, expectBoard, expectNotOffered, expectPickSeats, normalSummon, number, pickOpponent, select, specialSummon, surrender, yes, type Scenario, type Step } from "../../support/dsl.js";

const SOURCE = "Owner ruling 2026-10-23: multiplayer LP differences and equality";
const TARANTULA = "Number 35: Ravenous Tarantula";
const MYRIAD = "Myriaday Dragon";
const LYCORIS = "Lycoris Lilyreaper";
const COORDIUS = "Coordius the Triphasic Dealmon";
const SLASH = "Tsukumo Slash";
const PIG = "Pig Iron vs. Pen Peg";
export const LP_DIFFERENCE_SCENARIOS: Scenario[] = [];

for (const format of ["ffa3", "ffa4", "tag", "1v1"] as const) {
  const ffa = format === "ffa3" || format === "ffa4";
  const opponents = format === "ffa4" ? ["p1", "p2", "p3"] as const : ["p1", "p2"] as const;
  const totals = { p1: { lp: 7000 }, ...(format !== "1v1" ? { p2: { lp: 10000 } } : {}), ...(format === "ffa4" ? { p3: { lp: 12000 } } : format === "tag" ? { p3: { lp: 7000 } } : {}) };
  function add(code: number, name: string, setup: Scenario["setup"], steps: Step[], suffix = ""): void {
    LP_DIFFERENCE_SCENARIOS.push(defineScenario({ id: `lp-difference-${code}-${format}${suffix}`, title: `${name}: ${format}${suffix}`, source: SOURCE,
      rules: ["R-COMMON-OPP-PICK"], tags: ["multiplayer", "lp-difference", format, `card:${code}`],
      setup: { format, skipOpeningDraw: true, attackFirstTurn: true, ...totals, ...setup }, steps }));
  }
  add(90162951, TARANTULA, { p0: { lp: 5000, monsters: [TARANTULA], hand: ["Battle Ox"] }, ...(format === "tag" ? { p2: { lp: 5000 } } : {}) }, [
    ...(ffa ? [expectPickSeats([...opponents]), pickOpponent("p1")] : []),
    normalSummon("Battle Ox"), expectBoard({ p0: { zones: { m0: { card: TARANTULA, attack: 2000, defense: 2000, ...(ffa ? { lpOpponent: 1 } : {}) }, m1: { card: "Battle Ox", attack: 3700 } } } }),
    ...(ffa ? [surrender("p1"), expectBoard({ p0: { zones: { m0: { card: TARANTULA, attack: format === "ffa4" ? 7000 : 5000, lpOpponent: format === "ffa4" ? 3 : 2 } } } })] : []),
  ]);
  add(81758313, MYRIAD, { p0: { lp: 5000, monsters: [MYRIAD] }, ...(format === "tag" ? { p2: { lp: 5000 } } : {}) }, [
    activate(MYRIAD), ...(ffa ? [expectPickSeats([...opponents]), pickOpponent("p1")] : []),
    expectBoard({ p0: { ...(format === "1v1" ? { lp: 5100 } : {}), zones: { m0: { card: MYRIAD, ...(format === "1v1" ? {} : { counters: { 0x21d: 2 } }) } } } }),
  ]);
  add(81916745, LYCORIS, { p0: { lp: 5000, hand: ["Ookazi"], grave: [LYCORIS] }, p1: { lp: 7800 }, p2: format === "1v1" ? undefined : { lp: format === "tag" ? 5000 : 10000, monsters: ["Battle Ox", "Celtic Guardian"] }, ...(format === "1v1" ? { p1: { lp: 7800, monsters: ["Battle Ox", "Celtic Guardian"] } } : {}), ...(format === "tag" ? { p3: { lp: 7800 } } : {}) }, [
    activate("Ookazi"), ...(ffa ? [pickOpponent("p1")] : []), yes(),
    select("Battle Ox"), expectBoard({ p0: { banished: [LYCORIS], grave: ["Ookazi"] }, [format === "1v1" ? "p1" : "p2"]: { monsters: ["Celtic Guardian"], grave: ["Battle Ox"] }, p1: { lp: 7000, ...(format === "1v1" ? { monsters: ["Celtic Guardian"], grave: ["Battle Ox"] } : {}) } }),
  ]);
  add(70219023, COORDIUS, { p0: { lp: 9000, hand: ["Polymerization"], monsters: ["Stardust Dragon", "Number 39: Utopia", "Link Spider"], extra: [COORDIUS] }, p1: { lp: 9000 }, ...(format === "tag" ? { p2: { lp: 9000 }, p3: { lp: 9000 } } : {}) }, [
    activate("Polymerization"), select("Stardust Dragon", "Number 39: Utopia", "Link Spider"),
    activate(COORDIUS), ...(ffa ? [expectPickSeats([...opponents]), pickOpponent("p1")] : []), number(2000), choose("ATK"),
    expectBoard({ p0: { lp: 7000, zones: { m0: { card: COORDIUS, attack: 4000 } } } }),
  ]);
  add(25334372, SLASH, { p0: { lp: 5000, monsters: ["Battle Ox"], spells: [{ card: SLASH, pos: "set" }] }, p1: { lp: 7000, monsters: ["Blue-Eyes White Dragon"] }, ...(format === "tag" ? { p2: { lp: 5000 } } : {}) }, [
    attack("Battle Ox", { card: "Blue-Eyes White Dragon", owner: "p1" }), activate(SLASH),
    expectBoard({ p0: { monsters: ["Battle Ox"], grave: [SLASH] }, p1: { lp: 6300, monsters: [], grave: ["Blue-Eyes White Dragon"] } }),
  ]);
  add(46497537, PIG, { p0: { lp: 5000, grave: [PIG] }, p1: { lp: 5000 }, ...(format === "tag" ? { p2: { lp: 5000 }, p3: { lp: 5000 } } : {}) }, [
    activate(PIG), expectBoard({ p0: { spells: [PIG], grave: [] } }),
  ]);
  if (ffa) {
    add(81758313, MYRIAD, { p0: { lp: 10000, monsters: [MYRIAD] }, p1: { lp: 8000 }, p2: { lp: 10000 }, ...(format === "ffa4" ? { p3: { lp: 10000 } } : {}) }, [
      activate(MYRIAD), expectBoard({ p0: { zones: { m0: { card: MYRIAD, counters: { 0x21d: 2 } } } } }),
    ], "-highest-equal-legal-lower");
    add(46497537, PIG, { p0: { lp: 5000, grave: [PIG], hand: ["Battle Ox"] }, p1: { lp: 5000 } }, [
      surrender("p1"), normalSummon("Battle Ox"), expectNotOffered("activate", PIG), expectBoard({ p0: { grave: [PIG], spells: [] } }),
    ], "-equal-seat-surrendered");
  }
}

// A different LP choice must change the result without narrowing the field pool.
for (const format of ["ffa3", "ffa4"] as const) {
  const slash = structuredClone(LP_DIFFERENCE_SCENARIOS.find(s => s.id === `lp-difference-25334372-${format}`)!);
  slash.id += "-equal-battle-opponent";
  slash.title += ": equality with the defender blocks activation despite richer bystanders";
  slash.setup.p1!.lp = 5000;
  slash.steps = [slash.steps[0], expectNotOffered("activate", SLASH), expectBoard({ p0: { lp: 3700, monsters: [], grave: ["Battle Ox"], spells: [SLASH] }, p1: { lp: 5000, monsters: ["Blue-Eyes White Dragon"] } })];
  LP_DIFFERENCE_SCENARIOS.push(defineScenario(slash));

  const myriad = structuredClone(LP_DIFFERENCE_SCENARIOS.find(s => s.id === `lp-difference-81758313-${format}`)!);
  myriad.id += "-p1-controller";
  myriad.title += ": a nonzero controller seat chooses its own opponent";
  [myriad.setup.p0, myriad.setup.p1] = [myriad.setup.p1, myriad.setup.p0];
  myriad.steps = [endTurn("p0"), no("p1"), activate(MYRIAD, "p1"), expectPickSeats(format === "ffa4" ? ["p0", "p2", "p3"] : ["p0", "p2"], "p1"), pickOpponent("p0", "p1"), expectBoard({ p1: { zones: { m0: { card: MYRIAD, counters: { 0x21d: 2 } } } } })];
  LP_DIFFERENCE_SCENARIOS.push(defineScenario(myriad));

  const coordius = structuredClone(LP_DIFFERENCE_SCENARIOS.find(s => s.id === `lp-difference-70219023-${format}`)!);
  coordius.id += "-chosen-opponent-surrenders";
  coordius.title += ": a positive-LP surrendered choice falls back to the highest survivor";
  coordius.setup.p1!.spells = [{ card: "Waboku", pos: "set" }];
  const chosen = format === "ffa4" ? "p3" : "p2";
  coordius.steps = [
    coordius.steps[0], pass("p1"), coordius.steps[1], pass("p1"), coordius.steps[2], expectPickSeats(format === "ffa4" ? ["p1", "p2", "p3"] : ["p1", "p2"]), pickOpponent(chosen), number(2000),
    surrender(chosen), { op: "pass", by: "p1" }, choose("ATK"),
    expectBoard({ p0: { lp: 7000, zones: { m0: { card: COORDIUS, attack: format === "ffa4" ? 4500 : 4000 } } } }),
  ];
  LP_DIFFERENCE_SCENARIOS.push(defineScenario(coordius));
}


for (const format of ["ffa3", "ffa4"] as const) {
  const myriad = structuredClone(LP_DIFFERENCE_SCENARIOS.find(s => s.id === `lp-difference-81758313-${format}-highest-equal-legal-lower`)!);
  myriad.id = `lp-difference-81758313-${format}-no-legal-difference`;
  myriad.title = `${MYRIAD}: all equal leaves no legal counter activation`;
  myriad.setup.p1!.lp = 10000;
  myriad.setup.p0!.hand = ["Battle Ox"];
  myriad.steps = [normalSummon("Battle Ox"), expectNotOffered("activate", MYRIAD), expectBoard({ p0: { zones: { m0: { card: MYRIAD, counters: {} } } } })];
  LP_DIFFERENCE_SCENARIOS.push(defineScenario(myriad));

  const lycoris = structuredClone(LP_DIFFERENCE_SCENARIOS.find(s => s.id === `lp-difference-81916745-${format}`)!);
  lycoris.id += "-no-legal-difference";
  lycoris.title += ": no living opponent's amount permits a monster";
  lycoris.setup.p2 = { lp: 5000, monsters: ["Blue-Eyes White Dragon"] };
  if (format === "ffa4") lycoris.setup.p3!.lp = 5000;
  lycoris.steps = [activate("Ookazi"), pickOpponent("p1"), expectNotOffered("activate", LYCORIS), expectBoard({ p0: { grave: [LYCORIS, "Ookazi"], banished: [] }, p1: { lp: 7000 }, p2: { monsters: ["Blue-Eyes White Dragon"] } })];
  LP_DIFFERENCE_SCENARIOS.push(defineScenario(lycoris));
}


// Prove the real summon and the other "your opponent" clauses, not only amounts.
for (const format of ["ffa3", "ffa4"] as const) {
  const opponents = format === "ffa4" ? ["p1", "p2", "p3"] as const : ["p1", "p2"] as const;
  const base: Scenario["setup"] = { format, skipOpeningDraw: true, attackFirstTurn: true,
    p1: { lp: 7000 }, p2: { lp: 10000 }, ...(format === "ffa4" ? { p3: { lp: 12000 } } : {}) };
  function add(code: number, suffix: string, title: string, setup: Scenario["setup"], steps: Step[]): void {
    LP_DIFFERENCE_SCENARIOS.push(defineScenario({ id: `lp-difference-${code}-${format}-${suffix}`, title,
      source: SOURCE, tags: ["multiplayer", "lp-difference", format, `card:${code}`], rules: ["R-COMMON-OPP-PICK"],
      setup: { ...base, ...setup }, steps }));
  }
  add(90162951, "summon-and-destroy", "Tarantula chooses on its real Xyz Summon; an unrelated burn cannot replace the choice", {
    p0: { lp: 5000, monsters: ["Night Express Knight", "Super Express Bullet Train"], hand: ["Ookazi"], extra: [TARANTULA] },
    p1: { lp: 7000, monsters: ["Battle Ox"] }, p2: { lp: 10000, monsters: ["Celtic Guardian"] },
  }, [
    specialSummon(TARANTULA), select("Night Express Knight", "Super Express Bullet Train"), expectPickSeats([...opponents]), pickOpponent("p1"),
    expectBoard({ p0: { zones: { m0: { card: TARANTULA, attack: 2000, defense: 2000, materials: 2, lpOpponent: 1 } } } }),
    activate("Ookazi"), pickOpponent("p2"),
    expectBoard({ p0: { zones: { m0: { card: TARANTULA, attack: 2000, lpOpponent: 1 } } }, p2: { lp: 9200 } }),
    activate(TARANTULA), select("Night Express Knight"), expectBoard({ p0: { zones: { m0: { card: TARANTULA, materials: 1, lpOpponent: 1 } } },
      p1: { monsters: [], grave: ["Battle Ox"] }, p2: { monsters: ["Celtic Guardian"] } }),
  ]);
  add(90162951, "burn-same-opponent", "Tarantula burns only the remembered opponent for that opponent's Special Summon", {
    p0: { lp: 5000, monsters: [{ card: TARANTULA, materials: ["Mystical Elf"] }] },
    p1: { lp: 7000, hand: ["Cyber Dragon"] }, p2: { lp: 10000, hand: ["Cyber Dragon"] },
  }, [
    pickOpponent("p1"), endTurn("p0"), specialSummon("Cyber Dragon", "p1"),
    expectBoard({ p0: { zones: { m0: { card: TARANTULA, attack: 1400, lpOpponent: 1 } } }, p1: { lp: 6400 } }),
    endTurn("p1"), specialSummon("Cyber Dragon", "p2"),
    expectBoard({ p0: { zones: { m0: { card: TARANTULA, attack: 1400, lpOpponent: 1 } } }, p1: { lp: 6400 }, p2: { lp: 10000 } }),
  ]);
  add(90162951, "set-new-choice", "Turning Tarantula face-down resets its choice; revealing it chooses again", {
    p0: { lp: 5000, monsters: [TARANTULA], hand: ["Book of Moon", "Book of Taiyou"] },
  }, [
    pickOpponent("p1"), activate("Book of Moon"),
    expectBoard({ p0: { zones: { m0: { card: TARANTULA, pos: "set" } } } }),
    activate("Book of Taiyou"), expectPickSeats([...opponents]), pickOpponent("p2"),
    expectBoard({ p0: { zones: { m0: { card: TARANTULA, attack: 5000, lpOpponent: 2 } } } }),
  ]);
  add(90162951, "leave-and-resummon", "Tarantula chooses again after leaving and returning to the field", {
    p0: { lp: 5000, monsters: [TARANTULA, "Night Express Knight", "Super Express Bullet Train"], spells: [{ card: "Compulsory Evacuation Device", pos: "set" }] },
  }, [
    pickOpponent("p1"), activate("Compulsory Evacuation Device"), select(TARANTULA),
    specialSummon(TARANTULA), select("Night Express Knight", "Super Express Bullet Train"), pickOpponent("p2"),
    expectBoard({ p0: { zones: { m0: { card: TARANTULA, attack: 5000, lpOpponent: 2 } } } }),
  ]);
  add(90162951, "nonzero-controller", "Tarantula's continuous LP source belongs to its real controller seat", {
    p0: { lp: 7000 }, p1: { lp: 10000 }, p2: { lp: 5000, monsters: [TARANTULA] },
  }, [
    expectPickSeats(format === "ffa4" ? ["p0", "p1", "p3"] : ["p0", "p1"], "p2"), pickOpponent("p0", "p2"),
    expectBoard({ p2: { zones: { m0: { card: TARANTULA, attack: 2000, defense: 2000, lpOpponent: 0 } } } }),
  ]);
  add(90162951, "shuffled-set-hints", "Shifting Shadows cannot leave a revealed card with another card's LP hint", {
    p0: { lp: 5000, monsters: [TARANTULA, LYCORIS], spells: ["Shifting Shadows"], hand: ["Book of Moon", "Book of Moon", "Book of Taiyou", "Book of Taiyou"] },
  }, [
    pickOpponent("p1"), pickOpponent("p2"), activate({ card: "Book of Moon", nth: 0 }), select(TARANTULA), pass("p0"), activate("Book of Moon"),
    activate("Shifting Shadows"), expectBoard({ p0: { lp: 4700, monsters: [TARANTULA, LYCORIS] } }),
    activate({ card: "Book of Taiyou", nth: 0 }), select(TARANTULA), pickOpponent("p1"), expectBoard({ p0: { monsters: [TARANTULA, LYCORIS] } }),
    activate("Book of Taiyou"), pickOpponent("p2"), expectBoard({ p0: { monsters: [TARANTULA, LYCORIS] } }),
  ]);
  LP_DIFFERENCE_SCENARIOS.at(-1)!.tags.push("lp-shuffle-hints");
  add(90162951, "control-change", "Tarantula's new controller chooses again, including when temporary control returns", {
    p0: { lp: 7000, hand: ["Change of Heart"] }, p1: { lp: 10000 }, p2: { lp: 5000, monsters: [TARANTULA] },
  }, [
    pickOpponent("p0", "p2"), activate("Change of Heart"), expectPickSeats([...opponents]), pickOpponent("p2"),
    expectBoard({ p0: { zones: { m0: { card: TARANTULA, attack: 2000, lpOpponent: 2 } } } }),
    endTurn("p0"), expectPickSeats(format === "ffa4" ? ["p0", "p1", "p3"] : ["p0", "p1"], "p2"), pickOpponent("p1", "p2"),
    expectBoard({ p2: { zones: { m0: { card: TARANTULA, attack: 5000, lpOpponent: 1 } } } }),
  ]);
  add(25334372, "nonzero-attacker", "Tsukumo Slash uses the actual defender when the attacker belongs to seat 2", {
    p0: { lp: 7000, monsters: ["Blue-Eyes White Dragon"] }, p1: { lp: 10000 },
    p2: { lp: 5000, monsters: ["Battle Ox"], spells: [{ card: SLASH, pos: "set" }] },
  }, [
    endTurn("p0"), endTurn("p1"), attack("Battle Ox", { card: "Blue-Eyes White Dragon", owner: "p0" }, "p2"), activate(SLASH, "p2"),
    expectBoard({ p0: { lp: 6300, monsters: [], grave: ["Blue-Eyes White Dragon"] }, p2: { monsters: ["Battle Ox"], grave: [SLASH] } }),
  ]);
  add(81758313, "choose-higher", "Myriaday's chosen LP source changes its real counter amount", {
    p0: { lp: 5000, monsters: [MYRIAD] },
  }, [activate(MYRIAD), pickOpponent("p2"), expectBoard({ p0: { zones: { m0: { card: MYRIAD, counters: { 0x21d: 5 } } } } })]);
  add(81758313, "no-choice-at-resolution", "Myriaday uses the highest-living fallback if every counter choice becomes illegal", {
    p0: { lp: 5000, monsters: [MYRIAD] },
  }, [activate(MYRIAD), expectBoard({ p0: { zones: { m0: { card: MYRIAD, counters: {} } } }, p1: { lp: 5000 }, p2: { lp: 5000 } })]);
  LP_DIFFERENCE_SCENARIOS.at(-1)!.tags.push("lp-equal-at-resolution");
  add(81916745, "banished-list-hint", "Lycoris's public hint follows it when earlier banished cards return to hand", {
    p0: { lp: 5000, monsters: ["Black Luster Soldier - Envoy of the Beginning"], grave: [LYCORIS], banished: ["Mystical Elf", "Axe Raider"], hand: ["Ookazi", "Primal Seed"] },
    p1: { lp: 7800 }, p2: { lp: 10000, monsters: ["Battle Ox", "Celtic Guardian"] },
  }, [
    activate("Ookazi"), pickOpponent("p1"), yes(), select("Battle Ox"), expectBoard({ p0: { banished: ["Mystical Elf", "Axe Raider", LYCORIS] } }),
    activate("Primal Seed"), select("Mystical Elf", "Axe Raider"), expectBoard({ p0: { banished: [LYCORIS], hand: { include: ["Mystical Elf", "Axe Raider"] } } }),
  ]);
  LP_DIFFERENCE_SCENARIOS.at(-1)!.tags.push("lp-banished-hint");
  const swapped = structuredClone(LP_DIFFERENCE_SCENARIOS.at(-1)!);
  swapped.id += "-deck-grave-swap";
  swapped.title += "; exchanging Deck/GY must leave the banished hint intact";
  swapped.tags.push("lp-deck-grave-swap");
  const finalStep = swapped.steps.at(-1)!;
  if (finalStep.op === "expectBoard") finalStep.board.p0!.lp = 5100;
  LP_DIFFERENCE_SCENARIOS.push(defineScenario(swapped));
  add(81916745, "field-recovery-same-opponent", "Lycoris recovers only from the remembered opponent's GY", {
    p0: { lp: 5000, monsters: [LYCORIS], hand: ["Raigeki", "Raigeki"] },
    p1: { lp: 7000, monsters: ["Battle Ox"] }, p2: { lp: 10000, monsters: ["Blue-Eyes White Dragon"] },
  }, [
    pickOpponent("p1"), activate({ card: "Raigeki", nth: 0 }), pickOpponent("p2"),
    expectBoard({ p0: { lp: 5000, zones: { m0: { card: LYCORIS, lpOpponent: 1 } } }, p2: { monsters: [], grave: ["Blue-Eyes White Dragon"] } }),
    activate("Raigeki"), yes(),
    expectBoard({ p0: { lp: 6700, zones: { m0: { card: LYCORIS, lpOpponent: 1 } } }, p1: { monsters: [], grave: ["Battle Ox"] } }),
  ]);
  add(81916745, "field-recovery-fallback", "Lycoris falls back when its remembered opponent surrenders", {
    p0: { lp: 5000, monsters: [LYCORIS], hand: ["Raigeki"] },
    p1: { lp: 7000, monsters: ["Battle Ox"] },
  }, [
    pickOpponent(format === "ffa4" ? "p3" : "p2"), surrender(format === "ffa4" ? "p3" : "p2"),
    activate("Raigeki"),
    ...(format === "ffa4" ? [] : [yes()]),
    expectBoard({ p0: { lp: format === "ffa4" ? 5000 : 6700, zones: { m0: { card: LYCORIS, lpOpponent: format === "ffa4" ? 2 : 1 } } } }),
  ]);
  add(70219023, "destroy-and-atk", "Coordius destroys only the chosen opponent's cards and uses that same opponent's LP", {
    p0: { lp: 20000, hand: ["Polymerization"], monsters: ["Stardust Dragon", "Number 39: Utopia", "Link Spider"], extra: [COORDIUS] },
    p1: { lp: 22000, monsters: ["Battle Ox", "Celtic Guardian", "Mystical Elf"] },
    p2: { lp: 26000, monsters: ["Blue-Eyes White Dragon", "Axe Raider", "Beaver Warrior"] },
  }, [
    activate("Polymerization"), select("Stardust Dragon", "Number 39: Utopia", "Link Spider"), activate(COORDIUS),
    pickOpponent("p1"), number(4000), choose("Destroy"), choose("ATK"),
    expectBoard({ p0: { lp: 16000, zones: { m0: { card: COORDIUS, attack: 6000, lpOpponent: 1 } } }, p1: { monsters: [] }, p2: { monsters: ["Blue-Eyes White Dragon", "Axe Raider", "Beaver Warrior"] } }),
    endTurn("p0"), expectBoard({ p0: { zones: { m0: { card: COORDIUS, attack: 3000 } } } }),
  ]);
  add(70219023, "highest-equal-legal-lower", "Coordius can activate with an empty GY when only a lower-LP opponent permits the ATK option", {
    p0: { lp: 10000, field: "Fusion Gate", monsters: ["Stardust Dragon", "Number 39: Utopia", "Link Spider"], extra: [COORDIUS] },
    p1: { lp: 6000 }, p2: { lp: 10000 }, ...(format === "ffa4" ? { p3: { lp: 10000 } } : {}),
  }, [
    activate("Fusion Gate"), select("Stardust Dragon", "Number 39: Utopia", "Link Spider"), activate(COORDIUS),
    number(2000),
    expectBoard({ p0: { lp: 8000, grave: [], zones: { m0: { card: COORDIUS, attack: 4000, lpOpponent: 1 } } } }),
  ]);
  add(46497537, "choose-equal", "Pig Iron offers only equal living opponents, even when a richer opponent lives", {
    p0: { lp: 5000, grave: [PIG] }, p1: { lp: 5000 }, p2: { lp: 5000 },
  }, [activate(PIG), expectPickSeats(["p1", "p2"]), pickOpponent("p2"), expectBoard({ p0: { spells: [PIG], grave: [] } })]);
}
