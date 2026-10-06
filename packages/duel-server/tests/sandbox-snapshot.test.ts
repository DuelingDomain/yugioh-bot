import { describe, expect, it } from "vitest";
import { parseSandboxBoard, type DuelEngineView, type SandboxBoard, type SandboxRun } from "@yugidraft/shared/duels";
import { OcgLocation as L, OcgPosition as P, type OcgCardQueryInfo } from "ocgcore-wasm";
import { buildSandboxSnapshot, type SandboxEngineSnapshot } from "../src/sandbox-snapshot.js";

const run: SandboxRun = { bots: { "1": "manual", "2": "pass", "3": "practice" }, seed: ["1", "2", "3", "4"] };
const card = (code: number, position: number = P.FACEUP_ATTACK, more: Partial<OcgCardQueryInfo> = {}) =>
  ({ code, position, status: 8, ...more }) as Partial<OcgCardQueryInfo>;
function state(count = 2): SandboxEngineSnapshot {
  return {
    view: { turn: 3, turnSeat: 0, phase: "main1", revision: 7, prioritySeat: 0, prompt: null, result: null,
      chain: [], events: [], log: [], seats: Array.from({ length: count }, (_, seat) => ({ seat, lp: 8000,
        deckCount: 2, extraCount: 0, hand: [], extra: [], monsters: [], spells: [], graveyard: [], banished: [] })) },
    locations: Array.from({ length: count }, () => ({ [L.DECK]: [card(111, P.FACEDOWN_DEFENSE), card(222, P.FACEDOWN_DEFENSE)],
      [L.HAND]: [], [L.MZONE]: [], [L.SZONE]: [], [L.GRAVE]: [], [L.REMOVED]: [], [L.EXTRA]: [] })),
  };
}
const take = (raw: SandboxEngineSnapshot, board: SandboxBoard = {}) => buildSandboxSnapshot(raw, board, run);

describe("sandbox snapshot conversion", () => {
  it("captures live hidden cards, Deck top order, positions, materials and current run", () => {
    const raw = state();
    raw.locations[0][L.HAND] = [card(333, P.FACEDOWN)];
    raw.locations[1][L.MZONE] = [null, card(444, P.FACEDOWN_DEFENSE, { status: 0, overlayCards: [555, 666] })];
    raw.locations[1][L.SZONE] = [null, card(777, P.FACEDOWN), null, null, null, card(888), card(999), null];
    raw.locations[1][L.EXTRA] = [card(123, P.FACEDOWN_DEFENSE)];
    raw.locations[0][L.GRAVE] = [card(456)];
    raw.view.seats[0].lp = 6400;
    const before = structuredClone(raw);
    const result = take(raw);
    expect(parseSandboxBoard(result.board)).toEqual(result.board);
    expect(result.board).toMatchObject({ turn: "p0", startAt: "main1", deckSize: 2,
      p0: { lp: 6400, hand: [333], deck: [222, 111], grave: [456] },
      p1: { monsters: [null, { card: 444, pos: "set", summoned: false, materials: [555, 666] }],
        spells: [null, { card: 777, pos: "set" }, null, null, null], field: { card: 888, pos: "up" },
        pendulum: [{ card: 999, pos: "up" }, null], extra: [123] } });
    expect(result.run).toEqual(run);
    expect(result.run).not.toBe(run);
    expect(raw).toEqual(before);
  });

  it("clears eliminated Domain seats and keeps zero LP and live turn seat", () => {
    const raw = state(4);
    raw.view.turnSeat = 2;
    raw.view.seats[1].eliminated = true;
    raw.view.seats[1].lp = 0;
    for (const seat of raw.view.seats) {
      seat.deckMaster = { card: { code: 15025844 } as any, inZone: true, returns: 0, nextCost: 0 };
      raw.locations[seat.seat][0x4000] = [card(15025844)];
    }
    const result = take(raw, { format: "ffa4", mode: "domain" });
    expect(result.board).toMatchObject({ eliminated: ["p1"], turn: "p2", p1: { lp: 0 }, p2: { deckMaster: 15025844 } });
    expect(result.board.p1).toEqual({ lp: 0 });
    expect(parseSandboxBoard(result.board)).toEqual(result.board);
  });

  it("reports unequal Deck sizes, pile positions, counters, equip links and ownership", () => {
    const raw = state();
    raw.locations[1][L.DECK] = [];
    raw.locations[0][L.REMOVED] = [card(123, P.FACEDOWN_DEFENSE)];
    raw.locations[0][L.EXTRA] = [card(456)];
    raw.locations[0][L.MZONE] = [card(789, P.FACEUP_ATTACK, { owner: 1, counters: { 1: 2 } })];
    raw.locations[0][L.SZONE] = [card(101, P.FACEUP, { equipCard: { controller: 0, location: L.MZONE, sequence: 0, position: P.FACEUP_ATTACK } })];
    raw.view.chain = [{ index: 1, seat: 0 }];
    const { board, lost } = take(raw);
    expect(board.deckSize).toBe(2);
    for (const feature of ["unequal Deck sizes", "p0.banished", "p0.extra", "counters", "equip links", "ownership", "chain", "turn count", "this-turn", "lasting effects", "Draw Phase"]) {
      expect(lost.join("\n")).toContain(feature);
    }
  });

  it.each(["draw", "standby", "main1", "battle-start", "battle", "damage", "damage-calculation", "main2", "end"])(
    "maps the live %s phase", (phase) => {
      const raw = state(); raw.view.phase = phase;
      const { board, lost } = take(raw);
      const battle = phase.startsWith("battle") || phase.startsWith("damage");
      expect(board.startAt).toBe(battle ? "battle" : phase);
      if (battle) { expect(board.attackFirstTurn).toBe(true); expect(lost.join("\n")).toContain("attackFirstTurn"); }
    });

  it.each(["ffa3", "ffa4", "tag"] as const)("allows a captured later Battle Phase on p1 in %s", (format) => {
    const raw = state(format === "ffa3" ? 3 : 4);
    raw.view.turnSeat = 1; raw.view.turn = 6; raw.view.phase = "battle";
    const result = take(raw, { format });
    expect(result.board.attackFirstTurn).toBe(true);
    expect(result.lost.join("\n")).toContain("attackFirstTurn");
  });

  it("stores Tag team LP only on p0 and p1", () => {
    const { board } = take(state(4), { format: "tag" });
    expect(board.p0?.lp).toBe(8000); expect(board.p1?.lp).toBe(8000);
    expect(board.p2?.lp).toBeUndefined(); expect(board.p3?.lp).toBeUndefined();
  });

  it("refuses invalid or incomplete capture instead of dropping cards", () => {
    const raw = state(); raw.locations[0][L.HAND] = Array.from({ length: 21 }, () => card(123));
    expect(() => take(raw)).toThrow(/p0.hand/);
    raw.locations[0][L.HAND] = [{ position: P.FACEDOWN }];
    expect(() => take(raw)).toThrow(/passcode/i);
    raw.locations[0][L.HAND] = [];
    raw.view.phase = "unknown";
    expect(() => take(raw)).toThrow(/phase/i);
  });

  it("reports Deck Master counters and material ownership loss", () => {
    const raw = state();
    for (const seat of raw.view.seats) {
      seat.deckMaster = { card: { code: 15025844 } as any, inZone: true, returns: 2, nextCost: 1000 };
      raw.locations[seat.seat][0x4000] = [card(15025844, P.FACEUP_ATTACK, { counters: { 1: 3 } })];
    }
    raw.locations[0][L.MZONE] = [card(123, P.FACEUP_ATTACK, { overlayCards: [456] })];
    const result = take(raw, { mode: "domain" });
    expect(result.lost.join("\n")).toContain("p0.deckMaster: counters");
    expect(result.lost.join("\n")).toContain("material ownership");
    delete raw.locations[0][0x4000];
    expect(() => take(raw, { mode: "domain" })).toThrow(/missing engine location/);
  });

  it("refuses pending elimination and an absent live Deck Master", () => {
    const raw = state(3); raw.view.seats[1].pendingElimination = true;
    expect(() => take(raw, { format: "ffa3" })).toThrow(/elimination/i);
    raw.view.seats[1].pendingElimination = false;
    expect(() => take(raw, { format: "ffa3", mode: "domain" })).toThrow(/Deck Master/i);
  });
});
