import { describe, expect, it } from "vitest";
import { ownWindowGateVisible, shouldCheckDeck, startButtonLabel } from "@/components/duel/start-flow";

describe("deck check while the duel starts", () => {
  it("checks the deck only while the table is in the lobby", () => {
    expect(shouldCheckDeck("lobby")).toBe(true);
    expect(shouldCheckDeck("active")).toBe(false);
    expect(shouldCheckDeck("completed")).toBe(false);
  });
});

describe("own-window screen", () => {
  const base = { status: "lobby", mySeat: 0, inDuelWindow: false, playHere: false, hasResult: false, starting: false, windowOpened: false };

  it("never shows for someone who landed on a live duel without opening a window", () => {
    expect(ownWindowGateVisible({ ...base, status: "active" })).toBe(false);
    expect(ownWindowGateVisible({ ...base, status: "active", mySeat: null })).toBe(false);
  });

  it("shows for a live duel while the window this tab opened is open", () => {
    expect(ownWindowGateVisible({ ...base, status: "active", windowOpened: true })).toBe(true);
    expect(ownWindowGateVisible({ ...base, status: "active", windowOpened: true, inDuelWindow: true })).toBe(false);
    expect(ownWindowGateVisible({ ...base, status: "active", windowOpened: true, playHere: true })).toBe(false);
    expect(ownWindowGateVisible({ ...base, status: "active", windowOpened: true, mySeat: null })).toBe(false);
    expect(ownWindowGateVisible({ ...base, status: "active", windowOpened: true, hasResult: true })).toBe(false);
  });

  it("shows at once after Start duel when the window opened, before the server answers", () => {
    expect(ownWindowGateVisible({ ...base, starting: true, windowOpened: true })).toBe(true);
  });

  it("keeps the lobby when the pop-up was blocked, or when no start is running", () => {
    expect(ownWindowGateVisible({ ...base, starting: true, windowOpened: false })).toBe(false);
    expect(ownWindowGateVisible({ ...base, starting: false, windowOpened: true })).toBe(false);
  });

  it("does not hide the duel window or Open here instead while starting", () => {
    expect(ownWindowGateVisible({ ...base, starting: true, windowOpened: true, inDuelWindow: true })).toBe(false);
    expect(ownWindowGateVisible({ ...base, starting: true, windowOpened: true, playHere: true })).toBe(false);
  });
});

describe("Start duel button label", () => {
  it("shows a calm starting state while the request runs", () => {
    expect(startButtonLabel(true)).toBe("Starting duel…");
    expect(startButtonLabel(false)).toBe("Start duel");
  });
});
