import { describe, expect, it } from "vitest";
import {
  defaultDuelSettings,
  DUEL_FORMATS,
  duelClockBankMs,
  duelClockRulesText,
  isCustomDomain,
  isDuelFormat,
  normalizeDuelClockState,
  normalizeDuelSettings,
  opponentSeatsOf,
  parseStoredDuelClock,
  partnerSeatOf,
  parseStoredDuelSettings,
  PINNED_TCG_BANLIST_ID,
  seatCountFor,
  seatsOfTeam,
  startingLpFor,
  teamCountFor,
  teamOfSeat,
} from "../../src/duels/settings.js";

describe("normalizeDuelSettings", () => {
  it("fills omitted fields and rejects unknown or illegal values", () => {
    const filled = normalizeDuelSettings("domain", { startingLP: 1 });
    expect(filled.startingLP).toBe(1);
    expect(filled.banlist).toBe("none");
    expect(filled.turnSeconds).toBe(240);

    expect(() => normalizeDuelSettings("normal", { turnSeconds: 29 })).toThrow(/turnSeconds/);
    expect(() => normalizeDuelSettings("normal", { startingHand: 41 })).toThrow(/startingHand/);
    expect(() => normalizeDuelSettings("normal", { cardPool: "goat" })).toThrow(/cardPool/);
    expect(() => normalizeDuelSettings("normal", { timeout: "skip" })).toThrow(/timeout/);
    expect(() => normalizeDuelSettings("normal", { validateDeck: "yes" })).toThrow(/validateDeck/);
    expect(() => normalizeDuelSettings("normal", { banlist: "made-up" })).toThrow(/banlist/);
    expect(() => normalizeDuelSettings("normal", { visibility: "public", foo: 1 })).toThrow(/Unknown duel setting: foo/);
    expect(() => normalizeDuelSettings("normal", [])).toThrow(/settings must be an object/);
  });

  it("pins the current TCG list for new standard games", () => {
    expect(normalizeDuelSettings("normal", undefined).banlist).toBe(PINNED_TCG_BANLIST_ID);
    expect(defaultDuelSettings("normal").turnSeconds).toBe(240);
  });
});

describe("isCustomDomain", () => {
  it("ignores visibility and clock while flagging gameplay overrides", () => {
    const baseline = defaultDuelSettings("domain");
    expect(isCustomDomain(5, baseline)).toBe(false);
    expect(isCustomDomain(5, { ...baseline, visibility: "private", turnSeconds: 30, timeout: "continue" })).toBe(false);
    expect(isCustomDomain(4, baseline)).toBe(true);
    expect(isCustomDomain(5, { ...baseline, banlist: PINNED_TCG_BANLIST_ID })).toBe(true);
    expect(isCustomDomain(5, { ...baseline, cardPool: "tcg" })).toBe(true);
    expect(isCustomDomain(5, { ...baseline, startingLP: 1 })).toBe(true);
    expect(isCustomDomain(5, { ...baseline, startingHand: 4 })).toBe(true);
    expect(isCustomDomain(5, { ...baseline, drawPerTurn: 2 })).toBe(true);
    expect(isCustomDomain(5, { ...baseline, validateDeck: false })).toBe(true);
    expect(isCustomDomain(5, { ...baseline, shuffleDeck: false })).toBe(true);
  });
});

describe("duel formats", () => {
  it("has the seat table", () => {
    expect(DUEL_FORMATS.map((format) => seatCountFor(format))).toEqual([2, 4, 3, 4]);
    expect(isDuelFormat("tag")).toBe(true);
    expect(isDuelFormat("2v2")).toBe(false);
  });

  it("maps seats to teams: Tag alternates, the rest are one seat per team", () => {
    expect([0, 1, 2, 3].map((seat) => teamOfSeat("tag", seat))).toEqual([0, 1, 0, 1]);
    expect([0, 1, 2].map((seat) => teamOfSeat("ffa3", seat))).toEqual([0, 1, 2]);
    expect([0, 1].map((seat) => teamOfSeat("1v1", seat))).toEqual([0, 1]);
    expect(seatsOfTeam("tag", 0)).toEqual([0, 2]);
    expect(seatsOfTeam("tag", 1)).toEqual([1, 3]);
    expect(seatsOfTeam("ffa4", 2)).toEqual([2]);
    expect(teamCountFor("tag")).toBe(2);
    expect(teamCountFor("ffa3")).toBe(3);
  });

  it("finds opponents and partners", () => {
    expect(opponentSeatsOf("tag", 0)).toEqual([1, 3]);
    expect(opponentSeatsOf("tag", 3)).toEqual([0, 2]);
    expect(opponentSeatsOf("ffa3", 1)).toEqual([0, 2]);
    expect(opponentSeatsOf("1v1", 0)).toEqual([1]);
    expect(partnerSeatOf("tag", 0)).toBe(2);
    expect(partnerSeatOf("tag", 1)).toBe(3);
    expect(partnerSeatOf("tag", 2)).toBe(0);
    expect(partnerSeatOf("tag", 3)).toBe(1);
    expect(partnerSeatOf("ffa4", 0)).toBeNull();
    expect(partnerSeatOf("1v1", 1)).toBeNull();
  });

  it("gives Tag a shared team LP and everyone else per-duelist LP", () => {
    const settings = defaultDuelSettings("normal");
    expect(startingLpFor("tag", settings)).toBe(16000);
    expect(startingLpFor("tag", { ...settings, startingLP: 4000 })).toBe(8000);
    expect(startingLpFor("ffa4", settings)).toBe(8000);
    expect(startingLpFor("1v1", settings)).toBe(8000);
  });
});

describe("N-seat clock state", () => {
  const base = { turn: 1, startedAt: null };
  it("accepts 2 to 4 seats, old two-seat clocks included", () => {
    expect(parseStoredDuelClock(JSON.stringify({ ...base, remainingMs: [1, 2], activeSeat: 1 }))?.remainingMs).toEqual([1, 2]);
    expect(normalizeDuelClockState({ ...base, remainingMs: [1, 2, 3, 4], activeSeat: 3 }).activeSeat).toBe(3);
  });

  it("rejects bad shapes", () => {
    expect(() => normalizeDuelClockState({ ...base, remainingMs: [1], activeSeat: 0 })).toThrow(/remainingMs/);
    expect(() => normalizeDuelClockState({ ...base, remainingMs: [1, 2, 3, 4, 5], activeSeat: 0 })).toThrow(/remainingMs/);
    expect(() => normalizeDuelClockState({ ...base, remainingMs: [1, 2, 3], activeSeat: 3 })).toThrow(/activeSeat/);
    expect(() => normalizeDuelClockState({ ...base, remainingMs: [1, -2], activeSeat: null })).toThrow(/remainingMs/);
  });
});

describe("unlimited turn time", () => {
  it("accepts 0 as unlimited and keeps it in stored settings", () => {
    expect(normalizeDuelSettings("normal", { turnSeconds: 0 }).turnSeconds).toBe(0);
    expect(parseStoredDuelSettings(JSON.stringify({ turnSeconds: 0 })).turnSeconds).toBe(0);
    expect(duelClockBankMs(0)).toBeNull();
    expect(duelClockRulesText(0)).toBe("");
  });
});

describe("stopAtEveryWindow", () => {
  it("is quiet for new duels and keeps asking for saved ones", () => {
    expect(defaultDuelSettings("normal").stopAtEveryWindow).toBe(false);
    expect(normalizeDuelSettings("domain", undefined).stopAtEveryWindow).toBe(false);
    // Rows saved before the setting existed replay with the old stop-everywhere engine behaviour.
    expect(parseStoredDuelSettings(JSON.stringify({ turnSeconds: 0 })).stopAtEveryWindow).toBe(true);
    expect(parseStoredDuelSettings(null).stopAtEveryWindow).toBe(true);
  });

  it("accepts a boolean and rejects anything else", () => {
    expect(normalizeDuelSettings("normal", { stopAtEveryWindow: true }).stopAtEveryWindow).toBe(true);
    expect(parseStoredDuelSettings(JSON.stringify({ stopAtEveryWindow: false })).stopAtEveryWindow).toBe(false);
    expect(() => normalizeDuelSettings("normal", { stopAtEveryWindow: "yes" })).toThrow(/stopAtEveryWindow/);
  });

  it("does not make a domain duel custom", () => {
    expect(isCustomDomain(5, { ...defaultDuelSettings("domain"), stopAtEveryWindow: true })).toBe(false);
  });
});
