import { describe, expect, it } from "vitest";
import { isDeckLockedError, ownWindowGateVisible, shouldCheckDeck, startButtonLabel } from "@/components/duel/start-flow";

const lockedError = Object.assign(new Error("Decks are locked after the duel starts"), { name: "DuelRequestError", status: 409 });

describe("deck check while the duel starts", () => {
  it("checks the deck only while the table is in the lobby", () => {
    expect(shouldCheckDeck("lobby")).toBe(true);
    expect(shouldCheckDeck("active")).toBe(false);
    expect(shouldCheckDeck("completed")).toBe(false);
  });

  it("treats the locked-deck answer as a state change, not an error", () => {
    expect(isDeckLockedError(lockedError)).toBe(true);
  });

  it("keeps other failures as errors", () => {
    expect(isDeckLockedError(Object.assign(new Error("Decks are locked after the duel starts"), { status: 500 }))).toBe(false);
    expect(isDeckLockedError(Object.assign(new Error("Stale"), { status: 409 }))).toBe(false);
    expect(isDeckLockedError(new Error("Decks are locked after the duel starts"))).toBe(false);
    expect(isDeckLockedError("Decks are locked after the duel starts")).toBe(false);
    expect(isDeckLockedError(null)).toBe(false);
  });
});

describe("own-window screen", () => {
  const base = { status: "lobby", mySeat: 0, inDuelWindow: false, playHere: false, hasResult: false, starting: false, windowOpened: false };

  it("shows for a seated player of a live duel outside the duel window", () => {
    expect(ownWindowGateVisible({ ...base, status: "active" })).toBe(true);
    expect(ownWindowGateVisible({ ...base, status: "active", inDuelWindow: true })).toBe(false);
    expect(ownWindowGateVisible({ ...base, status: "active", playHere: true })).toBe(false);
    expect(ownWindowGateVisible({ ...base, status: "active", mySeat: null })).toBe(false);
    expect(ownWindowGateVisible({ ...base, status: "active", hasResult: true })).toBe(false);
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
