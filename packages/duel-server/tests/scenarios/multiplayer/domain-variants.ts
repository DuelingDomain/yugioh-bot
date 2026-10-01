import type { DuelistId, Scenario } from "../../support/dsl.js";
import { seatCountFor } from "@yugidraft/shared/duels";

/**
 * Domain variants of the multiplayer scenarios (review B, test proof quality: no overlay card was proven in a real Domain n-seat duel).
 *
 * `domainVariant(s)` is the same scenario in `mode: "domain"` on the Domain multi core, with one Deck Master for each seat. Every step and
 * every expected end state is the one of the Standard scenario, so a Domain run proves that the overlay card and the Domain layer for
 * 3 and 4 duelists (apply-domain-multi) work together. The Deck Master is a vanilla monster that the scenario does not name, so it is
 * never an option of a step of the scenario.
 */
const DECK_MASTERS = ["Axe Raider", "Celtic Guardian", "Battle Ox", "Giant Soldier of Stone", "Gaia The Fierce Knight", "Beaver Warrior", "Mammoth Graveyard", "Feral Imp", "Silver Fang", "Skull Servant", "Hitotsu-Me Giant", "Curse of Dragon"];

export function domainVariant(scenario: Scenario): Scenario {
  const text = JSON.stringify([scenario.setup, scenario.steps]);
  const free = DECK_MASTERS.filter((name) => !text.includes(name));
  const seats = (["p0", "p1", "p2", "p3"] as DuelistId[]).slice(0, seatCountFor(scenario.setup.format ?? "1v1"));
  if (free.length < seats.length) throw new Error(`${scenario.id}: not enough free Deck Masters`);
  const setup = { ...scenario.setup, mode: "domain" as const };
  seats.forEach((id, index) => {
    setup[id] = { ...(scenario.setup[id] ?? {}), deckMaster: free[index] };
  });
  return {
    ...scenario,
    id: `${scenario.id}-domain`,
    title: `${scenario.title} (Domain, a Deck Master for each seat)`,
    tags: [...scenario.tags, "domain"],
    setup,
  };
}
