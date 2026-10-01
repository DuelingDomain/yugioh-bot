import { describe, expect, it } from "vitest";
import type { DuelCard } from "@yugidraft/shared/duels";
import { shouldClosePileForPrompt } from "@/components/duel/pile-focus";
import { LOCATION_EXTRA, LOCATION_GRAVE, LOCATION_MZONE, zoneKey } from "@/components/duel/constants";

const card = (controller: number, location: number, sequence: number) => ({ controller, location, sequence }) as DuelCard;

describe("shouldClosePileForPrompt", () => {
  const extra = [card(0, LOCATION_EXTRA, 0), card(0, LOCATION_EXTRA, 1)];

  it("closes the Extra Deck viewer when the material prompt asks for cards on the field", () => {
    const materials = new Set([zoneKey(0, LOCATION_MZONE, 0), zoneKey(0, LOCATION_MZONE, 2)]);
    expect(shouldClosePileForPrompt(extra, materials, true)).toBe(true);
  });

  it("keeps the viewer when a legal card is inside the pile", () => {
    expect(shouldClosePileForPrompt(extra, new Set([zoneKey(0, LOCATION_EXTRA, 1)]), true)).toBe(false);
    const grave = [card(0, LOCATION_GRAVE, 3)];
    expect(shouldClosePileForPrompt(grave, new Set([zoneKey(0, LOCATION_GRAVE, 3), zoneKey(0, LOCATION_MZONE, 0)]), true)).toBe(false);
  });

  it("keeps the viewer for prompts that are not yours or have no card choices", () => {
    const materials = new Set([zoneKey(0, LOCATION_MZONE, 0)]);
    expect(shouldClosePileForPrompt(extra, materials, false)).toBe(false);
    expect(shouldClosePileForPrompt(extra, new Set(), true)).toBe(false);
  });

  it("after an answer from the open viewer, closes it unless the next prompt of yours wants a card in it", () => {
    const materials = new Set([zoneKey(0, LOCATION_MZONE, 0)]);
    expect(shouldClosePileForPrompt(extra, materials, false, true)).toBe(true);
    expect(shouldClosePileForPrompt(extra, new Set(), true, true)).toBe(true);
    expect(shouldClosePileForPrompt(extra, new Set([zoneKey(0, LOCATION_EXTRA, 0)]), true, true)).toBe(false);
    expect(shouldClosePileForPrompt(extra, new Set([zoneKey(0, LOCATION_EXTRA, 0)]), false, true)).toBe(true);
  });
});
