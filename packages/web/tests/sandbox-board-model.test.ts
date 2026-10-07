import { describe, expect, it } from "vitest";
import { parseSandboxBoard, parseSandboxRun } from "@yugidraft/shared/duels";
import {
  applyAction,
  boardCodes,
  boardReducer,
  checkBuilderState,
  createBuilderState,
  createHistory,
  getEntry,
  historyReducer,
  loadBuilderState,
  parseCardList,
  pasteList,
  pasteListAsync,
  resolveCardList,
  seatSummary,
  type CardLoc,
  type SandboxAction,
  type SandboxBuilderState,
} from "../src/components/sandbox/board-model";

const DM = 46986414;
const BEWD = 89631139;
const MIRROR = 44095762;
const RAIGEKI = 12580477;

const loc = (seat: CardLoc["seat"], zone: CardLoc["zone"], index = 0): CardLoc => ({ seat, zone, index });

/** Run actions in order. Any refusal fails the test. */
function run(state: SandboxBuilderState, ...actions: SandboxAction[]): SandboxBuilderState {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    expect(result.error, JSON.stringify(action)).toBeUndefined();
    current = result.state;
  }
  return current;
}

function refused(state: SandboxBuilderState, action: SandboxAction): string {
  const result = applyAction(state, action);
  expect(result.error, JSON.stringify(action)).toBeTruthy();
  expect(result.state).toBe(state);
  return result.error as string;
}

/** The saved form must be what the shared parser returns. */
function expectSaved(state: SandboxBuilderState) {
  expect(parseSandboxBoard(state.board)).toEqual(state.board);
  expect(parseSandboxRun(state.run)).toEqual(state.run);
  expect(checkBuilderState(state)).toEqual({ ok: true });
}

describe("board-model defaults", () => {
  it("starts as an empty 1v1 board that parses unchanged", () => {
    const state = createBuilderState();
    expect(state.board).toEqual({ format: "1v1", mode: "normal", masterRule: 5, turn: "p0", deckSize: 20, startAt: "draw" });
    expect(state.run).toEqual({ bots: { "1": "pass", "2": "pass", "3": "pass" } });
    expectSaved(state);
  });

  it("loads saved data and returns the same saved form", () => {
    const state = loadBuilderState({ p0: { hand: [{ card: DM }], monsters: [{ card: BEWD, pos: "atk" }, null, null] } });
    expect(state.board.p0).toEqual({ hand: [DM], monsters: [BEWD] });
    expectSaved(state);
  });

  it("throws the shared parser error for bad saved data", () => {
    expect(() => loadBuilderState({ p0: { hand: [0] } })).toThrow(/integer/);
  });
});

describe("place, position, summoned, materials, remove", () => {
  it("places a monster with default position as a plain number", () => {
    const state = run(createBuilderState(), { type: "place", at: loc("p0", "monster", 2), card: BEWD });
    expect(state.board.p0).toEqual({ monsters: [null, null, BEWD] });
    expectSaved(state);
  });

  it("keeps a non-default position and drops it when set back", () => {
    let state = run(createBuilderState(), { type: "place", at: loc("p0", "monster"), card: BEWD, pos: "def" });
    expect(state.board.p0?.monsters).toEqual([{ card: BEWD, pos: "def" }]);
    state = run(state, { type: "setPosition", at: loc("p0", "monster"), pos: "atk" });
    expect(state.board.p0?.monsters).toEqual([BEWD]);
    state = run(state, { type: "setPosition", at: loc("p0", "monster"), pos: "set" });
    expect(state.board.p0?.monsters).toEqual([{ card: BEWD, pos: "set" }]);
    expectSaved(state);
  });

  it("uses up/set for Spell and Trap, field and pendulum zones", () => {
    let state = run(
      createBuilderState(),
      { type: "place", at: loc("p0", "spell", 1), card: MIRROR },
      { type: "setPosition", at: loc("p0", "spell", 1), pos: "set" },
      { type: "place", at: loc("p0", "field"), card: DM },
      { type: "place", at: loc("p0", "pendulum", 1), card: BEWD },
    );
    expect(state.board.p0).toEqual({ spells: [null, { card: MIRROR, pos: "set" }], field: DM, pendulum: [null, BEWD] });
    expect(refused(state, { type: "setPosition", at: loc("p0", "spell", 1), pos: "def" })).toMatch(/position/);
    expect(refused(state, { type: "place", at: loc("p0", "monster"), card: DM, pos: "up" })).toMatch(/position/);
    state = run(state, { type: "setPosition", at: loc("p0", "spell", 1), pos: "up" });
    expect(state.board.p0?.spells).toEqual([null, MIRROR]);
    expectSaved(state);
  });

  it("puts a new card in a Spell & Trap Zone face-down, and keeps an explicit position", () => {
    let state = run(createBuilderState(), { type: "place", at: loc("p0", "spell", 0), card: MIRROR });
    expect(state.board.p0?.spells).toEqual([{ card: MIRROR, pos: "set" }]);
    state = run(state, { type: "place", at: loc("p0", "spell", 1), card: MIRROR, pos: "up" });
    expect(state.board.p0?.spells).toEqual([{ card: MIRROR, pos: "set" }, MIRROR]);
    // The saved board stays valid and the compiler reads the missing position as face-up, so Set is written out.
    expectSaved(state);
  });

  it("sets a card that arrives in a Spell & Trap Zone from a pile, and not in the Field or Pendulum Zone", () => {
    let state = run(createBuilderState(), { type: "paste", seat: "p0", codes: [MIRROR, DM, BEWD] },
      { type: "move", from: loc("p0", "hand", 0), to: loc("p0", "spell", 2) },
      { type: "move", from: loc("p0", "hand", 0), to: loc("p0", "field") },
      { type: "move", from: loc("p0", "hand", 0), to: loc("p0", "pendulum", 0) });
    expect(state.board.p0).toEqual({ spells: [null, null, { card: MIRROR, pos: "set" }], field: DM, pendulum: [BEWD, null] });
    // Within the same zone the position stays. To the Field Zone the card is face-up again, and the Field card it swaps with is Set.
    state = run(state, { type: "move", from: loc("p0", "spell", 2), to: loc("p0", "spell", 0) });
    expect(state.board.p0?.spells).toEqual([{ card: MIRROR, pos: "set" }]);
    state = run(state, { type: "move", from: loc("p0", "spell", 0), to: loc("p0", "field") });
    expect(state.board.p0?.field).toBe(MIRROR);
    expect(state.board.p0?.spells).toEqual([{ card: DM, pos: "set" }]);
    expectSaved(state);
  });

  it("tracks summoned=false only on monsters", () => {
    let state = run(createBuilderState(), { type: "place", at: loc("p0", "monster"), card: BEWD }, { type: "setSummoned", at: loc("p0", "monster"), summoned: false });
    expect(state.board.p0?.monsters).toEqual([{ card: BEWD, summoned: false }]);
    state = run(state, { type: "setSummoned", at: loc("p0", "monster"), summoned: true });
    expect(state.board.p0?.monsters).toEqual([BEWD]);
    refused(run(state, { type: "place", at: loc("p0", "spell"), card: MIRROR }), { type: "setSummoned", at: loc("p0", "spell"), summoned: false });
  });

  it("adds, removes and limits Xyz materials", () => {
    let state = run(
      createBuilderState(),
      { type: "place", at: loc("p0", "monster"), card: BEWD },
      { type: "addMaterial", at: loc("p0", "monster"), card: DM },
      { type: "addMaterial", at: loc("p0", "monster"), card: MIRROR },
    );
    expect(state.board.p0?.monsters).toEqual([{ card: BEWD, materials: [DM, MIRROR] }]);
    state = run(state, { type: "removeMaterial", at: loc("p0", "monster"), index: 0 });
    expect(state.board.p0?.monsters).toEqual([{ card: BEWD, materials: [MIRROR] }]);
    state = run(state, { type: "removeMaterial", at: loc("p0", "monster"), index: 0 });
    expect(state.board.p0?.monsters).toEqual([BEWD]);
    for (let i = 0; i < 10; i += 1) state = run(state, { type: "addMaterial", at: loc("p0", "monster"), card: DM });
    expect(refused(state, { type: "addMaterial", at: loc("p0", "monster"), card: DM })).toMatch(/at most 10/);
    expect(refused(state, { type: "removeMaterial", at: loc("p0", "monster"), index: 10 })).toMatch(/No such/);
    expectSaved(state);
  });

  it("replaces a card and removes from slots and piles", () => {
    let state = run(createBuilderState(), { type: "place", at: loc("p0", "monster"), card: BEWD }, { type: "place", at: loc("p0", "monster"), card: DM });
    expect(state.board.p0?.monsters).toEqual([DM]);
    state = run(state, { type: "remove", at: loc("p0", "monster") });
    expect(state.board.p0).toBeUndefined();
    expect(refused(state, { type: "remove", at: loc("p0", "monster") })).toMatch(/Nothing/);
    state = run(state, { type: "add", seat: "p0", card: DM }, { type: "add", seat: "p0", card: BEWD }, { type: "remove", at: loc("p0", "hand", 0) });
    expect(state.board.p0?.hand).toEqual([BEWD]);
  });

  it("rejects bad passcodes, bad seats and bad slots", () => {
    const state = createBuilderState();
    expect(refused(state, { type: "place", at: loc("p0", "monster"), card: 0 })).toMatch(/passcode/);
    expect(refused(state, { type: "place", at: loc("p0", "monster"), card: 1.5 })).toMatch(/passcode/);
    expect(refused(state, { type: "place", at: loc("p0", "monster", 7), card: DM })).toMatch(/Monster Zone/);
    expect(refused(state, { type: "place", at: loc("p0", "spell", 5), card: DM })).toMatch(/Spell/);
    expect(refused(state, { type: "place", at: loc("p2", "hand"), card: DM })).toMatch(/not a seat/);
    expect(refused(state, { type: "place", at: loc("p0", "hand"), card: DM })).toMatch(/slot/);
    expect(refused(state, { type: "place", at: loc("p0", "deckMaster"), card: DM })).toMatch(/Domain/);
  });

  it("blocks Extra Monster Zones below Master Rule 4", () => {
    const state = run(createBuilderState(), { type: "setMasterRule", masterRule: 3 });
    expect(refused(state, { type: "place", at: loc("p0", "monster", 5), card: DM })).toMatch(/Master Rule 4 or 5/);
  });
});

describe("move", () => {
  it("moves into an empty slot and swaps with a full one", () => {
    let state = run(createBuilderState(), { type: "place", at: loc("p0", "monster", 0), card: BEWD, pos: "def" }, { type: "place", at: loc("p0", "monster", 3), card: DM });
    state = run(state, { type: "move", from: loc("p0", "monster", 0), to: loc("p0", "monster", 1) });
    expect(state.board.p0?.monsters).toEqual([null, { card: BEWD, pos: "def" }, null, DM]);
    state = run(state, { type: "move", from: loc("p0", "monster", 1), to: loc("p0", "monster", 3) });
    expect(state.board.p0?.monsters).toEqual([null, DM, null, { card: BEWD, pos: "def" }]);
    expectSaved(state);
  });

  it("moves between seats", () => {
    const state = run(createBuilderState(), { type: "place", at: loc("p0", "monster"), card: BEWD }, { type: "move", from: loc("p0", "monster"), to: loc("p1", "monster", 4) });
    expect(state.board.p0).toBeUndefined();
    expect(state.board.p1?.monsters).toEqual([null, null, null, null, BEWD]);
  });

  it("refuses monster zone to Spell and Trap zone", () => {
    const state = run(createBuilderState(), { type: "place", at: loc("p0", "monster"), card: BEWD });
    expect(refused(state, { type: "move", from: loc("p0", "monster"), to: loc("p0", "spell") })).toMatch(/cannot move/);
  });

  it("moves between Spell and Trap, field and pendulum zones", () => {
    const state = run(createBuilderState(), { type: "place", at: loc("p0", "spell"), card: MIRROR }, { type: "move", from: loc("p0", "spell"), to: loc("p0", "field") });
    expect(state.board.p0).toEqual({ field: MIRROR });
  });

  it("hand to slot, slot to grave, pile to pile; slot data stays behind", () => {
    let state = run(createBuilderState(), { type: "add", seat: "p0", card: BEWD }, { type: "add", seat: "p0", card: DM });
    state = run(state, { type: "move", from: loc("p0", "hand", 1), to: loc("p0", "monster", 0) });
    expect(state.board.p0).toEqual({ hand: [BEWD], monsters: [DM] });
    state = run(state, { type: "setPosition", at: loc("p0", "monster"), pos: "def" }, { type: "addMaterial", at: loc("p0", "monster"), card: MIRROR });
    state = run(state, { type: "move", from: loc("p0", "monster"), to: loc("p0", "grave", 0) });
    expect(state.board.p0).toEqual({ hand: [BEWD], grave: [DM] });
    state = run(state, { type: "move", from: loc("p0", "hand", 0), to: loc("p1", "banished", 0) });
    expect(state.board.p0).toEqual({ grave: [DM] });
    expect(state.board.p1).toEqual({ banished: [BEWD] });
    expectSaved(state);
  });

  it("hand to a full slot puts the displaced card back in the hand", () => {
    const state = run(
      createBuilderState(),
      { type: "place", at: loc("p0", "monster"), card: DM },
      { type: "add", seat: "p0", card: BEWD },
      { type: "move", from: loc("p0", "hand", 0), to: loc("p0", "monster") },
    );
    expect(state.board.p0).toEqual({ hand: [DM], monsters: [BEWD] });
  });

  it("reorders the Deck top inside the pile", () => {
    let state = run(createBuilderState(), { type: "paste", seat: "p0", zone: "deck", codes: [1, 2, 3, 4] });
    state = run(state, { type: "move", from: loc("p0", "deck", 3), to: loc("p0", "deck", 0) });
    expect(state.board.p0?.deck).toEqual([4, 1, 2, 3]);
    state = run(state, { type: "move", from: loc("p0", "deck", 0), to: loc("p0", "deck", 99) });
    expect(state.board.p0?.deck).toEqual([1, 2, 3, 4]);
  });

  it("refuses a full target pile and a missing source", () => {
    let state = run(createBuilderState(), { type: "paste", seat: "p0", zone: "hand", codes: Array.from({ length: 20 }, (_, i) => i + 1) }, { type: "add", seat: "p0", zone: "grave", card: DM });
    expect(refused(state, { type: "move", from: loc("p0", "grave", 0), to: loc("p0", "hand", 0) })).toMatch(/Hand is full/);
    expect(refused(state, { type: "move", from: loc("p0", "grave", 5), to: loc("p0", "banished", 0) })).toMatch(/Nothing/);
    state = run(state, { type: "move", from: loc("p0", "grave", 0), to: loc("p0", "grave", 0) });
  });

  it("Deck Master takes a card from a pile and goes back to a pile", () => {
    let state = run(createBuilderState(), { type: "setMode", mode: "domain" }, { type: "add", seat: "p0", zone: "extra", card: DM });
    state = run(state, { type: "move", from: loc("p0", "extra", 0), to: loc("p0", "deckMaster") });
    expect(state.board.p0).toEqual({ deckMaster: DM });
    expect(refused(state, { type: "move", from: loc("p0", "deckMaster"), to: loc("p0", "monster") })).toMatch(/cannot move/);
    state = run(state, { type: "move", from: loc("p0", "deckMaster"), to: loc("p0", "hand", 0) });
    expect(state.board.p0).toEqual({ hand: [DM] });
  });
});

describe("quick add", () => {
  it("appends to the hand by default and to other piles on request", () => {
    const state = run(
      createBuilderState(),
      { type: "add", seat: "p0", card: DM },
      { type: "add", seat: "p0", card: DM },
      { type: "add", seat: "p1", zone: "grave", card: BEWD },
      { type: "add", seat: "p1", zone: "extra", card: MIRROR },
      { type: "add", seat: "p1", zone: "banished", card: RAIGEKI },
    );
    expect(state.board.p0).toEqual({ hand: [DM, DM] });
    expect(state.board.p1).toEqual({ grave: [BEWD], banished: [RAIGEKI], extra: [MIRROR] });
    expectSaved(state);
  });

  it("reports added count and refuses a full pile", () => {
    let state = createBuilderState();
    for (let i = 1; i <= 20; i += 1) {
      const result = applyAction(state, { type: "add", seat: "p0", card: i });
      expect(result.added).toBe(1);
      state = result.state;
    }
    expect(refused(state, { type: "add", seat: "p0", card: 21 })).toMatch(/Hand is full \(20\)/);
  });

  it("raises the deck size when the Deck top grows past it, but not past 60", () => {
    let state = run(createBuilderState(), { type: "paste", seat: "p0", zone: "deck", codes: Array.from({ length: 25 }, (_, i) => i + 1) });
    expect(state.board.deckSize).toBe(25);
    expectSaved(state);
    state = run(state, { type: "paste", seat: "p0", zone: "deck", codes: Array.from({ length: 70 }, (_, i) => i + 1), mode: "replace" });
    expect(state.board.deckSize).toBe(60);
    expect(state.board.p0?.deck).toHaveLength(60);
    expectSaved(state);
  });

  it("refuses a deck size under the Deck top", () => {
    const state = run(createBuilderState(), { type: "paste", seat: "p0", zone: "deck", codes: [1, 2, 3, 4, 5] });
    expect(refused(state, { type: "setDeckSize", deckSize: 3 })).toMatch(/Deck top \(5\)/);
    expect(run(state, { type: "setDeckSize", deckSize: 30 }).board.deckSize).toBe(30);
  });
});

describe("parseCardList", () => {
  it("reads passcodes, names, counts and skips blanks and comments", () => {
    const text = ["#main", "  ", "89631139", "3x Dark Magician", "Blue-Eyes White Dragon x2", "2 × Mirror Force", "!side", "// note", "", "Nibiru, the Primal Being"].join("\r\n");
    expect(parseCardList(text)).toEqual([
      { line: 3, count: 1, passcode: 89631139 },
      { line: 4, count: 3, name: "Dark Magician" },
      { line: 5, count: 2, name: "Blue-Eyes White Dragon" },
      { line: 6, count: 2, name: "Mirror Force" },
      { line: 10, count: 1, name: "Nibiru, the Primal Being" },
    ]);
  });

  it("keeps a count with a passcode and treats zero and huge numbers as names", () => {
    expect(parseCardList("2x 0046986414")).toEqual([{ line: 1, count: 2, passcode: 46986414 }]);
    expect(parseCardList("99999999999")).toEqual([{ line: 1, count: 1, name: "99999999999" }]);
    expect(parseCardList("0x Foo")[0]).toEqual({ line: 1, count: 1, name: "0x Foo" });
    expect(parseCardList("3xyz Dragon")[0]).toEqual({ line: 1, count: 1, name: "3xyz Dragon" });
    expect(parseCardList("﻿123")).toEqual([{ line: 1, count: 1, passcode: 123 }]);
  });
});

describe("paste", () => {
  const catalog: Record<string, number> = { "dark magician": DM, "blue-eyes white dragon": BEWD, "mirror force": MIRROR };
  const resolve = (name: string) => catalog[name.toLowerCase()];

  it("resolves names and passcodes; passcodes skip the resolver", () => {
    const calls: string[] = [];
    const result = resolveCardList("Dark Magician\n12580477\nDARK  magician\nUnknown Card\n2x Mirror Force", (name) => {
      calls.push(name);
      return resolve(name.replace(/\s+/g, " "));
    });
    expect(result.codes).toEqual([DM, RAIGEKI, DM, MIRROR, MIRROR]);
    expect(result.unresolved).toEqual([{ line: 4, text: "Unknown Card" }]);
    // "Dark Magician" and "DARK  magician" share one lookup.
    expect(calls).toEqual(["Dark Magician", "Unknown Card", "Mirror Force"]);
  });

  it("fills a hand from a list in one step and lists unknown cards", () => {
    const result = pasteList(createBuilderState(), { seat: "p0", text: "5x Dark Magician\nBlue-Eyes White Dragon\nNope\n", resolve });
    expect(result.error).toBeUndefined();
    expect(result.added).toBe(6);
    expect(result.overflow).toBe(0);
    expect(result.unresolved).toEqual([{ line: 3, text: "Nope" }]);
    expect(result.state.board.p0?.hand).toEqual([DM, DM, DM, DM, DM, BEWD]);
    expectSaved(result.state);
  });

  it("appends by default and replaces on request", () => {
    const base = run(createBuilderState(), { type: "add", seat: "p0", zone: "grave", card: RAIGEKI });
    const appended = pasteList(base, { seat: "p0", zone: "grave", text: "Dark Magician", resolve });
    expect(appended.state.board.p0?.grave).toEqual([RAIGEKI, DM]);
    const replaced = pasteList(base, { seat: "p0", zone: "grave", text: "Dark Magician", resolve, mode: "replace" });
    expect(replaced.state.board.p0?.grave).toEqual([DM]);
  });

  it("stores up to the pile limit and counts the rest as overflow", () => {
    const base = run(createBuilderState(), { type: "paste", seat: "p0", codes: Array.from({ length: 18 }, (_, i) => i + 1) });
    const result = pasteList(base, { seat: "p0", text: "5x Dark Magician", resolve });
    expect(result.added).toBe(2);
    expect(result.overflow).toBe(3);
    expect(result.state.board.p0?.hand).toHaveLength(20);
    expectSaved(result.state);
  });

  it("keeps the state when nothing resolves", () => {
    const state = createBuilderState();
    const result = pasteList(state, { seat: "p0", text: "Nope\n\n", resolve });
    expect(result.state).toBe(state);
    expect(result.added).toBe(0);
    expect(result.unresolved).toHaveLength(1);
  });

  it("works as quick add from a typed name", () => {
    const result = pasteList(createBuilderState(), { seat: "p1", zone: "deck", text: "Mirror Force", resolve });
    expect(result.state.board.p1?.deck).toEqual([MIRROR]);
  });

  it("refuses a seat outside the format", () => {
    const result = pasteList(createBuilderState(), { seat: "p3", text: "Dark Magician", resolve });
    expect(result.error).toMatch(/not a seat/);
  });

  it("supports a server resolver and survives a failing lookup", async () => {
    const result = await pasteListAsync(createBuilderState(), {
      seat: "p0",
      text: "Dark Magician\nBoom\n3x Mirror Force",
      resolve: async (name) => {
        if (name === "Boom") throw new Error("network");
        return resolve(name);
      },
    });
    expect(result.state.board.p0?.hand).toEqual([DM, MIRROR, MIRROR, MIRROR]);
    expect(result.unresolved).toEqual([{ line: 2, text: "Boom" }]);
  });
});

describe("fast clear", () => {
  const filled = () =>
    run(
      createBuilderState("ffa3"),
      { type: "setLp", seat: "p1", lp: 4000 },
      { type: "place", at: loc("p0", "monster"), card: BEWD },
      { type: "place", at: loc("p0", "monster", 1), card: DM },
      { type: "place", at: loc("p0", "spell"), card: MIRROR },
      { type: "paste", seat: "p0", codes: [1, 2, 3] },
      { type: "paste", seat: "p1", zone: "grave", codes: [4, 5] },
      { type: "setBotMode", seat: 1, mode: "manual" },
    );

  it("clears one zone, field zones included", () => {
    let state = run(filled(), { type: "clearZone", seat: "p0", zone: "hand" });
    expect(state.board.p0).toEqual({ monsters: [BEWD, DM], spells: [{ card: MIRROR, pos: "set" }] });
    state = run(state, { type: "clearZone", seat: "p0", zone: "monster" });
    expect(state.board.p0).toEqual({ spells: [{ card: MIRROR, pos: "set" }] });
    expectSaved(state);
  });

  it("clears one seat and keeps its LP", () => {
    const state = run(filled(), { type: "clearSeat", seat: "p1" }, { type: "setLp", seat: "p1", lp: 1234 }, { type: "clearSeat", seat: "p1" });
    expect(state.board.p1).toEqual({ lp: 1234 });
    expect(state.board.p0).toBeDefined();
  });

  it("clears the board and keeps LP, settings and bot modes", () => {
    const state = run(filled(), { type: "clearBoard" });
    expect(state.board).toEqual({ format: "ffa3", mode: "normal", masterRule: 5, turn: "p0", deckSize: 20, startAt: "draw", p1: { lp: 4000 } });
    expect(state.run.bots["1"]).toBe("manual");
    expectSaved(state);
  });

  it("undo brings a clear back", () => {
    let history = createHistory(filled());
    const before = history.present;
    history = historyReducer(history, { type: "clearBoard" });
    expect(history.present.board.p0).toBeUndefined();
    history = historyReducer(history, { type: "undo" });
    expect(history.present).toEqual(before);
    history = historyReducer(history, { type: "redo" });
    expect(history.present.board.p0).toBeUndefined();
  });
});

describe("board settings", () => {
  it("sets and resets LP and keeps the default out of the saved board", () => {
    let state = run(createBuilderState(), { type: "setLp", seat: "p0", lp: 100 });
    expect(state.board.p0).toEqual({ lp: 100 });
    state = run(state, { type: "setLp", seat: "p0", lp: 8000 });
    expect(state.board.p0).toBeUndefined();
    state = run(state, { type: "setLp", seat: "p1", lp: 1 }, { type: "setLp", seat: "p1", lp: null });
    expect(state.board.p1).toBeUndefined();
    expect(refused(state, { type: "setLp", seat: "p0", lp: 0 })).toMatch(/LP/);
    expect(refused(state, { type: "setLp", seat: "p0", lp: 1_000_000 })).toMatch(/LP/);
    expect(refused(state, { type: "setLp", seat: "p0", lp: 10.5 })).toMatch(/LP/);
  });

  it("format change trims seats beyond the format and fixes the turn player", () => {
    let state = run(
      createBuilderState("ffa4"),
      { type: "place", at: loc("p3", "monster"), card: BEWD },
      { type: "place", at: loc("p1", "monster"), card: DM },
      { type: "setTurn", turn: "p3" },
    );
    state = run(state, { type: "setFormat", format: "ffa3" });
    expect(state.board.p3).toBeUndefined();
    expect(state.board.p1).toEqual({ monsters: [DM] });
    expect(state.board.turn).toBe("p0");
    state = run(state, { type: "setFormat", format: "1v1" });
    expect(state.board.p2).toBeUndefined();
    expect(state.board.format).toBe("1v1");
    expectSaved(state);
    // Going back up does not bring the cards back; the seats start empty.
    state = run(state, { type: "setFormat", format: "ffa4" });
    expect(state.board.p3).toBeUndefined();
    expect(refused(state, { type: "setFormat", format: "5v5" as never })).toMatch(/format/);
  });

  it("Tag keeps LP on P0 and P1 only", () => {
    let state = run(createBuilderState("ffa4"), { type: "setLp", seat: "p2", lp: 5000 }, { type: "setLp", seat: "p0", lp: 6000 });
    state = run(state, { type: "setFormat", format: "tag" });
    expect(state.board.p2).toBeUndefined();
    expect(state.board.p0).toEqual({ lp: 6000 });
    expect(refused(state, { type: "setLp", seat: "p3", lp: 5000 })).toMatch(/team LP/);
    expectSaved(state);
  });

  it("turn player must be a seat", () => {
    const state = createBuilderState();
    expect(refused(state, { type: "setTurn", turn: "p2" })).toMatch(/not a seat/);
    expect(run(state, { type: "setTurn", turn: "p1" }).board.turn).toBe("p1");
  });

  it("Master Rule below 4 trims Extra Monster Zone cards", () => {
    let state = run(createBuilderState(), { type: "place", at: loc("p0", "monster", 5), card: BEWD }, { type: "place", at: loc("p0", "monster", 1), card: DM });
    expect(state.board.p0?.monsters).toHaveLength(6);
    state = run(state, { type: "setMasterRule", masterRule: 3 });
    expect(state.board.p0?.monsters).toEqual([null, DM]);
    expectSaved(state);
    expect(refused(state, { type: "setMasterRule", masterRule: 6 as never })).toMatch(/Master Rule/);
  });

  it("Domain mode needs a Deck Master per seat; leaving Domain drops them", () => {
    let state = run(createBuilderState(), { type: "setMode", mode: "domain" });
    expect(checkBuilderState(state)).toEqual({ ok: false, error: { path: "p0.deckMaster", message: expect.stringMatching(/Deck Master/) } });
    state = run(state, { type: "place", at: loc("p0", "deckMaster"), card: DM }, { type: "place", at: loc("p1", "deckMaster"), card: BEWD });
    expect(state.board.p0).toEqual({ deckMaster: DM });
    expectSaved(state);
    state = run(state, { type: "setMode", mode: "normal" });
    expect(state.board.p0).toBeUndefined();
    expectSaved(state);
  });

  it("attack-first-turn, bot modes and seed", () => {
    let state = run(createBuilderState(), { type: "setAttackFirstTurn", value: true }, { type: "setBotMode", seat: 2, mode: "practice" }, { type: "setSeed", seed: ["1", "2", "3", "4"] });
    expect(state.board.attackFirstTurn).toBe(true);
    expect(state.run).toEqual({ bots: { "1": "pass", "2": "practice", "3": "pass" }, seed: ["1", "2", "3", "4"] });
    expectSaved(state);
    state = run(state, { type: "setAttackFirstTurn", value: false }, { type: "setSeed", seed: null });
    expect(state.board.attackFirstTurn).toBeUndefined();
    expect(state.run.seed).toBeUndefined();
    expect(refused(state, { type: "setBotMode", seat: 0 as never, mode: "pass" })).toMatch(/Seat 0/);
    expect(refused(state, { type: "setBotMode", seat: 1, mode: "bad" as never })).toMatch(/bot mode/);
  });

  it("deck size range", () => {
    const state = createBuilderState();
    expect(run(state, { type: "setDeckSize", deckSize: 0 }).board.deckSize).toBe(0);
    expect(refused(state, { type: "setDeckSize", deckSize: 61 })).toMatch(/0 to 60/);
    expect(refused(state, { type: "setDeckSize", deckSize: -1 })).toMatch(/0 to 60/);
  });
});

describe("read helpers", () => {
  it("summarises a seat", () => {
    const state = run(
      createBuilderState(),
      { type: "place", at: loc("p0", "monster"), card: BEWD },
      { type: "place", at: loc("p0", "spell", 2), card: MIRROR },
      { type: "place", at: loc("p0", "field"), card: DM },
      { type: "paste", seat: "p0", codes: [1, 2] },
      { type: "paste", seat: "p0", zone: "grave", codes: [3] },
      { type: "paste", seat: "p0", zone: "deck", codes: [4, 5, 6, 7] },
      { type: "paste", seat: "p0", zone: "extra", codes: [8] },
      { type: "setLp", seat: "p0", lp: 500 },
    );
    expect(seatSummary(state, "p0")).toEqual({ lp: 500, hand: 2, field: 3, grave: 1, banished: 0, deckTop: 4, extra: 1 });
    expect(seatSummary(state, "p1").lp).toBe(8000);
  });

  it("lists every distinct passcode, materials included", () => {
    const state = run(
      createBuilderState(),
      { type: "place", at: loc("p0", "monster"), card: BEWD },
      { type: "addMaterial", at: loc("p0", "monster"), card: DM },
      { type: "add", seat: "p1", card: DM },
      { type: "add", seat: "p1", zone: "grave", card: MIRROR },
    );
    expect(boardCodes(state)).toEqual([BEWD, DM, MIRROR]);
  });

  it("reads one place", () => {
    const state = run(createBuilderState(), { type: "place", at: loc("p0", "monster", 1), card: BEWD, pos: "def" });
    expect(getEntry(state, loc("p0", "monster", 1))).toEqual({ card: BEWD, pos: "def" });
    expect(getEntry(state, loc("p0", "monster", 0))).toBeNull();
    expect(getEntry(state, loc("p3", "hand", 0))).toBeNull();
  });
});

describe("reducers", () => {
  it("does not change the input state", () => {
    const state = createBuilderState();
    const frozen = JSON.stringify(state);
    run(state, { type: "place", at: loc("p0", "monster"), card: BEWD }, { type: "clearBoard" });
    expect(JSON.stringify(state)).toBe(frozen);
  });

  it("boardReducer keeps the state on a refused action", () => {
    const state = createBuilderState();
    expect(boardReducer(state, { type: "place", at: loc("p0", "monster"), card: -1 })).toBe(state);
    expect(boardReducer(state, { type: "add", seat: "p0", card: DM }).board.p0).toEqual({ hand: [DM] });
  });

  it("history skips refused and no-op actions and caps its size", () => {
    let history = createHistory(createBuilderState());
    history = historyReducer(history, { type: "place", at: loc("p0", "monster"), card: -1 });
    history = historyReducer(history, { type: "setLp", seat: "p0", lp: null });
    expect(history.past).toHaveLength(0);
    history = historyReducer(history, { type: "undo" });
    expect(history.past).toHaveLength(0);
    for (let i = 1; i <= 70; i += 1) history = historyReducer(history, { type: "setLp", seat: "p0", lp: i + 1 });
    expect(history.past).toHaveLength(50);
    history = historyReducer(history, { type: "undo" });
    history = historyReducer(history, { type: "add", seat: "p0", card: DM });
    expect(history.future).toHaveLength(0);
    history = historyReducer(history, { type: "load", state: createBuilderState("tag") });
    expect(history.past).toHaveLength(0);
    expect(history.present.board.format).toBe("tag");
  });
});
