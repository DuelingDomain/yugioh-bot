import { OcgQueryFlags, type OcgCoreSync, type OcgDuelHandle, type OcgLocation } from "ocgcore-wasm";
import { cardLabel } from "./card-catalog.js";
export interface Leftover { seat: number; location: number; count: number; cards: string[] }

/** Every card the core still holds in the given locations of the given seats. Empty zones are not listed. */
export function collectLeftovers(lib: OcgCoreSync, handle: OcgDuelHandle, probes: Array<{ seat: number; locations: number[] }>): Leftover[] {
  const found: Leftover[] = [];
  for (const { seat, locations } of probes) {
    for (const location of locations) {
      const count = lib.duelQueryCount(handle, seat, location as OcgLocation);
      if (count === 0) continue;
      const cards = lib.duelQueryLocation(handle, { controller: seat as 0 | 1, location: location as OcgLocation, flags: OcgQueryFlags.CODE })
        .map((card) => cardLabel(card?.code));
      found.push({ seat, location, count, cards });
    }
  }
  return found;
}

/** Fails when any card remains in a real zone after elimination. */
export function expectNoLeftovers(leftovers: Leftover[]): void {
  if (leftovers.length > 0) throw new Error(`Cards left in the zones of eliminated seats: ${JSON.stringify(leftovers)}`);
}
