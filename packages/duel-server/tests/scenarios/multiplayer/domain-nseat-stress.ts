import {
  activate, attack, endTurn, expectEliminated, expectNotOffered,
  expectOffered, expectPrompt, expectResult, expectTurn, faceDown, no, normalSummon,
  pickOpponent, select, specialSummon, surrender, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { everySeat, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const SOURCE = "docs/specs/2026-10-01-domain-nseat-stress.md; docs/adr/0002-multiplayer-duel-rules.md";
const MASTER: Record<Seat, string> = { p0: "Axe Raider", p1: "Celtic Guardian", p2: "Battle Ox", p3: "Giant Soldier of Stone" };
const ZONE = { inZone: true, returns: 0, nextCost: 0 };
const FIELD = { inZone: false, returns: 0, nextCost: 0 };

function setup(format: Format, extra: Partial<Record<Seat, object>> = {}, attackFirstTurn = true): Scenario["setup"] {
  return Object.assign({ format, mode: "domain" as const, attackFirstTurn },
    Object.fromEntries(SEATS[format].map((seat) => [seat, { deckMaster: MASTER[seat], ...extra[seat] }])));
}
function board(format: Format, extra: Partial<Record<Seat, DuelistExpect>> = {}): Step {
  return everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, { deckMaster: ZONE, ...extra[seat] }])));
}
function scenario(format: Format, name: string, data: Partial<Scenario> & Pick<Scenario, "setup" | "steps">): Scenario {
  return defineScenario({ id: `domain-nseat-stress-${format}-${name}`, title: `${format}: ${name.replaceAll("-", " ")}`,
    source: SOURCE, tags: ["domain", "multiplayer", format, "deck-master"], rules: ["R-COMMON-SEP-FIELDS"], ...data });
}

export const DOMAIN_NSEAT_STRESS: Scenario[] = [];
export { setup as stressSetup, board as stressBoard, scenario as stressScenario, MASTER as STRESS_MASTERS };
for (const format of ["ffa3", "ffa4", "tag"] as const) {
  const owner: Seat = format === "ffa3" ? "p2" : "p3";
  DOMAIN_NSEAT_STRESS.push(
    scenario(format, "zone-is-not-a-field-monster", {
      setup: setup(format, { p0: { hand: ["Raigeki"] } }),
      steps: [expectNotOffered("activate", "Raigeki", "p0"), endTurn("p0"), board(format)],
    }),
    scenario(format, format === "tag" ? "team-loss-ends-duel" : "eliminated-owner-loses-its-zone", {
      setup: setup(format, { [owner]: { monsters: ["Mystical Elf"] } }),
      steps: [surrender(owner), ...(format === "tag" ? [] : [endTurn("p0")]), expectEliminated(format === "tag" ? ["p1", "p3"] : [owner]),
        ...(format === "tag" ? [expectResult({ team: 0 })] : [expectTurn("p1", 2)]),
        ...(format === "tag" ? [] : [board(format, { [owner]: { deckMaster: FIELD, hand: [] } })]),
      ],
    }),
    scenario(format, "opponent-destroys-late-seat-master", {
      setup: setup(format, { p0: { hand: ["Raigeki"] } }),
      steps: [...turnsBefore(format, owner), normalSummon({ card: MASTER[owner], from: "dmz" }, owner), endTurn(owner),
        activate("Raigeki", "p0"), expectPrompt({ by: owner, context: "deck-master-recall" }), no(owner),
        board(format, { p0: { grave: ["Raigeki"] }, [owner]: { grave: [MASTER[owner]], deckMaster: FIELD } })],
    }),
    scenario(format, "opponent-banishes-late-seat-master", {
      setup: setup(format, { p0: { hand: ["Dark Hole", "Soul Release"] } }),
      steps: [
        ...turnsBefore(format, owner),
        normalSummon({ card: MASTER[owner], from: "dmz" }, owner),
        endTurn(owner),
        activate("Dark Hole", "p0"), no(owner),
        activate("Soul Release", "p0"),
        select({ card: MASTER[owner], owner, from: "grave" }),
        expectPrompt({ by: owner, context: "deck-master-recall" }), no(owner),
        board(format, {
          p0: { grave: ["Dark Hole", "Soul Release"] },
          [owner]: { banished: [MASTER[owner]], deckMaster: FIELD },
        }),
      ],
    }),
    scenario(format, "battle-damage-goes-to-master-controller", {
      setup: setup(format, { p0: { monsters: ["Blue-Eyes White Dragon"] }, [owner]: { deckMaster: "Battle Ox" } }),
      steps: [...turnsBefore(format, owner), normalSummon({ card: "Battle Ox", from: "dmz" }, owner), endTurn(owner),
        attack("Blue-Eyes White Dragon", { card: "Battle Ox", owner }, "p0"),
        expectPrompt({ by: owner, context: "deck-master-recall" }), no(owner),
        board(format, { p0: { monsters: ["Blue-Eyes White Dragon"] }, [owner]: { lp: format === "tag" ? 14700 : 6700, grave: ["Battle Ox"], deckMaster: FIELD } })],
    }),
    scenario(format, format === "tag" ? "stolen-master-keeps-owner-at-team-loss" : "stolen-master-is-removed-with-owner", {
      setup: setup(format, { p0: { hand: ["Change of Heart"] }, [owner]: { monsters: ["Mystical Elf"] } }),
      steps: [...turnsBefore(format, owner), normalSummon({ card: MASTER[owner], from: "dmz" }, owner), endTurn(owner),
        activate("Change of Heart", "p0"), select({ card: MASTER[owner], owner }),
        board(format, { p0: { monsters: [MASTER[owner]], grave: ["Change of Heart"] }, [owner]: { monsters: ["Mystical Elf"], deckMaster: FIELD } }),
        surrender(owner), ...(format === "tag" ? [] : [endTurn("p0")]), expectEliminated(format === "tag" ? ["p1", "p3"] : [owner]),
        board(format, { p0: { grave: ["Change of Heart"], ...(format === "tag" ? { monsters: [MASTER[owner]] } : {}) }, ...Object.fromEntries((format === "tag" ? ["p1", "p3"] : [owner]).map((s) => [s, { deckMaster: FIELD, hand: [] }])) })],
    }),
    scenario(format, "first-turn-draw-and-battle-window", {
      setup: setup(format, {}, false),
      steps: [...SEATS[format].flatMap((seat, index): Step[] => [expectTurn(seat, index + 1),
        expectPrompt({ by: seat, ...(index === SEATS[format].length - 1 ? { offers: ["to_bp"] } : { notOffers: ["to_bp"] }) }),
        board(format, Object.fromEntries(SEATS[format].map((s, at) => [s, { hand: { count: at > 0 && at <= index ? 1 : 0 }, deckCount: at > 0 && at <= index ? 19 : 20 }]))), endTurn(seat)]),
        expectTurn("p0", SEATS[format].length + 1), expectPrompt({ by: "p0", offers: ["to_bp"] }),
        board(format, Object.fromEntries(SEATS[format].map((s) => [s, { hand: { count: 1 }, deckCount: 19 }])))],
    }),
  );
}

DOMAIN_NSEAT_STRESS.push(
  scenario("ffa3", "simultaneous-loss-leaves-one-winner", {
    setup: setup("ffa3", { p0: { lp: 1000, spells: [faceDown("Self-Destruct Button")] } }),
    rules: ["R-FFA-ELIMINATION", "R-FFA-LP"],
    steps: [activate("Self-Destruct Button", "p0"), pickOpponent("p2", "p0"), expectEliminated("p0", "p2"), expectResult({ seat: "p1", reason: "lp" }),
      board("ffa3", { p0: { lp: 0, hand: [], deckMaster: FIELD }, p2: { lp: 0, hand: [], deckMaster: FIELD } })],
  }),
  scenario("ffa4", "simultaneous-loss-skips-both-seats", {
    setup: setup("ffa4", { p0: { lp: 1000, spells: [faceDown("Self-Destruct Button")] } }),
    rules: ["R-FFA-ELIMINATION", "R-FFA-ORDER"],
    steps: [activate("Self-Destruct Button", "p0"), pickOpponent("p3", "p0"), expectEliminated("p0", "p3"), expectTurn("p1", 2),
      endTurn("p1"), expectTurn("p2", 3), endTurn("p2"), expectTurn("p1", 4),
      board("ffa4", { p0: { lp: 0, hand: [], deckMaster: FIELD }, p3: { lp: 0, hand: [], deckMaster: FIELD } })],
  }),
  scenario("tag", "simultaneous-team-loss-is-a-draw", {
    setup: setup("tag", { p0: { lp: 1000, spells: [faceDown("Self-Destruct Button")] }, p1: { lp: 8000 } }),
    rules: ["R-TAG-LP", "R-TAG-LOSS"],
    // A final Tag draw ends the duel directly. It does not emit individual elimination messages.
    steps: [activate("Self-Destruct Button", "p0"), expectResult({ team: null, reason: "lp" }),
      board("tag", Object.fromEntries(SEATS.tag.map((s) => [s, { lp: 0, hand: s === "p0" ? ["Mystical Elf"] : [], ...(s === "p0" ? { spells: ["Self-Destruct Button"] } : {}) }])))],
  }),
);

for (const format of ["ffa3", "ffa4", "tag"] as const) {
  DOMAIN_NSEAT_STRESS.push(scenario(format, "inherent-summon-counts-field-master-and-excludes-zone", {
    setup: setup(format, { p0: { deckMaster: "Cyber Dragon" } }),
    steps: [expectNotOffered("specialSummon", { card: "Cyber Dragon", from: "dmz" }, "p0"), endTurn("p0"),
      normalSummon({ card: MASTER.p1, from: "dmz" }, "p1"), endTurn("p1"),
      ...SEATS[format].slice(2).map((seat) => endTurn(seat)),
      expectOffered("specialSummon", { card: "Cyber Dragon", from: "dmz" }, "p0"), specialSummon({ card: "Cyber Dragon", from: "dmz" }, "p0"),
      board(format, { p0: { monsters: ["Cyber Dragon"], deckMaster: FIELD }, p1: { monsters: [MASTER.p1], deckMaster: FIELD } })],
  }));
}
