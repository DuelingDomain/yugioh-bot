// A Contact Fusion monster as Deck Master is Special Summoned from the DMZ by its own procedure (Fusion.ContactCon, patched once in
// domain.lua) with its own materials and cost: shuffled into the Deck (Neos, Andabata), banished (ABC-Dragon Buster) or sent to the
// Graveyard (Chaos Ruler) [Domain Format rulebook v1.4, Summoning from the DMZ: a Deck Master may use its own summon mechanic and the
// from-the-Extra-Deck clause is ignored]. Polymerization must not bring such a Deck Master out (its own summon condition stays). Runs on the frozen legacy 1v1 core (production default), the pinned 1v1 core and the multi-domain core (FFA3).
// Four Extra Deck monsters with their own EFFECT_SPSUMMON_PROC (Fallen Angel of the Golden Land, Artmage Non-Finito, Vaylantz Genesis Grand Duke,
// Odd-Eyes Arcray Dragon; their stock condition starts with `if c:IsFaceup() then return false end`) are summoned from the DMZ the same way
// (domain.lua wraps the condition of that effect for these codes only). Their own cost stays: without it the DMZ summon is not offered.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { createEngineGame } from "../../src/engine.js";
import { createLegacyEngineGame } from "../../src/legacy/index.js";
import { engineDataDirectory as DATA } from "../engine-data-dir.js";
import { compileBoard } from "../support/board.js";
import { describeWithCores, needs } from "../support/cores.js";
import { liveNseat } from "../support/live-nseat.js";
import { runScenarios } from "../support/runner.js";
import { domainNseatWasmBinary, Session } from "../support/session.js";
import { defineScenario, expectBoard, expectNotOffered, expectOffered, select, specialSummon, type DuelistSetup, type Scenario } from "../support/dsl.js";
import { defineScenarioWithFfaFirstDraw } from "./multiplayer/ffa-first-draw.js";

const SOURCE = "Domain Format Complete Rulebook v1.4, Summoning from the DMZ: a Deck Master may use its own summon mechanic";

interface Kind {
  name: string;
  master: string;
  materials: string[];
  /** Where the materials end up, as a board expectation of p0. */
  after: { grave?: string[]; banished?: string[] };
  card: number;
}

const KINDS: Kind[] = [
  { name: "neos-shuffle", master: "Elemental HERO Air Neos", materials: ["Elemental HERO Neos", "Neo-Spacian Air Hummingbird"], after: { grave: [], banished: [] }, card: 11502550 },
  { name: "gladiator-return", master: "Gladiator Beast Andabata", materials: ["Gladiator Beast Augustus", "Gladiator Beast Retiari", "Gladiator Beast Lanista"], after: { grave: [], banished: [] }, card: 3779662 },
  { name: "abc-banish", master: "ABC-Dragon Buster", materials: ["A-Assault Core", "B-Buster Drake", "C-Crush Wyvern"], after: { grave: [], banished: ["A-Assault Core", "B-Buster Drake", "C-Crush Wyvern"] }, card: 1561110 },
  { name: "chaos-ruler-grave", master: "Arcana Force EX - The Chaos Ruler", materials: ["Arcana Force I - The Magician", "Arcana Force III - The Empress", "Arcana Force IV - The Emperor"], after: { grave: ["Arcana Force I - The Magician", "Arcana Force III - The Empress", "Arcana Force IV - The Emperor"] }, card: 12686296 },
];

function build(kind: Kind, format: "1v1" | "ffa3", define: (scenario: Scenario) => Scenario): Scenario {
  const setup: Scenario["setup"] = { mode: "domain", format, skipOpeningDraw: format === "1v1", p0: { deckMaster: kind.master, monsters: kind.materials }, p1: { deckMaster: "Celtic Guardian" } };
  if (format === "ffa3") setup.p2 = { deckMaster: "Battle Ox" };
  return define(defineScenario({
    id: `domain-${format}-contact-fusion-${kind.name}-deck-master`,
    title: `${kind.master} as Deck Master is Special Summoned from its zone with its own materials (${kind.name})`,
    source: SOURCE,
    tags: ["domain", "deck-master", "fusion", "contact-fusion", format, `card:${kind.card}`],
    setup,
    steps: [
      expectOffered("specialSummon", { card: kind.master, from: "dmz" }),
      specialSummon({ card: kind.master, from: "dmz" }),
      select(...kind.materials),
      expectBoard({ p0: { monsters: [kind.master], ...kind.after, deckMaster: { inZone: false, returns: 0 } } }),
    ],
  }));
}

interface Own {
  name: string;
  /** Card name for the title. */
  title: string;
  /** Name, or passcode when the name is shared with an alternate art. */
  master: string | number;
  card: number;
  p0: DuelistSetup;
  /** What the cost takes, selected after the summon is chosen. */
  select: string[];
  /** Board of p0 after the summon. */
  after: { monsters?: Array<string | number>; grave?: string[] };
  /** Same board without its own cost: the Deck Master stays in the zone. */
  without: DuelistSetup;
}

const OWN: Own[] = [
  { name: "fallen-angel", title: "Fallen Angel of the Golden Land", master: "Fallen Angel of the Golden Land", card: 43143567,
    p0: { grave: ["Eldlich the Golden Lord"], monsters: ["Wightlord"] }, select: [], after: { monsters: ["Fallen Angel of the Golden Land"], grave: ["Eldlich the Golden Lord", "Wightlord"] },
    without: { monsters: ["Wightlord"] } },
  { name: "non-finito", title: "Artmage Non-Finito", master: "Artmage Non-Finito", card: 74631897,
    p0: { hand: ["Artmage Movement -Pedigree-"], monsters: ["Artmage Finmel"] }, select: [], after: { monsters: ["Artmage Non-Finito"], grave: ["Artmage Movement -Pedigree-", "Artmage Finmel"] },
    without: { monsters: ["Artmage Finmel"] } },
  // The tributed Valiants monster must stand in Main Monster Zone 1 or 3 or an Extra Monster Zone.
  { name: "vaylantz-grand-duke", title: "Vaylantz Genesis Grand Duke", master: "Vaylantz Genesis Grand Duke", card: 76075139,
    p0: { monsters: [null, "Vaylantz Mad Marquess"] }, select: [], after: { monsters: ["Vaylantz Genesis Grand Duke"] },
    without: { monsters: ["Vaylantz Voltage Viscount"] } },
  { name: "arcray-dragon", title: "Odd-Eyes Arcray Dragon", master: 6218704, card: 6218704,
    p0: { monsters: ["Supreme King Z-ARC"] }, select: [], after: { monsters: [6218704] },
    without: { monsters: ["Mystical Elf"] } },
];

const baseSetup = (format: "1v1" | "ffa3", p0: DuelistSetup): Scenario["setup"] => {
  const setup: Scenario["setup"] = { mode: "domain", format, skipOpeningDraw: format === "1v1", p0, p1: { deckMaster: "Celtic Guardian" } };
  if (format === "ffa3") setup.p2 = { deckMaster: "Battle Ox" };
  return setup;
};

function buildOwn(kind: Own, format: "1v1" | "ffa3", define: (scenario: Scenario) => Scenario): Scenario[] {
  const summon = define(defineScenario({
    id: `domain-${format}-own-proc-${kind.name}-deck-master`,
    title: `${kind.title} as Deck Master is Special Summoned from its zone by its own procedure`,
    source: SOURCE,
    tags: ["domain", "deck-master", "own-summon-procedure", format, `card:${kind.card}`],
    setup: baseSetup(format, { deckMaster: kind.master, ...kind.p0 }),
    steps: [
      expectOffered("specialSummon", { card: kind.master, from: "dmz" }),
      specialSummon({ card: kind.master, from: "dmz" }),
      ...(kind.select.length ? [select(...kind.select)] : []),
      expectBoard({ p0: { ...kind.after, deckMaster: { inZone: false, returns: 0 } } }),
    ],
  }));
  const refused = define(defineScenario({
    id: `domain-${format}-own-proc-${kind.name}-deck-master-needs-cost`,
    title: `${kind.title} as Deck Master is not offered for a Special Summon without its own cost`,
    source: SOURCE,
    tags: ["domain", "deck-master", "own-summon-procedure", format, `card:${kind.card}`],
    setup: baseSetup(format, { deckMaster: kind.master, ...kind.without }),
    steps: [expectNotOffered("specialSummon", { card: kind.master }), expectBoard({ p0: { deckMaster: { inZone: true } } })],
  }));
  return [summon, refused];
}

// A Fusion Spell is not the monster's own procedure: the Deck Master stays in the zone (EFFECT_SPSUMMON_CONDITION is unchanged).
const polymerization = (format: "1v1" | "ffa3", define: (scenario: Scenario) => Scenario): Scenario => {
  const setup: Scenario["setup"] = {
    mode: "domain", format, skipOpeningDraw: format === "1v1",
    p0: { deckMaster: "Elemental HERO Air Neos", hand: ["Polymerization"], monsters: ["Elemental HERO Neos", "Neo-Spacian Air Hummingbird"] },
    p1: { deckMaster: "Celtic Guardian" },
  };
  if (format === "ffa3") setup.p2 = { deckMaster: "Battle Ox" };
  return define(defineScenario({
    id: `domain-${format}-contact-fusion-deck-master-no-polymerization`,
    title: "A Contact Fusion Deck Master is not offered for a Special Summon by Polymerization",
    source: SOURCE,
    tags: ["domain", "deck-master", "fusion", "contact-fusion", format, "card:11502550"],
    setup,
    steps: [
      expectOffered("specialSummon", { card: "Elemental HERO Air Neos", from: "dmz" }),
      expectNotOffered("activate", { card: "Polymerization" }),
      expectBoard({ p0: { deckMaster: { inZone: true } } }),
    ],
  }));
};

const scenarios1v1 = [...KINDS.map(kind => build(kind, "1v1", scenario => scenario)), polymerization("1v1", scenario => scenario), ...OWN.flatMap(kind => buildOwn(kind, "1v1", scenario => scenario))];
const scenariosFfa3 = [...KINDS.map(kind => build(kind, "ffa3", defineScenarioWithFfaFirstDraw)), polymerization("ffa3", defineScenarioWithFfaFirstDraw), ...OWN.flatMap(kind => buildOwn(kind, "ffa3", defineScenarioWithFfaFirstDraw))];

// Scan: every card that registers a Contact Fusion procedure loads as Deck Master in Domain mode without a script error.
function contactFusionNames(): string[] {
  const ids: number[] = [];
  for (const folder of ["official", "pre-release"]) {
    const dir = join(DATA, "card-scripts", folder);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (/^c\d+\.lua$/.test(file) && /Fusion\.(?:Add|Create)ContactProc\(/.test(readFileSync(join(dir, file), "utf8"))) ids.push(Number(file.slice(1, -4)));
    }
  }
  if (!existsSync(join(DATA, "cards.cdb"))) return [];
  const db = new Database(join(DATA, "cards.cdb"), { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT t.name FROM texts t JOIN datas d ON d.id = t.id WHERE t.id = ? AND (d.type & 64) != 0");
    return [...new Set(ids.flatMap(id => { const found = row.get(id) as { name: string } | undefined; return found ? [found.name] : []; }))].sort();
  } finally { db.close(); }
}
const scanNames = contactFusionNames();
const scanScenario = (name: string, format: "1v1" | "ffa3", define: (scenario: Scenario) => Scenario) => {
  const setup: Scenario["setup"] = { mode: "domain", format, skipOpeningDraw: format === "1v1", p0: { deckMaster: name }, p1: { deckMaster: "Celtic Guardian" } };
  if (format === "ffa3") setup.p2 = { deckMaster: "Battle Ox" };
  return define(defineScenario({
    id: `domain-${format}-contact-fusion-scan-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    title: `${name} loads as Deck Master without a script error`,
    source: SOURCE,
    tags: ["domain", "deck-master", "contact-fusion", "scan", format],
    setup,
    steps: [expectBoard({ p0: { deckMaster: { inZone: true } } })],
  }));
};
const scan1v1 = scanNames.map(name => scanScenario(name, "1v1", scenario => scenario));
const scanFfa3 = scanNames.map(name => scanScenario(name, "ffa3", defineScenarioWithFfaFirstDraw));

const engines = [
  { name: "legacy Domain 1v1", file: "ocgcore.domain.legacy.wasm", create: createLegacyEngineGame },
  { name: "pinned Domain 1v1", file: "ocgcore.domain.wasm", create: createEngineGame },
];

for (const engine of engines) {
  describeWithCores(`Contact Fusion Deck Master, ${engine.name}`, [needs.cards(DATA), needs.file(engine.name, join(DATA, engine.file))], () => {
    it.each([...scenarios1v1, ...scan1v1])("$id", async scenario => {
      const game = await engine.create({ ...compileBoard(scenario.setup).options, dataDirectory: DATA, seed: ["1", "2", "3", "4"] });
      try {
        const session = new Session(scenario, game);
        session.reachMainPhase();
        session.startRecording();
        scenario.steps.forEach((step, index) => session.run(step, index + 1));
        expect(game.view(null).events.filter(event => event.kind === "script-error")).toEqual([]);
      } finally { game.close(); }
    });
  });
}

describeWithCores("Contact Fusion Deck Master, multi-domain FFA3", [liveNseat, ...needs.domainMulti()], () => {
  const run = async (scenario: Scenario) => {
    const game = await createEngineGame({ ...compileBoard(scenario.setup).options, dataDirectory: DATA, seed: ["1", "2", "3", "4"], multiWasmBinary: domainNseatWasmBinary() });
    try {
      const session = new Session(scenario, game);
      session.reachMainPhase();
      session.startRecording();
      scenario.steps.forEach((step, index) => session.run(step, index + 1));
      expect(game.view(null).events.filter(event => event.kind === "script-error")).toEqual([]);
    } finally { game.close(); }
  };
  runScenarios("multiplayer/domain-contact-fusion-deck-master", [...scenariosFfa3, ...scanFfa3], run);
});
