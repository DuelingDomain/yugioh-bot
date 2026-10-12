import { activate, endTurn, expectBoard, expectEliminated, expectNotOffered, expectOffered, expectPickOptions, expectPrompt, number, pass, select, specialSummon, surrender, zone, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";
import { SEATS, turnsBefore, type Seat } from "./seat-kit.js";

const ELF = "Mystical Elf", OX = "Battle Ox", FUSE = "Fuse Line", KNIGHT = "Mekk-Knight Purple Nightfall", POT = "Pot of Greed";
const slots = (seq: number, card: string) => Array.from({ length: seq + 1 }, (_, i) => i === seq ? card : null);
function scenario(id: string, format: "ffa3" | "ffa4", setup: Scenario["setup"], steps: Step[]): Scenario {
  return defineScenario({ id: `fixed-facing-${id}`, title: id.replaceAll("-", " "),
    source: "Owner decision 2026-10-11; Domain rulebook v1.4 Player positioning", rules: ["R-FFA-ACROSS-EMZ"],
    tags: ["multiplayer", format, "column", "facing"], setup: { ...setup, format }, steps });
}

// The very next prompt must list cards, never an opponent. Every unrelated seat
// has an otherwise identical card in the mirrored column to catch accidental folding.
function fuse(format: "ffa3" | "ffa4", actor: Seat, departed: Seat[] = []): Scenario {
  const peer = actor === "p0" ? "p1" : actor === "p1" ? "p0" : format === "ffa4" ? (actor === "p2" ? "p3" : "p2") : null;
  const facing = peer !== null && !departed.includes(peer);
  const setup: Scenario["setup"] = {};
  for (const seat of SEATS[format]) setup[seat] = seat === actor
    ? { monsters: slots(1, ELF), spells: [null, { card: FUSE, pos: "set" }], hand: [POT] }
    : { monsters: slots(3, OX) };
  return scenario(`${format}-${actor}-fuse-${departed.join("-") || "all-alive"}-no-column-pick`, format, setup, [
    ...turnsBefore(format, actor).flatMap(step => [step, ...Array.from({ length: 5 }, () => pass(actor))]), ...departed.map(seat => surrender(seat)), ...(departed.length ? [expectEliminated(...departed)] : []), activate(POT, actor),
    activate(FUSE, actor),
    ...(facing ? [expectPickOptions([{ seat: actor, card: ELF }, { seat: peer!, card: OX }], actor),
      select({ card: OX, owner: peer! })] : []),
    // With only one legal own card the host answers its selection automatically.
    expectPrompt({ by: actor, context: "action" }),
    expectBoard(Object.fromEntries(SEATS[format].filter(seat => !departed.includes(seat)).map(seat => [seat,
      seat === actor ? { monsters: facing ? [ELF] : [], grave: facing ? [POT, FUSE] : [POT, FUSE, ELF] }
        : seat === peer && facing ? { monsters: [], grave: [OX] } : { monsters: [OX], grave: [] }]))),
  ]);
}
function knight(actor: Seat, departed: Seat[] = []): Scenario {
  const peer = actor === "p0" ? "p1" : actor === "p1" ? "p0" : null;
  const facing = peer !== null && !departed.includes(peer);
  const setup: Scenario["setup"] = {};
  for (const seat of SEATS.ffa3) setup[seat] = seat === actor ? { hand: [KNIGHT, POT] }
    : { monsters: slots(3, OX), spells: [null, null, null, { card: POT, pos: "set" }] };
  return scenario(`ffa3-${actor}-knight-${departed.join("-") || "all-alive"}`, "ffa3", setup, [
    ...turnsBefore("ffa3", actor), ...departed.map(seat => surrender(seat)), ...(departed.length ? [expectEliminated(...departed)] : []), activate(POT, actor),
    ...(facing ? [expectOffered("specialSummon", KNIGHT, actor), specialSummon(KNIGHT, actor), expectPrompt({ by: actor, context: "action" })]
      : [expectNotOffered("specialSummon", KNIGHT, actor)]),
    expectBoard({ [actor]: { monsters: facing ? [KNIGHT] : [], ...(facing ? { zones: { m1: KNIGHT } } : {}) } }),
  ]);
}

function disablaster(departed: boolean): Scenario {
  const card = "Disablaster the Negation Fortress", trooper = "Card Trooper";
  return scenario(`ffa3-continuous-columns-${departed ? "facing-out" : "all-alive"}`, "ffa3", {
    p0: { monsters: slots(1, card) }, p1: { monsters: slots(3, trooper) }, p2: { monsters: slots(3, trooper) },
  }, [
    ...(departed ? [surrender("p1"), expectEliminated("p1")] : []), endTurn("p0"),
    ...(!departed ? [activate(trooper, "p1"), number(3, "p1"),
      expectPrompt({ by: "p1", context: "action" }), expectBoard({ p1: { zones: { m3: { card: trooper, attack: 400 } } } }), endTurn("p1")] : []),
    activate(trooper, "p2"), number(3, "p2"), expectPrompt({ by: "p2", context: "action" }),
    expectBoard({ p2: { zones: { m3: { card: trooper, attack: 1900 } } } }),
  ]);
}

function fullColumn(actor: Seat, missing: boolean, card: "Blasting Fuse" | "Bingo Card" = "Blasting Fuse"): Scenario {
  const spider = "Link Spider";
  const peer: Seat | null = actor === "p0" ? "p1" : actor === "p1" ? "p0" : null;
  const setup: Scenario["setup"] = {};
  for (const seat of SEATS.ffa3) setup[seat] = seat === actor
    ? { monsters: [null, missing && !peer ? null : ELF, null, null, null, spider], spells: [null, { card, pos: "set" }], ...(missing ? { hand: [POT] } : {}) }
    : { monsters: slots(3, OX), spells: missing && seat === peer ? [] : [null, null, null, { card: POT, pos: "set" }] };
  return scenario(`ffa3-${actor}-${card === "Bingo Card" ? "bingo" : "blasting"}-full-column-${missing ? "missing-zone" : "filled"}`, "ffa3", setup, [
    ...turnsBefore("ffa3", actor).flatMap(step => [step, ...(!missing ? Array.from({ length: 5 }, () => pass(actor)) : [])]),
    ...(missing ? [activate(POT, actor), expectNotOffered("activate", card, actor)] : [
      activate(card, actor), ...(card === "Bingo Card" ? [select({ card: ELF, owner: actor })] : []),
      expectPrompt({ by: actor, context: "action" }),
      expectBoard(Object.fromEntries(SEATS.ffa3.map(seat => [seat,
        seat === actor ? { monsters: [], spells: [], grave: [ELF, spider, card] }
          : seat === peer ? { monsters: [], spells: [], grave: [OX, POT] }
          : { monsters: [OX], spells: [POT], grave: [] }]))),
    ]),
  ]);
}

function impermanence(format: "ffa3" | "ffa4"): Scenario {
  const trap = "Infinite Impermanence", remedy = "Goblin's Secret Remedy";
  return scenario(`${format}-impermanence-non-facing-target-keeps-facing-column`, format, {
    p0: { spells: [null, { card: trap, pos: "set" }] }, p1: { hand: [remedy, remedy] }, p2: { monsters: ["Giant Rat"] },
  }, [endTurn("p0"), ...Array.from({ length: 4 }, () => pass("p0")),
    activate(remedy, "p1"), zone("p1", "s0", "p1"), activate(trap, "p0"),
    expectPrompt({ by: "p1", context: "action" }), activate(remedy, "p1"), zone("p1", "s3", "p1"),
    expectPrompt({ by: "p1", context: "action" }),
    expectBoard({ p0: { grave: [trap] }, p1: { lp: 8600, grave: [remedy, remedy] }, p2: { monsters: ["Giant Rat"] } }),
  ]);
}

const standard = [impermanence("ffa3"), impermanence("ffa4"), ...SEATS.ffa3.map(actor => fullColumn(actor, false, "Bingo Card")), fullColumn("p0", true, "Bingo Card"), fullColumn("p2", true, "Bingo Card"), ...SEATS.ffa3.map(actor => fullColumn(actor, false)), fullColumn("p0", true), fullColumn("p2", true), disablaster(false), disablaster(true),
  ...SEATS.ffa3.flatMap(actor => [fuse("ffa3", actor), knight(actor)]),
  fuse("ffa3", "p0", ["p2"]), fuse("ffa3", "p0", ["p1"]), fuse("ffa3", "p1", ["p0"]), fuse("ffa3", "p2", ["p1"]),
  knight("p0", ["p2"]), knight("p0", ["p1"]), knight("p2", ["p1"]),
  ...SEATS.ffa4.map(actor => fuse("ffa4", actor)), fuse("ffa4", "p0", ["p1", "p3"]), fuse("ffa4", "p2", ["p1", "p3"]),
];
export const FFA3_COLUMN_SCENARIOS = [...standard, ...standard.map(domainVariant)];
