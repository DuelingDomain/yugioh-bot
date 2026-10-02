import { activate, expectNotOffered, expectOffered, expectPrompt, no, specialSummon, yes, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const LINK = "Link Spider";
const MATERIAL = "Mystical Elf";
const MASTERS: Record<Seat, string> = { p0: "Axe Raider", p1: "Celtic Guardian", p2: "Battle Ox", p3: "Giant Soldier of Stone" };

function summon(format: Format, actor: Seat, recall: boolean): Scenario {
  const setup: Scenario["setup"] = { mode: "domain", format };
  for (const seat of SEATS[format]) setup[seat] = { deckMaster: seat === actor ? LINK : MASTERS[seat], ...(seat === actor ? { monsters: [MATERIAL], hand: ["Dark Hole"] } : {}) };
  const others = Object.fromEntries(SEATS[format].filter((seat) => seat !== actor).map((seat) => [seat, { deckMaster: { inZone: true, returns: 0, nextCost: 0 } }]));
  return defineScenario({
    id: `domain-${format}-link-master-from-zone-${actor}-${recall ? "recall" : "refuse"}`,
    title: `Domain ${label(format)}: ${actor} Link Summons its Deck Master from its zone, then ${recall ? "recalls it" : "refuses recall"} after Dark Hole`,
    source: `${SOURCE} [R-COMMON-SEP-FIELDS]: a Link Deck Master uses its proper summon and its owner receives the recall`,
    rules: ["R-COMMON-SEP-FIELDS", "R-COMMON-EMZ"],
    tags: ["multiplayer", "domain", "deck-master", "link", format, "card:98978921"],
    setup,
    steps: [
      ...turnsBefore(format, actor),
      expectNotOffered("normalSummon", { card: LINK, from: "dmz" }, actor),
      expectOffered("specialSummon", { card: LINK, from: "dmz" }, actor),
      specialSummon({ card: LINK, from: "dmz" }, actor),
      { op: "select" as const, sels: [{ card: MATERIAL, owner: actor }], by: actor },
      everySeat(format, { [actor]: { monsters: [LINK], zones: { emz0: LINK, emz1: null }, grave: [MATERIAL], deckMaster: { inZone: false, returns: 0, nextCost: 0 } }, ...others }),
      activate("Dark Hole", actor),
      expectPrompt({ by: actor, context: "deck-master-recall" }),
      recall ? yes(actor) : no(actor),
      everySeat(format, {
        [actor]: { monsters: [], grave: recall ? [MATERIAL, "Dark Hole"] : [MATERIAL, "Dark Hole", LINK], deckMaster: { inZone: recall, returns: recall ? 1 : 0, nextCost: recall ? 500 : 0 } },
        ...others,
      }),
    ],
  });
}

export const DOMAIN_LINK_ZONE_SCENARIOS = [
  summon("ffa3", "p0", true), summon("ffa3", "p2", false),
  summon("ffa4", "p0", false), summon("ffa4", "p3", true),
  summon("tag", "p2", true), summon("tag", "p3", false),
];
