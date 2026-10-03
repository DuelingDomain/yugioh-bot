import { OcgQueryFlags, type OcgCoreSync, type OcgDuelHandle, type OcgLocation } from "ocgcore-wasm";
import { cardLabel } from "./card-catalog.js";
import { expectKnownFailure, knownGapLabel, type KnownGap } from "./expected-failure.js";

/**
 * The pending-loss cases of the N-seat stress scenarios fail on the installed P68 cores. Chain cleanup sends the
 * removed Dust Tornado back to the Graveyard of the lost seat 1, because field::eliminate does not clear
 * core.leave_confirmed. They need domain-core/proposals/domain-nseat-stress/remove-eliminated-chain-cards.patch
 * (docs/specs/2026-10-02-approved-core-integration.md lines 210 and 218-226).
 *
 * Only the leftover-card check is the known gap. A case runs every other check for real and hands the leftovers
 * to checkLeftovers. The mark accepts exactly the list below, so a different leftover card or zone stays red.
 * When the patch lands the case fails with "known gap fixed": remove the mark (this file) then.
 */
export const PENDING_LOSS_GAP: KnownGap = {
  patch: "remove-eliminated-chain-cards.patch",
  spec: "docs/specs/2026-10-02-approved-core-integration.md:210,218",
  failsWith: ['Cards left in the zones of eliminated seats: [{"seat":1,"location":16,"count":1,"cards":["Dust Tornado (']
};

export const isPendingLoss = (id: string) => id.includes("-pending-loss-keeps-other-seat-chain-window");

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

/** Fails when any card is left. This is the one check that the pending-loss gap changes. */
export function expectNoLeftovers(leftovers: Leftover[]): void {
  if (leftovers.length > 0) throw new Error(`Cards left in the zones of eliminated seats: ${JSON.stringify(leftovers)}`);
}

/** The leftover check of one case. A pending-loss case accepts only the known list. */
export async function checkLeftovers(id: string, leftovers: Leftover[]): Promise<void> {
  if (isPendingLoss(id)) await expectKnownFailure(PENDING_LOSS_GAP, () => expectNoLeftovers(leftovers));
  else expectNoLeftovers(leftovers);
}

/** The test title; a pending-loss case shows the mark. */
export const pendingLossTitle = (id: string, title: string) => (isPendingLoss(id) ? `${title} [${knownGapLabel(PENDING_LOSS_GAP)}]` : title);
