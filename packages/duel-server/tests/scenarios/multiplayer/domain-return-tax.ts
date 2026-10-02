import { activate, defineScenario, expectPrompt, select, specialSummon, yes, type Scenario, type Step } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const LINK = "Link Spider";
const MATERIAL = "Mystical Elf";
const REMOVE = "Tribute to The Doomed";
const MASTERS: Record<Seat, string> = { p0: "Axe Raider", p1: "Celtic Guardian", p2: "Battle Ox", p3: "Giant Soldier of Stone" };

function tax(format: Format, actor: Seat): Scenario {
  const setup: Scenario["setup"] = { mode: "domain", format };
  for (const seat of SEATS[format]) setup[seat] = { deckMaster: seat === actor ? LINK : MASTERS[seat], ...(seat === actor ? { monsters: [MATERIAL, MATERIAL, MATERIAL], hand: [REMOVE, REMOVE, REMOVE, MATERIAL, MATERIAL, MATERIAL] } : {}) };
  const others = Object.fromEntries(SEATS[format].filter((seat) => seat !== actor).map((seat) => [seat, { deckMaster: { inZone: true, returns: 0, nextCost: 0 } }]));
  const steps: Step[] = [...turnsBefore(format, actor), everySeat(format, { [actor]: { monsters: [MATERIAL, MATERIAL, MATERIAL], deckMaster: { inZone: true, returns: 0, nextCost: 0 } }, ...others })];
  for (let returns = 0; returns < 3; returns++) {
    const lp = baseLp(format) - 500 * returns * (returns + 1) / 2;
    const grave = Array.from({ length: returns }, () => [MATERIAL, MATERIAL, REMOVE]).flat();
    steps.push(
      specialSummon({ card: LINK, from: "dmz" }, actor),
      { ...select({ card: MATERIAL, owner: actor, nth: 0 }), by: actor },
      everySeat(format, { [actor]: { lp, monsters: [LINK, ...Array(2 - returns).fill(MATERIAL)], grave: [...grave, MATERIAL], deckMaster: { inZone: false, returns, nextCost: returns * 500 } }, ...others }),
      activate({ card: REMOVE, nth: 0 }, actor),
      { ...select({ card: MATERIAL, owner: actor, from: "hand", nth: 0 }), by: actor },
      ...(returns < 2 ? [{ ...select({ card: LINK, owner: actor }), by: actor } as Step] : []),
      expectPrompt({ by: actor, context: "deck-master-recall" }),
      yes(actor),
      everySeat(format, { [actor]: { lp, monsters: Array(2 - returns).fill(MATERIAL), grave: [...grave, MATERIAL, MATERIAL, REMOVE], deckMaster: { inZone: true, returns: returns + 1, nextCost: (returns + 1) * 500 } }, ...others }),
    );
  }
  return defineScenario({
    id: `domain-${format}-return-tax-${actor}-zero-500-1000`,
    title: `Domain ${label(format)}: ${actor} summons its Link Deck Master three times for 0, 500 and 1000 LP; recall itself costs no LP`,
    source: `${SOURCE} [R-COMMON-SEP-FIELDS]: each completed return adds 500 LP to the next Deck Master summon; Tag pays from one team LP total`,
    rules: ["R-COMMON-SEP-FIELDS", ...(format === "tag" ? ["R-TAG-LP"] : ["R-FFA-LP"])],
    tags: ["multiplayer", "domain", "deck-master", "lp-cost", format, "card:98978921"],
    setup, steps,
  });
}

export const DOMAIN_RETURN_TAX_SCENARIOS = [tax("ffa3", "p2"), tax("ffa4", "p3"), tax("tag", "p2"), tax("tag", "p3")];
