import { activate, changePhase, defineScenario, endTurn, expectBoard, expectEliminated, expectNotOffered, expectOffered, expectPickOptions, expectTurn, normalSummon, pickOpponent, select, specialSummon, surrender, zone, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { compileBoard } from "../../support/board.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { readFileSync } from "node:fs";

const SOURCE = "Owner rulings 2026-10-21 and 2026-10-22, https://github.com/DuelingDomain/yugioh-bot/issues/435 [R-FFA-LP-COMPARE]";
const seat = (i: number) => `p${i}` as DuelistId;

export async function runLpComparison(scenario: Scenario): Promise<void> {
  const compiled = compileBoard(scenario.setup);
  const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory,
    ...((scenario.setup.format ?? "1v1") !== "1v1" ? { multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary() } : {}),
    seed: ["1", "2", "3", "4"],
    startupScripts: [...compiled.options.startupScripts!, ...(scenario.tags.includes("lp-scope-proof") ? [{ name: "lp-comparison-scope.lua", content: `
local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
e:SetRange(LOCATION_MZONE)
e:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
e:SetOperation(function(e)
  Duel.MPNthDuelist(3)
  assert(Duel.MPSeat(0)==2)
  assert(not aux.MPCompareLP(0,">"))
  assert(Duel.MPSeat(0)==2,"LP comparison closed the caller's rebind")
  Duel.MPNthDuelist(0)
  Duel.MPBindSeat(2)
  Duel.MPWindow(0)
  assert(Duel.GetLP(1)==7000)
  assert(not aux.MPCompareLP(0,"<"))
  assert(Duel.MPBound() and Duel.GetLP(1)==7000,"LP comparison changed the opponent window")
  Duel.MPWindowEnd()
  Duel.Recover(0,100,REASON_EFFECT)
  e:Reset()
end)
c:RegisterEffect(e)
` }] : []), ...(scenario.tags.includes("lp-report-turn34") ? [{ name: "lp-report-turn34.lua", content: `
local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
e:SetRange(LOCATION_MZONE)
e:SetCode(EVENT_PHASE+PHASE_END)
e:SetCondition(function() return Duel.GetTurnCount()==34 end)
e:SetOperation(function(e)
  assert(Duel.MPTurnSeat()==2 and Duel.GetCurrentPhase()==PHASE_END)
  assert(Duel.MPIsAlive(0) and Duel.MPIsAlive(2) and not Duel.MPIsAlive(1) and not Duel.MPIsAlive(3))
  assert(c:GetAttack()==1000,"Two-survivor End Phase ATK must be 1000")
  -- Observable completion marker: the ATK assertion above ran at the reported phase.
  Duel.Recover(0,100,REASON_EFFECT)
  e:Reset()
end)
c:RegisterEffect(e)
` }] : [])],
  });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, index) => session.run(step, index + 1));
  } finally { game.close(); }
}

function reproduction(actor: number, before: boolean): Scenario {
  const setup: Scenario["setup"] = { format: "ffa4", skipOpeningDraw: true };
  for (let i = 0; i < 4; i++) setup[seat(i)] = { lp: i === actor ? 5000 : i === (actor + 1) % 4 ? 3000 : 9000 };
  setup[seat(actor)]!.hand = ["Unstable Evolution"];
  setup[seat(actor)]!.monsters = ["Battle Ox"];
  const steps: Step[] = [];
  for (let i = 0; i < actor; i++) steps.push(endTurn(seat(i)));
  const losses = [surrender(seat((actor + 2) % 4)), surrender(seat((actor + 3) % 4)), expectEliminated(seat((actor + 2) % 4), seat((actor + 3) % 4))];
  if (before) steps.push(...losses);
  steps.push(activate("Unstable Evolution", seat(actor)));
  if (!before) steps.push(...losses);
  steps.push(expectBoard({ [seat(actor)]: { lp: 5000, zones: { m0: { card: "Battle Ox", attack: 1000 } } }, [seat((actor + 1) % 4)]: { lp: 3000 } }));
  return domainVariant(defineScenario({ id: `lp-comparison-435-p${actor}-${before ? "before" : "after"}-equip`, title: "Unstable Evolution: two survivors exclude richer surrendered seats", source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", "card:62991886"], setup, steps }));
}

function equipComparison(card: "Unstable Evolution" | "Megamorph", opponents: number[], attack: number, label: string): Scenario {
  return domainVariant(defineScenario({
    id: `lp-comparison-${card.replaceAll(" ", "-")}-${label}`,
    title: `${card}: ${label}`, source: SOURCE, rules: ["R-FFA-LP-COMPARE"],
    tags: ["multiplayer", "ffa4", `card:${card === "Megamorph" ? 22046459 : 62991886}`],
    setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, hand: [card], monsters: ["Battle Ox"] },
      p1: { lp: opponents[0] }, p2: { lp: opponents[1] }, p3: { lp: opponents[2] } },
    steps: [activate(card), expectBoard({ p0: { zones: { m0: { card: "Battle Ox", attack } } } })],
  }));
}

export const LP_COMPARISON_SCENARIOS = [
  ...[0, 1, 2, 3].flatMap(actor => [reproduction(actor, true), reproduction(actor, false)]),
  ...(["Unstable Evolution", "Megamorph"] as const).flatMap(card => [
    equipComparison(card, [3000, 7000, 9000], card === "Megamorph" ? 850 : 1000, "mixed-owner-example"),
    equipComparison(card, [3000, 4000, 4500], card === "Megamorph" ? 850 : 1000, "all-opponents-lower"),
    equipComparison(card, [6000, 7000, 9000], card === "Megamorph" ? 3400 : 2400, "all-opponents-higher"),
    equipComparison(card, [5000, 7000, 9000], card === "Megamorph" ? 850 : 1000, "tied-with-one"),
    equipComparison(card, [3000, 4000, 5000], card === "Megamorph" ? 850 : 1000, "tied-with-highest"),
    equipComparison(card, [5000, 5000, 5000], 1700, "all-equal"),
  ]),
];

LP_COMPARISON_SCENARIOS.push(defineScenario({ id: "lp-comparison-preserves-caller-scope", title: "LP comparisons preserve nested seat scopes and a bound opponent window", source: SOURCE,
  rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", "lp-scope-proof", "card:62991886"],
  setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, monsters: ["Battle Ox"], hand: ["Celtic Guardian"] }, p1: { lp: 3000 }, p2: { lp: 7000 }, p3: { lp: 9000 } },
  steps: [normalSummon("Celtic Guardian"), expectBoard({ p0: { lp: 5100 } })],
}));

// Real summon offers exercise inline and named Lua conditions, including probes
// that already have an opponent bound by the engine.
for (const [card, code, higher] of [["Gold Pride - Leon", 23512906, false], ["Dyna Base", 39396763, false], ["Aromage Laurel", 14169843, true]] as const) {
  for (const [label, opponents, offered] of [
    ["mixed", [3000, 7000, 9000], false],
    ["all-higher", [6000, 7000, 9000], !higher],
    ["all-lower", [1000, 3000, 4000], higher],
    ["tie", higher ? [3000, 4000, 5000] : [5000, 7000, 9000], false],
  ] as const) {
    const scenario = defineScenario({ id: `lp-comparison-summon-${code}-${label}`, title: `${card}: ${label} LP summon condition`, source: SOURCE,
      rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", `card:${code}`],
      setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, hand: [card, "Battle Ox"] }, p1: { lp: opponents[0] }, p2: { lp: opponents[1] }, p3: { lp: opponents[2] } },
      steps: [normalSummon("Battle Ox"), ...(offered ? [expectOffered("activate", card), activate(card), expectBoard({ p0: { monsters: ["Battle Ox", card] } })] : [expectNotOffered("activate", card), expectBoard({ p0: { monsters: ["Battle Ox"], hand: [card] } })])],
    });
    LP_COMPARISON_SCENARIOS.push(scenario, domainVariant(scenario));
  }
}

for (const [card, code, attack] of [["The Agent of Force - Mars", 91123920, 0]] as const) {
  const scenario = defineScenario({ id: `lp-comparison-continuous-${code}-mixed`, title: `${card}: neither strict LP branch applies with mixed totals`, source: SOURCE,
    rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", `card:${code}`],
    setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, hand: ["Battle Ox"], monsters: [card], field: "The Sanctuary in the Sky" }, p1: { lp: 3000 }, p2: { lp: 7000 }, p3: { lp: 9000 } },
    steps: [normalSummon("Battle Ox"), expectBoard({ p0: { zones: { m0: { card, attack } } } })],
  });
  LP_COMPARISON_SCENARIOS.push(scenario, domainVariant(scenario));
}

// Two-branch cards use the higher branch for mixed LP and partial ties.
// All equal stays neutral; one-branch cards elsewhere retain strict comparisons.
for (const format of ["ffa3", "ffa4"] as const) {
  for (const [label, opponents, lp, attack] of [
    ["mixed", [3000, 7000, 9000], 4000, format === "ffa3" ? 4100 : 6100],
    ["lower", [6000, 7000, 9000], 7000, format === "ffa3" ? 100 : 0],
    ["higher", [1000, 2000, 3000], 4000, format === "ffa3" ? 5100 : 4100],
    ["partial-tie-lower", [5000, 7000, 9000], 4000, format === "ffa3" ? 4100 : 6100],
    ["partial-tie-higher", [3000, 5000, 5000], 4000, 2100],
    ["all-equal", [5000, 5000, 5000], 5000, 2100],
  ] as const) {
    for (const [card, code] of [["Supremacy Berry", 98380593], ["Ancient Sacred Wyvern", 25958491]] as const) {
      const berry = card === "Supremacy Berry";
      const scenario = defineScenario({ id: `lp-comparison-${berry ? "berry" : "wyvern"}-${format}-${label}`,
        title: `${card}: ${format} ${label}`, source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", format, `card:${code}`],
        setup: { format, skipOpeningDraw: true,
          p0: { lp: 5000, hand: ["Battle Ox", ...(berry ? [card] : [])], monsters: berry ? [] : [card] },
          p1: { lp: opponents[0] }, p2: { lp: opponents[1] }, ...(format === "ffa4" ? { p3: { lp: opponents[2] } } : {}) },
        steps: [normalSummon("Battle Ox"), ...(berry
          ? label === "all-equal"
            ? [expectNotOffered("activate", card), expectBoard({ p0: { lp, hand: [card] } })]
            : [expectOffered("activate", card), activate(card), expectBoard({ p0: { lp, grave: [card] } })]
          : [expectBoard({ p0: { zones: { m0: { card, attack } } } })])],
      });
      LP_COMPARISON_SCENARIOS.push(scenario, domainVariant(scenario));
    }
  }
}

// Soul Drain Dragon is summoned by a real Dragon Xyz effect (Atum), which
// sets its ATK to 0 before its mandatory LP-conditioned summon trigger.
for (const [label, opponents, attack] of [
  ["mixed", [3000, 7000, 9000], 0], ["lower", [6000, 7000, 9000], 4000],
  ["partial-tie", [5000, 7000, 9000], 0], ["higher", [1000, 2000, 3000], 0],
] as const) {
  const scenario = defineScenario({ id: `lp-comparison-soul-drain-${label}`, title: `Soul Drain Dragon: ${label} LP on Special Summon`,
    source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", "card:55735315"],
    setup: { format: "ffa4", skipOpeningDraw: true,
      p0: { lp: 5000, monsters: [{ card: "Hieratic Dragon King of Atum", materials: ["Luster Dragon #2"] }], deck: ["Soul Drain Dragon"] },
      p1: { lp: opponents[0] }, p2: { lp: opponents[1] }, p3: { lp: opponents[2] } },
    steps: [activate("Hieratic Dragon King of Atum"), ...(label === "lower" ? [pickOpponent("p3")] : []),
      expectBoard({ p0: { grave: ["Luster Dragon #2"], zones: { m0: { card: "Hieratic Dragon King of Atum", materials: 0 }, m1: { card: "Soul Drain Dragon", attack } } } })],
  });
  LP_COMPARISON_SCENARIOS.push(scenario, domainVariant(scenario));
}

// Sweet Marjoram is a one-branch higher-LP protection: prove actual opponent
// target options, including an unprotected non-Plant on the same field.
for (const [label, opponents, protectedPlants] of [
  ["mixed", [3000, 7000, 9000], false], ["higher", [1000, 2000, 3000], true],
  ["partial-tie", [3000, 4000, 5000], false], ["lower", [6000, 7000, 9000], false],
] as const) {
  const scenario = defineScenario({ id: `lp-comparison-sweet-marjoram-${label}`, title: `Sweet Marjoram: ${label} LP targeting protection`,
    source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", "card:79656239"],
    setup: { format: "ffa4", skipOpeningDraw: true,
      p0: { lp: 5000, monsters: ["Aromaseraphy Sweet Marjoram", "Lonefire Blossom", "Battle Ox", "Celtic Guardian"] },
      p1: { lp: opponents[0], hand: ["Book of Moon"] }, p2: { lp: opponents[1] }, p3: { lp: opponents[2] } },
    steps: [endTurn("p0"), activate("Book of Moon", "p1"), zone("p1", "s0"),
      expectPickOptions({ include: [{ card: "Battle Ox", seat: "p0" }, { card: "Celtic Guardian", seat: "p0" }, ...(!protectedPlants ? [{ card: "Aromaseraphy Sweet Marjoram", seat: "p0" as const }, { card: "Lonefire Blossom", seat: "p0" as const }] : [])],
        ...(protectedPlants ? { exclude: [{ card: "Aromaseraphy Sweet Marjoram" }, { card: "Lonefire Blossom" }] } : {}) }, "p1"),
      select({ card: "Battle Ox", owner: "p0" }), expectBoard({ p0: { zones: { m2: { card: "Battle Ox", pos: "facedown" } } }, p1: { grave: ["Book of Moon"] } })],
  });
  LP_COMPARISON_SCENARIOS.push(scenario, domainVariant(scenario));
}

for (const [card, code] of [["Supremacy Berry", 98380593], ["Ancient Sacred Wyvern", 25958491]] as const) {
  const berry = card === "Supremacy Berry";
  const scenario = defineScenario({ id: `lp-comparison-${berry ? "berry" : "wyvern"}-elimination`,
    title: `${card}: surrender changes mixed LP to lower than every survivor`, source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", `card:${code}`],
    setup: { format: "ffa4", skipOpeningDraw: true,
      p0: { lp: 5000, hand: berry ? [card] : [], monsters: berry ? [] : [card] },
      p1: { lp: 3000 }, p2: { lp: 7000 }, p3: { lp: 9000 } },
    steps: [...(berry ? [expectOffered("activate", card)] : [expectBoard({ p0: { zones: { m0: { card, attack: 6100 } } } })]),
      surrender("p1"), expectEliminated("p1"),
      ...(berry ? [activate(card), expectBoard({ p0: { lp: 7000, grave: [card] } })]
        : [expectBoard({ p0: { zones: { m0: { card, attack: 0 } } } }), surrender("p3"), expectEliminated("p1", "p3"), expectBoard({ p0: { zones: { m0: { card, attack: 100 } } } })])],
  });
  LP_COMPARISON_SCENARIOS.push(scenario, domainVariant(scenario));
}

for (const format of ["1v1", "tag"] as const) {
  for (const card of ["Unstable Evolution", "Megamorph"] as const) {
    for (const [other, label] of [[3000, "higher"], [5000, "equal"], [7000, "lower"]] as const) {
      const attack = other === 5000 ? 1700 : card === "Megamorph" ? (other < 5000 ? 850 : 3400) : other < 5000 ? 1000 : 2400;
      LP_COMPARISON_SCENARIOS.push(defineScenario({ id: `lp-comparison-control-${format}-${card.replaceAll(" ", "-")}-${label}`,
        title: `${format}: ${card} keeps stock ${label} LP result`, source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: [format, `card:${card === "Megamorph" ? 22046459 : 62991886}`],
        setup: { format, skipOpeningDraw: true, p0: { lp: 5000, hand: [card], monsters: ["Battle Ox"] }, p1: { lp: other }, ...(format === "tag" ? { p2: { lp: 5000 }, p3: { lp: other } } : {}) },
        steps: [activate(card), expectBoard({ p0: { lp: 5000, zones: { m0: { card: "Battle Ox", attack } } }, p1: { lp: other }, ...(format === "tag" ? { p2: { lp: 5000 }, p3: { lp: other } } : {}) })],
      }));
    }
  }
}

for (const format of ["1v1", "tag"] as const) {
  for (const [card, code] of [["Supremacy Berry", 98380593], ["Ancient Sacred Wyvern", 25958491]] as const) {
    for (const [other, label] of [[3000, "higher"], [5000, "equal"], [7000, "lower"]] as const) {
      const berry = card === "Supremacy Berry";
      const lp = other === 5000 ? 5000 : other > 5000 ? 7000 : 4000;
      const scenario = defineScenario({ id: `lp-comparison-control-${format}-${code}-${label}`,
        title: `${format}: ${card} keeps stock ${label} LP result`, source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: [format, `card:${code}`],
        setup: { format, skipOpeningDraw: true,
          p0: { lp: 5000, hand: ["Battle Ox", ...(berry ? [card] : [])], monsters: berry ? [] : [card] }, p1: { lp: other },
          ...(format === "tag" ? { p2: { lp: 5000 }, p3: { lp: other } } : {}) },
        steps: [normalSummon("Battle Ox"), ...(berry
          ? other === 5000 ? [expectNotOffered("activate", card), expectBoard({ p0: { lp, hand: [card] } })]
            : [activate(card), expectBoard({ p0: { lp, grave: [card] }, ...(format === "tag" ? { p2: { lp } } : {}) })]
          : [expectBoard({ p0: { zones: { m0: { card, attack: 2100 + 5000 - other } } } })])],
      });
      LP_COMPARISON_SCENARIOS.push(scenario, domainVariant(scenario));
    }
  }
}

for (const [label, opponents, offered] of [["exact-gap", [7000, 8000, 9000], true], ["one-gap-too-small", [6500, 8000, 9000], false]] as const) {
  const card = "ZW - Eagle Claw";
  const scenario = defineScenario({ id: `lp-comparison-required-gap-${label}`, title: `ZW - Eagle Claw: ${label} against every opponent`,
    source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", "card:29353756"],
    setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, hand: [card, "Battle Ox"] }, p1: { lp: opponents[0] }, p2: { lp: opponents[1] }, p3: { lp: opponents[2] } },
    steps: [normalSummon("Battle Ox"), ...(offered ? [specialSummon(card), expectBoard({ p0: { monsters: ["Battle Ox", card] } })] : [expectNotOffered("specialSummon", card), expectBoard({ p0: { monsters: ["Battle Ox"] } })])],
  });
  LP_COMPARISON_SCENARIOS.push(scenario, domainVariant(scenario));
}

LP_COMPARISON_SCENARIOS.push(domainVariant(defineScenario({ id: "lp-comparison-eliminated-lower-seat", title: "Unstable Evolution enables 2400 after the sole lower-LP opponent surrenders with positive LP",
  source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", "card:62991886"],
  setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, hand: ["Unstable Evolution"], monsters: ["Battle Ox"] }, p1: { lp: 7000 }, p2: { lp: 3000 }, p3: { lp: 9000 } },
  steps: [activate("Unstable Evolution"), expectBoard({ p0: { zones: { m0: { card: "Battle Ox", attack: 1000 } } } }),
    surrender("p2"), expectEliminated("p2"), expectBoard({ p0: { zones: { m0: { card: "Battle Ox", attack: 2400 } } } }),
    surrender("p3"), expectEliminated("p2", "p3"), expectBoard({ p0: { zones: { m0: { card: "Battle Ox", attack: 2400 } } } })],
})));

LP_COMPARISON_SCENARIOS.push(domainVariant(defineScenario({ id: "lp-comparison-gorgoneio-mixed", title: "Evil Eye of Gorgoneio applies no LP-difference bonus with mixed LP",
  source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", "card:28957126"],
  setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, hand: ["Evil Eye of Gorgoneio"], monsters: ["Serziel, Watcher of the Evil Eye"] }, p1: { lp: 3000 }, p2: { lp: 7000 }, p3: { lp: 9000 } },
  steps: [activate("Evil Eye of Gorgoneio"), expectBoard({ p0: { zones: { m0: { card: "Serziel, Watcher of the Evil Eye", attack: 1600 } } } })],
})));

for (const [label, opponents, count] of [["one-lower-opponent", [3000, 7000, 9000], 1], ["all-at-least-2000-lower", [2000, 3000, 1000], 2]] as const) {
  const scenario = defineScenario({ id: `lp-comparison-crimson-heart-${label}`, title: `Trickstar Crimson Heart draws ${count} for ${label} and one for every other player`,
    source: SOURCE, rules: ["R-FFA-LP-COMPARE", "R-COMMON-EACH-PLAYER"], tags: ["multiplayer", "ffa4", "card:51011872"],
    setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, monsters: ["Trickstar Crimson Heart"], hand: ["Trickstar Candina"] }, p1: { lp: opponents[0] }, p2: { lp: opponents[1] }, p3: { lp: opponents[2] } },
    steps: [activate("Trickstar Crimson Heart"), expectBoard({ p0: { hand: { count }, grave: ["Trickstar Candina"] }, p1: { hand: { count: 1 } }, p2: { hand: { count: 1 } }, p3: { hand: { count: 1 } } })],
  });
  LP_COMPARISON_SCENARIOS.push(scenario, domainVariant(scenario));
}

// Loading every reviewed card through a real core catches syntax/initialization
// failures in suffixes whose individual effects are outside this scenario matrix.
const overlayManifest = JSON.parse(readFileSync(new URL("../../../domain-core/multi-scripts/MANIFEST.json", import.meta.url), "utf8")) as { cards: Array<{ code: number; note?: string }> };
const reviewedCards = overlayManifest.cards.filter(card => card.note?.includes("R-FFA-LP-COMPARE")).map(card => card.code);
for (const format of ["ffa3", "ffa4", "tag"] as const) {
  const scenario = defineScenario({ id: `lp-comparison-load-reviewed-scripts-${format}`, title: `${format}: every reviewed LP comparison script loads in the real engine`, source: SOURCE,
    rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", format, "lp-overlay-load"],
    setup: { format, skipOpeningDraw: true, p0: { hand: ["Battle Ox"], grave: reviewedCards } },
    steps: [normalSummon("Battle Ox"), expectBoard({ p0: { grave: reviewedCards, zones: { m0: { card: "Battle Ox", attack: 1700 } } } })],
  });
  LP_COMPARISON_SCENARIOS.push(scenario, domainVariant(scenario));
}

LP_COMPARISON_SCENARIOS.push(domainVariant(defineScenario({ id: "lp-comparison-report-turn34-two-survivors", title: "Issue #435 timing control: turn 34, p2 End Phase, two survivors",
  source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", "lp-report-turn34", "card:62991886"],
  setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, hand: ["Unstable Evolution"], monsters: ["Battle Ox"], spells: ["Infinite Cards"] }, p1: { lp: 9000 }, p2: { lp: 3000 }, p3: { lp: 9000 } },
  steps: [surrender("p1"), surrender("p3"), expectEliminated("p1", "p3"), activate("Unstable Evolution"),
    ...Array.from({ length: 33 }, (_, index) => endTurn(index % 2 === 0 ? "p0" : "p2")),
    expectTurn("p2", 34), changePhase("end", "p2"),
    expectBoard({ p0: { lp: 5100, zones: { m0: { card: "Battle Ox", attack: 1000 } } }, p2: { lp: 3000 } })],
})));

for (const [card, code, attack] of [["Elemental HERO Air Neos", 11502550, 2500], ["Neo-Parshath, the Sky Paladin", 12510878, 2300]] as const) {
  LP_COMPARISON_SCENARIOS.push(domainVariant(defineScenario({ id: `lp-comparison-review-addition-${code}-mixed`, title: `${card}: mixed LP satisfies neither signed-difference branch`,
    source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", `card:${code}`],
    setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, monsters: [card], hand: ["Battle Ox"], field: "The Sanctuary in the Sky" }, p1: { lp: 3000 }, p2: { lp: 7000 }, p3: { lp: 9000 } },
    steps: [normalSummon("Battle Ox"), expectBoard({ p0: { zones: { m0: { card, attack } } } })],
  })));
}

LP_COMPARISON_SCENARIOS.push(domainVariant(defineScenario({ id: "lp-comparison-psychic-sword-mixed", title: "Psychic Sword applies no LP-difference bonus with mixed LP",
  source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", "card:92346415"],
  setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, hand: ["Psychic Sword"], monsters: ["Krebons"] }, p1: { lp: 3000 }, p2: { lp: 7000 }, p3: { lp: 9000 } },
  steps: [activate("Psychic Sword"), expectBoard({ p0: { zones: { m0: { card: "Krebons", attack: 1200 } } } })],
})));

LP_COMPARISON_SCENARIOS.push(domainVariant(defineScenario({ id: "lp-comparison-equip-on-opponents-monster", title: "Unstable Evolution compares the Equip controller's LP when equipped to an opponent's monster",
  source: SOURCE, rules: ["R-FFA-LP-COMPARE"], tags: ["multiplayer", "ffa4", "card:62991886"],
  setup: { format: "ffa4", skipOpeningDraw: true, p0: { lp: 5000, hand: ["Unstable Evolution"] }, p1: { lp: 6000 }, p2: { lp: 7000, monsters: ["Battle Ox"] }, p3: { lp: 9000 } },
  steps: [activate("Unstable Evolution"), expectBoard({ p0: { spells: ["Unstable Evolution"] }, p2: { zones: { m0: { card: "Battle Ox", attack: 2400 } } } })],
})));
