import { describe, expect, it } from "vitest";
import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { hudPreview } from "@/components/duel/table/hud-preview";

const card = (code: number) => ({ code, name: `Card ${code}`, controller: 0 }) as unknown as DuelCard;
const row = { code: 9, name: "Row card" } as unknown as DuelCardInfo;
const ownerOf = (c: DuelCard) => ({ name: `Seat ${c.controller}`, main: "#fff", ink: "#000" });

describe("hudPreview", () => {
  it("keeps the menu's card while nothing is hovered", () => {
    expect(hudPreview(null, card(1), null, ownerOf)?.card).toMatchObject({ code: 1 });
  });
  it("shows a hovered card over the menu's card", () => {
    expect(hudPreview(card(2), card(1), null, ownerOf)?.card).toMatchObject({ code: 2 });
  });
  it("shows the menu's card over a prompt row card", () => {
    expect(hudPreview(null, card(1), row, ownerOf)?.card).toMatchObject({ code: 1 });
  });
  it("falls back to the row card, with no owner, when no menu is open", () => {
    expect(hudPreview(null, null, row, ownerOf)).toEqual({ card: row, owner: null });
    expect(hudPreview(null, undefined, row, ownerOf)?.owner).toBeNull();
  });
  it("ignores a menu card with no code, so the row card can show", () => {
    const hidden = { name: "Set card", controller: 0, code: null } as unknown as DuelCard;
    expect(hudPreview(null, hidden, row, ownerOf)).toEqual({ card: row, owner: null });
    expect(hudPreview(null, hidden, null, ownerOf)).toBeNull();
  });
  it("shows nothing when the menu is closed and nothing is hovered", () => {
    expect(hudPreview(null, null, null, ownerOf)).toBeNull();
  });
  it("gives a board card its owner", () => {
    expect(hudPreview(null, card(1), null, ownerOf)?.owner?.name).toBe("Seat 0");
  });
});
