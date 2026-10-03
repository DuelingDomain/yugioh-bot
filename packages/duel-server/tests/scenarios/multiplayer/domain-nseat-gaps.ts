// Domain at 3 and 4 duelists (review gap: the Deck Master summon and the Deck Master as Link material were proven only at 2 seats and in the FFA4 recall).
// Each seat has its own Deck Master zone [R-COMMON-SEP-FIELDS]. The turn player Normal Summons its Deck Master from the zone, or uses it as the Link
// Material of a Link Summon: the Deck Master goes to the Graveyard, its owner (only that duelist) gets the recall prompt, a yes puts it back in the zone
// (the first return is free), a no keeps it in the Graveyard. The Deck Masters in the zones of the other seats (in Tag the partner too) never change.
// Plain data (scripts/rule-coverage.ts reads it); domain-nseat-gaps.test.ts runs it on a live Domain core.

import { expectOffered, expectPrompt, no, normalSummon, select, specialSummon, yes, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const RULE = `${SOURCE} [R-COMMON-SEP-FIELDS]: in Domain each duelist has their own Deck Master and Deck Master zone`;
const MASTERS: Record<Seat, string> = { p0: "Axe Raider", p1: "Celtic Guardian", p2: "Battle Ox", p3: "Giant Soldier of Stone" };
const CODES: Record<Seat, number> = { p0: 48305365, p1: 91152256, p2: 5053103, p3: 13039848 };
const SPIDER = "Link Spider";

function setupFor(format: Format, seat: Seat): Scenario["setup"] {
  const setup: Record<string, unknown> = { mode: "domain", format, attackFirstTurn: true };
  for (const s of SEATS[format]) setup[s] = { deckMaster: MASTERS[s], ...(s === seat ? { extra: [SPIDER] } : {}) };
  return setup as Scenario["setup"];
}

const others = (format: Format, seat: Seat) => Object.fromEntries(SEATS[format].filter((s) => s !== seat).map((s) => [s, { deckMaster: { inZone: true, returns: 0 } }]));

/** The turn player summons its own Deck Master with a Normal Summon: only its zone is empty. */
function summon(format: Format, seat: Seat): Scenario {
  return defineScenario({
    id: `domain-${format}-deck-master-normal-summon-by-${seat}-only-its-zone-is-empty`,
    title: `Domain ${label(format)}: ${seat} Normal Summons its Deck Master from the zone: it is on the field of ${seat}, the Deck Master zones of the other seats are untouched`,
    source: RULE,
    rules: ["R-COMMON-SEP-FIELDS"],
    tags: ["multiplayer", "domain", "deck-master", format, `card:${CODES[seat]}`],
    setup: setupFor(format, seat),
    steps: [
      ...turnsBefore(format, seat),
      expectOffered("normalSummon", { card: MASTERS[seat], from: "dmz" }, seat),
      normalSummon({ card: MASTERS[seat], from: "dmz" }, seat),
      everySeat(format, { [seat]: { monsters: [MASTERS[seat]], deckMaster: { inZone: false, returns: 0 } }, ...others(format, seat) }),
    ],
  });
}

/** The Deck Master on the field is the only Link Material of Link Spider: the owner is asked for the recall, and answers yes or no. */
function link(format: Format, seat: Seat, recall: boolean): Scenario {
  const steps: Step[] = [
    ...turnsBefore(format, seat),
    normalSummon({ card: MASTERS[seat], from: "dmz" }, seat),
    specialSummon({ card: SPIDER, from: "extra" }, seat),
    select(MASTERS[seat]),
    expectPrompt({ by: seat, context: "deck-master-recall" }),
    recall ? yes(seat) : no(seat),
  ];
  const own = recall
    ? { monsters: [SPIDER], grave: [], deckMaster: { inZone: true, returns: 1, nextCost: 500 } }
    : { monsters: [SPIDER], grave: [MASTERS[seat]], deckMaster: { inZone: false, returns: 0 } };
  return defineScenario({
    id: `domain-${format}-deck-master-link-material-by-${seat}-${recall ? "recalled" : "recall-refused"}`,
    title: `Domain ${label(format)}: ${seat} uses its Deck Master as the Link Material of Link Spider, only ${seat} is asked for the recall and ${recall ? "recalls it (the first return is free)" : "refuses: the Deck Master stays in the Graveyard"}; the other Deck Master zones are untouched`,
    source: RULE,
    rules: ["R-COMMON-SEP-FIELDS"],
    tags: ["multiplayer", "domain", "deck-master", "link", format, "card:98978921"],
    setup: setupFor(format, seat),
    steps: [...steps, everySeat(format, { [seat]: own, ...others(format, seat) })],
  });
}

export const DOMAIN_NSEAT_GAP_SCENARIOS: Scenario[] = [
  summon("ffa3", "p0"), summon("ffa3", "p2"), summon("ffa4", "p3"), summon("tag", "p0"), summon("tag", "p1"), summon("tag", "p2"),
  link("ffa3", "p0", true), link("ffa3", "p2", false), link("ffa4", "p3", true), link("tag", "p0", true), link("tag", "p1", false), link("tag", "p3", true),
];
