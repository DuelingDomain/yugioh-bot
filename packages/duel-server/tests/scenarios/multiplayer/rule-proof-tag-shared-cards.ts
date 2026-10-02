import { activate, defineScenario, expectNotOffered, expectOffered, expectPickOptions, select, zone, type Scenario } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, PARTNER, SEATS, turnsBefore } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";
import { TAG_COPY_SCENARIOS } from "./tag-copies.js";

function partnerField(actor: "p0" | "p1"): Scenario {
  const partner = PARTNER[actor];
  const opponents = SEATS.tag.filter((seat) => seat !== actor && seat !== partner);
  const setup: Scenario["setup"] = { format: "tag", [actor]: { hand: ["Dark Magic Attack"] },
    [partner]: { monsters: ["Dark Magician"], spells: [{ card: "Dark Hole", pos: "set" }] } };
  for (const seat of opponents) setup[seat] = { spells: [{ card: "Raigeki", pos: "set" }] };
  return defineScenario({ id: `rule-proof-tag-shared-field-${actor}`, title: `Tag: ${actor} uses its partner's Dark Magician for its own card condition`,
    source: `${SOURCE} [R-TAG-SHARED-CARDS]`, rules: ["R-TAG-SHARED-CARDS"], tags: ["multiplayer", "tag", "card:2314238"], setup,
    steps: [...turnsBefore("tag", actor), expectOffered("activate", "Dark Magic Attack", actor), activate("Dark Magic Attack", actor),
      everySeat("tag", Object.fromEntries(SEATS.tag.map((seat) => [seat, {
        hand: seat === "p1" && actor === "p1" ? ["Mystical Elf"] : [],
        monsters: seat === partner ? ["Dark Magician"] : [], spells: seat === partner ? ["Dark Hole"] : [],
        grave: seat === actor ? ["Dark Magic Attack"] : opponents.includes(seat) ? ["Raigeki"] : [],
      }])) )],
  });
}

function partnerGrave(actor: "p0" | "p1"): Scenario {
  const partner = PARTNER[actor];
  const returned = ["Silver Fang", "Beaver Warrior", "Celtic Guardian", "Giant Soldier of Stone"];
  const setup: Scenario["setup"] = { format: "tag", [actor]: { hand: ["Pot of Avarice"], grave: ["Mystical Elf", "Axe Raider"] },
    [partner]: { hand: ["Pot of Greed"], grave: returned } };
  for (const seat of SEATS.tag.filter((seat) => seat !== actor && seat !== partner)) setup[seat] = { grave: ["Battle Ox"] };
  return defineScenario({ id: `rule-proof-tag-shared-grave-own-draw-${actor}`, title: `Tag: ${actor} selects its partner's Graveyard, then draws only from its own Deck`,
    source: `${SOURCE} [R-TAG-SHARED-CARDS]`, rules: ["R-TAG-SHARED-CARDS"], tags: ["multiplayer", "tag", "card:67169062"], setup,
    steps: [...turnsBefore("tag", actor), expectNotOffered("activate", { card: "Pot of Greed", owner: partner }, actor),
      activate("Pot of Avarice", actor), zone(actor, "s0", actor), expectPickOptions({ count: 6, include: returned.map((card) => ({ card, seat: partner })),
        exclude: [{ card: "Battle Ox" }] }, actor),
      select({ card: "Mystical Elf", owner: actor }, ...returned.map((card) => ({ card, owner: partner }))),
      everySeat("tag", Object.fromEntries(SEATS.tag.map((seat) => [seat, {
        hand: { count: seat === actor ? actor === "p0" ? 2 : 3 : seat === partner ? 1 : 0 },
        deckCount: seat === actor ? actor === "p0" ? 19 : 18 : seat === partner ? 24 : 20,
        grave: seat === actor ? ["Pot of Avarice", "Axe Raider"] : seat === partner ? [] : ["Battle Ox"],
      }])) )],
  });
}
const standard = (["p0", "p1"] as const).flatMap((actor) => [partnerField(actor), partnerGrave(actor)]);
const ownHand = TAG_COPY_SCENARIOS.filter((scenario) => scenario.rules?.includes("R-TAG-SHARED-CARDS"))
  .map((scenario) => domainVariant({ ...scenario, id: `rule-proof-${scenario.id}` }));
export const TAG_SHARED_CARD_PROOF_SCENARIOS = [...standard, ...standard.map(domainVariant), ...ownHand];
