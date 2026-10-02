import { activate, defineScenario, expectNotOffered, expectOffered, normalSummon, select, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const BREAKER = "Breaker the Magical Warrior";
const SPELL = "Dark Room of Nightmare";
const MASTERS: Record<Seat, string> = { p0: "Axe Raider", p1: "Celtic Guardian", p2: "Battle Ox", p3: "Giant Soldier of Stone" };

function ability(format: Format, actor: Seat, target: Seat): Scenario {
  const setup: Scenario["setup"] = { mode: "domain", format };
  for (const seat of SEATS[format]) setup[seat] = { deckMaster: seat === actor ? BREAKER : MASTERS[seat], spells: [SPELL] };
  return defineScenario({
    id: `domain-${format}-breaker-master-${actor}-destroys-only-${target}-spell`,
    title: `Domain ${label(format)}: the Deck Master of ${actor} uses its Spell Counter to destroy the Spell of ${target}; the other seats keep their cards`,
    source: `${SOURCE} [R-COMMON-SEP-FIELDS]: a summoned Deck Master has its real card effects`,
    rules: ["R-COMMON-SEP-FIELDS", "R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "domain", "deck-master", format, "card:71413901"],
    setup,
    steps: [
      ...turnsBefore(format, actor),
      expectNotOffered("activate", { card: BREAKER, from: "dmz" }, actor),
      normalSummon({ card: BREAKER, from: "dmz" }, actor),
      expectOffered("activate", BREAKER, actor),
      activate(BREAKER, actor),
      { ...select({ card: SPELL, owner: target }), by: actor },
      everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, {
        spells: seat === target ? [] : [SPELL],
        grave: seat === target ? [SPELL] : [],
        ...(seat === actor ? { monsters: [BREAKER], zones: { m0: { card: BREAKER, counters: {} } } } : {}),
        deckMaster: { inZone: seat !== actor, returns: 0, nextCost: 0 },
      }]))),
    ],
  });
}

export const DOMAIN_MASTER_ABILITY_SCENARIOS = [
  ability("ffa3", "p0", "p2"), ability("ffa3", "p2", "p1"),
  ability("ffa4", "p0", "p3"), ability("ffa4", "p3", "p1"),
  ability("tag", "p2", "p3"), ability("tag", "p3", "p2"),
];
