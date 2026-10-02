// Review 5c: extra Ritual and Fusion material in the partner's Graveyard belongs to the Tag team.
// Real Djinn and Magical Knight Dragon scripts register the effects. Opponent Graveyards stay out.
import { activate, defineScenario, endTurn, expectNotOffered, expectOffered, expectPickOptions, select, zone, type DuelistExpect, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, SEATS, type Format, type Seat } from "./seat-kit.js";
import { teamOneVariant } from "./team-variants.js";

const RITUAL = "Black Luster Ritual";
const SOLDIER = 5405694;
const DJINN = "Djinn Cursenchanter of Rituals";
const OX = "Battle Ox";
const POLY = "Polymerization";
const MAGIC = "Curse of Dragon, the Magical Knight Dragon";
const GAIA = "Gaia The Fierce Knight";
const CURSE = "Curse of Dragon";
const FUSION = "Gaia the Dragon Champion";

function ritual(format: Format, partner: boolean): Scenario {
  const holder: Seat = partner ? "p2" : "p0";
  const setup = baseSetup(format, {
    p0: { deck: ["Ookazi"], hand: [RITUAL, SOLDIER], monsters: [OX], ...(holder === "p0" ? { grave: [DJINN] } : {}) },
    p1: { grave: [DJINN] },
    p2: { grave: partner ? [DJINN] : [OX] },
    ...(format === "ffa3" ? {} : { p3: { grave: [DJINN] } }),
  });
  const state: Partial<Record<Seat, DuelistExpect>> = Object.fromEntries(SEATS[format].map((seat) => [seat, { grave: setup[seat]?.grave ?? [] }]));
  state.p0 = { monsters: [SOLDIER], grave: [RITUAL, OX], banished: holder === "p0" ? [DJINN] : [], hand: [] };
  if (holder !== "p0") state[holder] = { grave: [], banished: [DJINN] };
  return defineScenario({
    id: `tag-grave-material-review-${format}-ritual-${partner ? "partner" : "own"}-grave`,
    title: `${format}: Black Luster Ritual banishes the Djinn in ${holder}'s Graveyard and Tributes the own Battle Ox`,
    source: `${SOURCE} [R-TAG-SHARED-CARDS] [R-TAG-PARTNER-COST]`,
    rules: ["R-TAG-SHARED-CARDS", "R-TAG-PARTNER-COST"],
    tags: ["multiplayer", format, "ritual", "grave", "card:77153811", "card:55761792"],
    setup,
    steps: [
      expectOffered("activate", RITUAL, "p0"), activate(RITUAL, "p0"), zone("p0", "s0", "p0"),
      expectPickOptions({ count: 2, include: [{ card: OX, seat: "p0" }, { card: DJINN, seat: holder }] }, "p0"),
      select(OX, { card: DJINN, owner: holder, from: "grave" }),
      everySeat(format, state),
    ],
  });
}

function fusion(format: Format, partner: boolean): Scenario {
  const holder: Seat = partner ? "p2" : "p0";
  const setup = baseSetup(format, {
    p0: { deck: ["Ookazi"], monsters: [MAGIC], hand: [POLY], extra: [FUSION], ...(holder === "p0" ? { grave: [GAIA, CURSE] } : {}) },
    p1: { grave: [GAIA, CURSE] }, p2: { grave: partner ? [GAIA, CURSE] : [OX] },
    ...(format === "ffa3" ? {} : { p3: { grave: [GAIA, CURSE] } }),
  });
  const state: Partial<Record<Seat, DuelistExpect>> = Object.fromEntries(SEATS[format].map((seat) => [seat, { grave: setup[seat]?.grave ?? [] }]));
  state.p0 = { monsters: [MAGIC, FUSION], grave: [POLY], banished: holder === "p0" ? [GAIA, CURSE] : [], hand: [], extra: [] };
  if (holder !== "p0") state[holder] = { grave: [], banished: [GAIA, CURSE] };
  return defineScenario({
    id: `tag-grave-material-review-${format}-fusion-${partner ? "partner" : "own"}-grave`,
    title: `${format}: Magical Knight Dragon lets Polymerization banish Gaia and Curse of Dragon in ${holder}'s Graveyard`,
    source: `${SOURCE} [R-TAG-SHARED-CARDS] [R-TAG-PARTNER-COST]`,
    rules: ["R-TAG-SHARED-CARDS", "R-TAG-PARTNER-COST"],
    tags: ["multiplayer", format, "fusion", "grave", "card:72064891", "card:24094653"],
    setup,
    steps: [
      expectOffered("activate", POLY, "p0"), activate(POLY, "p0"),
      select({ card: GAIA, owner: holder, from: "grave" }, { card: CURSE, owner: holder, from: "grave" }),
      everySeat(format, state),
    ],
  });
}

function opponentOnly(format: Format, kind: "ritual" | "fusion"): Scenario {
  const ritualCase = kind === "ritual";
  const setup = baseSetup(format, {
    p0: ritualCase ? { deck: ["Ookazi"], hand: [RITUAL, SOLDIER], monsters: [OX] } : { deck: ["Ookazi"], hand: [POLY], monsters: [MAGIC], extra: [FUSION] },
    p1: { grave: ritualCase ? [DJINN] : [GAIA, CURSE] },
    ...(format === "tag" ? { p2: {} } : { p2: { grave: ritualCase ? [DJINN] : [GAIA, CURSE] } }),
    ...(format === "ffa3" ? {} : { p3: { grave: ritualCase ? [DJINN] : [GAIA, CURSE] } }),
  });
  return defineScenario({
    id: `tag-grave-material-review-${format}-${kind}-opponent-graves-refused`,
    title: `${format}: ${kind} extra material from every opponent's Graveyard stays out`,
    source: `${SOURCE} [R-TAG-SHARED-CARDS] [R-TAG-PARTNER-COST]`,
    rules: ["R-TAG-SHARED-CARDS", "R-TAG-PARTNER-COST"],
    tags: ["multiplayer", format, kind, "grave", `card:${ritualCase ? 77153811 : 72064891}`],
    setup,
    steps: [
      expectNotOffered("activate", ritualCase ? RITUAL : POLY, "p0"), endTurn("p0"),
      everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, {
        monsters: setup[seat]?.monsters ?? [], grave: setup[seat]?.grave ?? [],
        hand: seat === "p1" ? ["Mystical Elf"] : [...(setup[seat]?.hand ?? [])], extra: setup[seat]?.extra ?? [],
      }]))),
    ],
  });
}

const partnerCases = [ritual("tag", true), fusion("tag", true)];
export const TAG_GRAVE_MATERIAL_REVIEW_SCENARIOS: Scenario[] = [
  ...partnerCases, ...partnerCases.map(teamOneVariant),
  ...(["tag", "ffa3", "ffa4"] as Format[]).flatMap((format) => [
    ritual(format, false), fusion(format, false), opponentOnly(format, "ritual"), opponentOnly(format, "fusion"),
  ]),
];
