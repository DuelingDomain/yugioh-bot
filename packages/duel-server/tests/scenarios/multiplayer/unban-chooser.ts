import { activate, defineScenario, endTurn, expectBoard, expectNotOffered, expectPickSeats, expectSeatNotOffered, no,
  pickOpponent, select, yes, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";

type Format = "ffa3" | "ffa4" | "tag";
const seats = (f: Format): DuelistId[] => f === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
const CED = "Chaos Emperor Dragon - Envoy of the End";
const RING = "Ring of Destruction";
const VIRUS = "Crush Card Virus";
const ELF = "Mystical Elf";
const OX = "Battle Ox";
const FANG = "Silver Fang";
const BLUE = "Blue-Eyes White Dragon";
const source = "Owner 2026-10-18; docs/adr/0002-multiplayer-duel-rules.md";

function fixture(format: Format, domain: boolean): Scenario["setup"] {
  const setup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" } : {}) };
  for (const seat of seats(format)) setup[seat] = { deck: Array(20).fill(ELF), ...(domain ? { deckMaster: BLUE } : {}) };
  return setup;
}
function state(format: Format, spec: BoardExpect): Step {
  return expectBoard(Object.fromEntries(seats(format).map(seat => [seat, {
    lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], hand: [], grave: [], banished: [], ...spec[seat],
  }])));
}

function chaos(format: Format, domain: boolean): Scenario {
  const setup = fixture(format, domain);
  const hands = [OX, FANG, "Axe Raider", "Celtic Guardian"];
  for (const [index, seat] of seats(format).entries()) Object.assign(setup[seat]!, { hand: [hands[index]], monsters: [ELF] });
  setup.p0!.monsters!.push(CED);
  const result: BoardExpect = {};
  for (const [index, seat] of seats(format).entries()) result[seat] = format === "tag" || seat === "p0" || seat === "p2"
    ? { lp: format === "tag" ? (index % 2 === 0 ? 15000 : 14800) : seat === "p0" ? 7000 : 7400,
      grave: [ELF, hands[index], ...(seat === "p0" ? [CED, ...(domain ? [ELF] : [])] : [])] }
    : { monsters: [ELF], hand: [hands[index]] };
  return defineScenario({ id: `unban-chooser-${format}-chaos-${format === "tag" ? "all-duelists" : "picks-p2"}${domain ? "-domain" : ""}`,
    title: `${format}: Chaos Emperor Dragon ${format === "tag" ? "keeps its all-duelist send" : "sends only the chosen pair"}`, source,
    rules: [format === "tag" ? "R-COMMON-EACH-PLAYER" : "R-FFA-OPP-ONE"], tags: ["multiplayer", "card:82301904", format], setup,
    steps: [activate(CED, "p0"), ...(format === "tag" ? [] : [expectPickSeats(seats(format).slice(1), "p0"), pickOpponent("p2", "p0")]), state(format, result)] });
}

function ring(format: Format, domain: boolean): Scenario {
  const setup = fixture(format, domain);
  setup.p0!.spells = [{ card: RING, pos: "set" }];
  setup.p1!.monsters = [OX];
  const target: DuelistId = format === "tag" ? "p3" : "p2";
  setup[target]!.monsters = [BLUE];
  if (format === "ffa4") setup.p3!.monsters = [ELF];
  // The turn player cannot pay the target's ATK with their LP. The chosen opponent can.
  if (format !== "tag") setup.p1!.lp = 1000;
  const result: BoardExpect = { p0: { lp: format === "tag" ? 13000 : 5000, hand: domain ? [ELF] : [], grave: [RING] },
    p1: { lp: format === "tag" ? 13000 : 1000, monsters: [OX], hand: [ELF] },
    [target]: { lp: format === "tag" ? 13000 : 5000, grave: [BLUE] } };
  if (format === "tag") result.p2 = { lp: 13000 };
  if (format === "ffa4") result.p3 = { monsters: [ELF] };
  return defineScenario({ id: `unban-chooser-${format}-ring-target-controller${domain ? "-domain" : ""}`,
    title: `${format}: Ring checks and damages the target controller`, source,
    rules: ["R-FFA-OPP-ONE"], tags: ["multiplayer", "card:83555666", format], setup,
    steps: [expectNotOffered("activate", RING, "p0"), endTurn("p0"), activate(RING, "p0"),
      ...(format === "tag" ? [select({ card: BLUE, owner: target })]
        : format === "ffa4" ? [expectPickSeats(["p2", "p3"], "p0"), pickOpponent(target, "p0")] : []), state(format, result)] });
}

function virus(format: Format, domain: boolean): Scenario {
  const setup = fixture(format, domain);
  const target: DuelistId = format === "tag" ? "p3" : "p2";
  setup.p0!.monsters = ["Kuriboh"];
  setup.p0!.spells = [{ card: VIRUS, pos: "set" }];
  setup.p0!.hand = ["Hinotama", "Hinotama"];
  setup[target]!.hand = [BLUE, ELF];
  setup[target]!.monsters = [OX, FANG];
  setup[target]!.deck = [BLUE, ...Array(19).fill(ELF)];
  setup.p1!.hand = ["Summoned Skull"];
  setup.p1!.monsters = ["Summoned Skull"];
  const steps: Step[] = [activate(VIRUS, "p0"),
    pickOpponent(target, "p0"), yes(target),
    activate("Hinotama", "p0"), ...(format === "tag" ? [] : [pickOpponent(target, "p0")]),
    activate("Hinotama", "p0"), ...(format === "tag" ? [] : [pickOpponent("p1", "p0")])];
  const result: BoardExpect = { p0: { hand: domain ? [ELF] : [], grave: [VIRUS, "Kuriboh", "Hinotama", "Hinotama"] },
    p1: { hand: ["Summoned Skull"], monsters: format === "tag" ? [] : ["Summoned Skull"],
      grave: format === "tag" ? ["Summoned Skull"] : [], lp: format === "tag" ? 16000 : 7500 },
    [target]: { monsters: [FANG], hand: [ELF], grave: [BLUE, BLUE, OX], deckCount: 19 } };
  steps.push(state(format, result));
  return defineScenario({ id: `unban-chooser-${format}-crush-hand-field-deck${domain ? "-domain" : ""}`,
    title: `${format}: Crush Card Virus reads the chosen opponent and keeps its damage lock`, source,
    rules: ["R-FFA-OPP-ONE", "R-FFA-ACTIVATED-LOCK"], tags: ["multiplayer", "card:57728570", format], setup, steps });
}

function virusDuration(format: "ffa3" | "ffa4", domain: boolean): Scenario {
  const setup = fixture(format, domain);
  setup.p0!.monsters = ["Kuriboh"];
  setup.p0!.spells = [{ card: VIRUS, pos: "set" }];
  setup.p1!.hand = ["Hinotama"];
  setup.p2!.hand = ["Tremendous Fire"];
  setup.p2!.deck = Array(20).fill(BLUE);
  setup.p2!.monsters = [OX, FANG];
  return defineScenario({ id: `unban-chooser-${format}-crush-next-turn-expiry${domain ? "-domain" : ""}`,
    title: `${format}: Crush Card Virus prevents damage through the next turn only`, source,
    rules: ["R-FFA-OPP-ONE", "R-FFA-ACTIVATED-LOCK"], tags: ["multiplayer", "card:57728570", format], setup,
    steps: [activate(VIRUS, "p0"), pickOpponent("p2", "p0"), no("p2"), endTurn("p0"),
      activate("Hinotama", "p1"), pickOpponent("p2", "p1"), expectBoard({ p2: { lp: 8000 } }),
      endTurn("p1"), activate("Tremendous Fire", "p2"), pickOpponent("p1", "p2"),
      state(format, { p0: { hand: domain ? [ELF] : [], grave: [VIRUS, "Kuriboh"] },
        p1: { lp: 7000, hand: [ELF], grave: ["Hinotama"] },
        p2: { lp: 7500, hand: [BLUE], monsters: [FANG], grave: [OX, "Tremendous Fire"] } })] });
}

function ringAboveLp(format: Format, domain: boolean): Scenario {
  const setup = fixture(format, domain);
  setup.p0!.spells = [{ card: RING, pos: "set" }];
  for (const seat of seats(format).filter(seat => format === "tag" ? seat === "p1" || seat === "p3" : seat !== "p0")) {
    setup[seat]!.lp = 2000;
    setup[seat]!.monsters = [BLUE];
  }
  return defineScenario({ id: `unban-chooser-${format}-ring-above-controller-lp${domain ? "-domain" : ""}`,
    title: `${format}: Ring cannot target an opponent monster above that controller's LP`, source,
    rules: ["R-FFA-OPP-ONE"], tags: ["multiplayer", "card:83555666", format], setup,
    steps: [endTurn("p0"), expectSeatNotOffered("activate", RING, "p0"),
      expectBoard({ p0: { spells: [RING], grave: [] }, p1: { lp: 2000, monsters: [BLUE], hand: [ELF] } })] });
}

export const UNBAN_CHOOSER_SCENARIOS: Scenario[] = [false, true].flatMap(domain => [
  ...(["ffa3", "ffa4"] as const).flatMap(format => [chaos(format, domain), virusDuration(format, domain)]),
  chaos("tag", domain),
  ...(["ffa3", "ffa4", "tag"] as const).flatMap(format => [ring(format, domain), ringAboveLp(format, domain), virus(format, domain)]),
]);
