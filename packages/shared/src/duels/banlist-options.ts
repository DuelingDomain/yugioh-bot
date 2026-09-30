/**
 * Immutable versioned banlist IDs for Custom Game Creator.
 *
 * TCG September 2026 (id `tcg-2026-09`):
 *   Official: https://www.yugioh-card.com/en/limited/list_2026-09-21/
 *   Passcodes: ProjectIgnis/LFLists 0TCG.lflist.conf `!2026.09 TCG`
 *   SHA-256(0TCG.lflist.conf)=1c1a6469b42d090d43769089fd1145bc5697000d4b63a62bf2a12f1e0f546f2c
 *   SHA-256(compiled entries)=9e37d3e783bcb3abdf024423d4825122a6938a53bb16e49fc40704de14a18051
 *   Mind Master and Elder Entity Norden are Unlimited as of 2026-09-28.
 *
 * OCG July 2026 (id `ocg-2026-07`, current-effective through 2026-09-30):
 *   Official: https://www.yugioh-card.com/japan/event/limitregulation/?list=202607
 *   https://yugipedia.com/wiki/July_2026_Lists_(OCG)
 *   Passcodes: ProjectIgnis/LFLists OCG.lflist.conf `!2026.07 OCG`
 *   SHA-256(OCG.lflist.conf)=a2039953c509ad8fa72bc98567ff4d4d8ab0464248a1aa1557ea3fe23a30a3cd
 *   SHA-256(compiled entries)=a3e27ec788e657f859543b0eee45f0ebf7db6bd873ad6fa046c8b6285f8ce94a
 *   Do not substitute the not-yet-effective 2026-10-01 OCG list.
 *
 * Compiled copy-limit maps live in `@yugidraft/duel-server` (`src/banlists/compiled.ts`).
 */
export interface DuelBanlistOption {
  readonly id: string;
  readonly label: string;
  readonly region: "none" | "tcg" | "ocg";
  readonly effectiveFrom: string | null;
}

export const NO_BANLIST_ID = "none";
export const PINNED_TCG_BANLIST_ID = "tcg-2026-09";
export const PINNED_OCG_BANLIST_ID = "ocg-2026-07";

export const DUEL_BANLIST_OPTIONS: readonly DuelBanlistOption[] = [
  { id: NO_BANLIST_ID, label: "None", region: "none", effectiveFrom: null },
  { id: PINNED_TCG_BANLIST_ID, label: "TCG September 2026", region: "tcg", effectiveFrom: "2026-09-21" },
  { id: PINNED_OCG_BANLIST_ID, label: "OCG July 2026", region: "ocg", effectiveFrom: "2026-07-01" },
];
