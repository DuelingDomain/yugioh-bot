import type { DuelPromptOption } from "@yugidraft/shared/duels";
import { LOCATION_DECKMASTER, type DomainSeatState } from "./views.js";

/** Restore the DMZ location lost by the byte-sized protocol and show its action cost. */
export function annotateDeckMasterActions(options: DuelPromptOption[], domain?: readonly DomainSeatState[]): void {
  if (!domain) return;
  for (const option of options) {
    const master = option.controller == null ? undefined : domain[option.controller];
    if (!master?.inZone || option.card?.code !== master.code || option.sequence !== 0) continue;
    if (option.location === 0) option.location = LOCATION_DECKMASTER;
    if (option.location === LOCATION_DECKMASTER && /^(summon|spsummon|mset|activate):/.test(option.id)) {
      option.label += ` (costs ${master.nextCost} LP)`;
    }
  }
}
