import { TCG_2026_09_LIMITS, OCG_2026_07_LIMITS, type BanlistLimit } from "./compiled.js";

export type { BanlistLimit };

export const BANLIST_NONE_ID = "none";
export const BANLIST_TCG_2026_09_ID = "tcg-2026-09";
export const BANLIST_OCG_2026_07_ID = "ocg-2026-07";

const LISTS: Record<string, Record<number, BanlistLimit> | null> = {
  [BANLIST_NONE_ID]: null,
  [BANLIST_TCG_2026_09_ID]: TCG_2026_09_LIMITS,
  [BANLIST_OCG_2026_07_ID]: OCG_2026_07_LIMITS,
};

export function banlistLimitsFor(id: string): Record<number, BanlistLimit> | null {
  if (!Object.hasOwn(LISTS, id)) {
    throw new Error(`Unknown banlist ${id}`);
  }
  return LISTS[id] ?? null;
}
