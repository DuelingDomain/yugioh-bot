import { describe, expect, it } from "vitest";
import {
  SANDBOX_LIMITS,
  SandboxBoardError,
  parseSandboxBoard,
  parseSandboxRun,
  type SandboxBoard,
  type SandboxDuelistSetup,
} from "../src/duels/index.js";

const code = 89631139;
const cards = (count: number) => Array<number>(count).fill(code);
const bots = { "1": "pass", "2": "practice", "3": "manual" } as const;

function rejects(value: unknown, path: string, parser: (value: unknown) => unknown = parseSandboxBoard) {
  let error: unknown;
  try { parser(value); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(SandboxBoardError);
  expect(error).toMatchObject({ name: "SandboxBoardError", path });
  expect((error as Error).message.length).toBeGreaterThan(0);
}

describe("sandbox board contract", () => {
  it("exports the parsers and immutable limits from the public duels entry", () => {
    expect(parseSandboxBoard).toBeTypeOf("function");
    expect(parseSandboxRun).toBeTypeOf("function");
    expect(SANDBOX_LIMITS).toMatchObject({ boardBytes: 32768, runBytes: 1024 });
    expect(Object.isFrozen(SANDBOX_LIMITS)).toBe(true);
  });

  it("defaults an empty board to a normal Draw Phase start and filler deck", () => {
    expect(parseSandboxBoard({})).toEqual({
      format: "1v1", mode: "normal", masterRule: 5, turn: "p0", deckSize: 20, startAt: "draw",
    });
  });

  it("copies numeric BoardSpec fields without changing card order or gaps", () => {
    const input: SandboxBoard = {
      format: "ffa4", mode: "domain", masterRule: 4, turn: "p3", deckSize: 60,
      startAt: "draw", skipOpeningDraw: false, attackFirstTurn: true,
      p0: {
        lp: 999999, hand: [code, { card: code, pos: "set" }],
        monsters: [null, { card: code, pos: "def", materials: [1, 2], summoned: false }, null, null, null, code, code],
        spells: [{ card: code, pos: "up" }, null], field: { card: code, pos: "set" },
        pendulum: [null, code], grave: [1, 2], banished: [3], deck: [3, 2, 1], extra: [code], deckMaster: code,
      },
      p1: { deckMaster: code }, p2: { deckMaster: code }, p3: { deckMaster: code },
    };
    const result = parseSandboxBoard(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.p0).not.toBe(input.p0);
    expect(result.p0!.monsters![1]).not.toBe(input.p0!.monsters![1]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it.each(["1v1", "ffa3", "ffa4", "tag"] as const)("accepts every seat and turn in %s", (format) => {
    const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
    for (let seat = 0; seat < count; seat++) {
      const id = `p${seat}`;
      expect(parseSandboxBoard({ format, turn: id, [id]: {} }).turn).toBe(id);
    }
  });

  it.each([
    [{ p2: {} }, "p2"], [{ p3: {} }, "p3"], [{ format: "ffa3", p3: {} }, "p3"],
    [{ turn: "p2" }, "turn"], [{ format: "ffa3", turn: "p3" }, "turn"],
    [{ format: "tag", p2: { lp: 8000 } }, "p2.lp"], [{ format: "tag", p3: { lp: 8000 } }, "p3.lp"],
    [{ mode: "domain" }, "p0.deckMaster"], [{ mode: "domain", p0: { deckMaster: code } }, "p1.deckMaster"],
    [{ mode: "domain", format: "ffa3", p0: { deckMaster: code }, p1: { deckMaster: code } }, "p2.deckMaster"],
    [{ p0: { deckMaster: code } }, "p0.deckMaster"],
  ])("rejects invalid seat and mode combinations: %j", (value, path) => rejects(value, path as string));

  it("accepts team LP on tag seats p0 and p1 only", () => {
    expect(parseSandboxBoard({ format: "tag", p0: { lp: 1 }, p1: { lp: 8000 } }).p1!.lp).toBe(8000);
  });

  it.each([1, 2, 3])("rejects occupied EMZ under Master Rule %i", (masterRule) => {
    for (const index of [5, 6]) {
      rejects({ masterRule, p0: { monsters: [...Array(index).fill(null), code] } }, `p0.monsters[${index}]`);
    }
    expect(parseSandboxBoard({ masterRule, p0: { monsters: Array(7).fill(null) } }).masterRule).toBe(masterRule);
  });

  it("pads short pendulum rows to a BoardSpec-compatible tuple", () => {
    expect(parseSandboxBoard({ p0: { pendulum: [] } }).p0!.pendulum).toEqual([null, null]);
    expect(parseSandboxBoard({ p0: { pendulum: [code] } }).p0!.pendulum).toEqual([code, null]);
  });

  it.each([
    ["hand", 20], ["monsters", 7], ["spells", 5], ["pendulum", 2],
    ["grave", 60], ["banished", 60], ["deck", 60], ["extra", 30],
  ] as const)("enforces the %s limit of %i", (zone, max) => {
    expect(parseSandboxBoard({ deckSize: 60, p0: { [zone]: cards(max) } }).p0![zone]).toHaveLength(max);
    rejects({ deckSize: 60, p0: { [zone]: cards(max + 1) } }, `p0.${zone}`);
    rejects({ p0: { [zone]: {} } }, `p0.${zone}`);
  });

  it("limits materials on each card", () => {
    expect(parseSandboxBoard({ p0: { monsters: [{ card: code, materials: cards(10) }] } }).p0!.monsters).toHaveLength(1);
    rejects({ p0: { monsters: [{ card: code, materials: cards(11) }] } }, "p0.monsters[0].materials");
  });

  it("checks deck top against the explicit or default deck size for every seat", () => {
    expect(parseSandboxBoard({ deckSize: 0, p0: { deck: [] } }).deckSize).toBe(0);
    rejects({ p0: { deck: cards(21) } }, "p0.deck");
    rejects({ deckSize: 1, p1: { deck: cards(2) } }, "p1.deck");
    rejects({ format: "ffa4", deckSize: 0, p3: { deck: [code] } }, "p3.deck");
  });

  it.each([0, -1, 1.5, 1000000, NaN, Infinity, "8000", null])("rejects invalid LP %j", (lp) => {
    rejects({ p0: { lp } }, "p0.lp");
  });
  it.each([-1, 61, 1.5, NaN, Infinity, "20", null])("rejects invalid deck size %j", (deckSize) => {
    rejects({ deckSize }, "deckSize");
  });
  it.each([0, -1, 1.5, 0x100000000, NaN, Infinity, "89631139", "Blue-Eyes White Dragon", null, true])(
    "rejects non-passcode card values %j", (card) => {
      rejects({ p0: { hand: [card] } }, "p0.hand[0]");
      rejects({ p0: { monsters: [{ card }] } }, "p0.monsters[0].card");
      rejects({ p0: { monsters: [{ card: code, materials: [card] }] } }, "p0.monsters[0].materials[0]");
      rejects({ p0: { grave: [card] } }, "p0.grave[0]");
    },
  );

  it.each([
    [null, "$"], [[], "$"], ["{}", "$"], [undefined, "$"], [new Date(), "$"],
    [{ format: "other" }, "format"], [{ mode: "other" }, "mode"], [{ masterRule: 6 }, "masterRule"],
    [{ masterRule: "5" }, "masterRule"], [{ turn: 0 }, "turn"], [{ p0: null }, "p0"],
    [{ p0: { hand: [null] } }, "p0.hand[0]"], [{ p0: { field: null } }, "p0.field"],
    [{ p0: { extra: [{ card: code }] } }, "p0.extra[0]"],
    [{ p0: { hand: [{}] } }, "p0.hand[0].card"],
    [{ p0: { hand: [{ card: code, pos: "bad" }] } }, "p0.hand[0].pos"],
    [{ p0: { monsters: [{ card: code, summoned: "yes" }] } }, "p0.monsters[0].summoned"],
    [{ p0: { monsters: [{ card: code, materials: null }] } }, "p0.monsters[0].materials"],
    [{ attackFirstTurn: 1 }, "attackFirstTurn"], [{ startAt: "other" }, "startAt"],
    [{ startAt: "battle" }, "startAt"], [{ skipOpeningDraw: true }, "skipOpeningDraw"],
    [{ skipOpeningDraw: "false" }, "skipOpeningDraw"], [{ startAt: undefined }, "startAt"],
    [{ teams: [] }, "teams"], [{ withoutCoreFunctions: [] }, "withoutCoreFunctions"],
    [{ script: "Duel.Win(0,0)" }, "script"], [{ p4: {} }, "p4"],
    [{ p0: { deckSize: 30 } }, "p0.deckSize"],
    [{ p0: { monsters: [{ card: code, counters: [] }] } }, "p0.monsters[0].counters"],
  ])("rejects malformed or unsupported data: %j", (value, path) => rejects(value, path as string));

  it("rejects sparse arrays and non-JSON objects", () => {
    rejects({ p0: { hand: Array(1) } }, "p0.hand[0]");
    rejects({ p0: Object.create({ hand: [code] }) }, "p0");
    rejects(JSON.parse('{"__proto__": {"polluted": true}}'), "__proto__");
  });

  it("checks the serialized board byte limit", () => {
    const entry = { card: 0xffffffff, pos: "set" as const, materials: Array(10).fill(0xffffffff), summoned: false };
    const seat: SandboxDuelistSetup = {
      hand: Array(20).fill(entry), monsters: Array(7).fill(entry), spells: Array(5).fill(entry),
      pendulum: [entry, entry], field: entry,
      grave: Array(60).fill(0xffffffff), banished: Array(60).fill(0xffffffff),
      deck: Array(60).fill(0xffffffff), extra: Array(30).fill(0xffffffff),
    };
    const value = { format: "ffa4", deckSize: 60, p0: seat, p1: seat, p2: seat, p3: seat };
    expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeGreaterThan(32768);
    rejects(value, "$");
  });
});

describe("sandbox run contract", () => {
  it("copies all bot modes and an optional engine-compatible seed", () => {
    const input = { bots, seed: ["1", "2", "3", "18446744073709551615"] };
    expect(parseSandboxRun(input)).toEqual(input);
    expect(parseSandboxRun(input).bots).not.toBe(bots);
    expect(parseSandboxRun({ bots })).toEqual({ bots });
  });

  it.each([
    [null, "$"], [{}, "bots"], [{ bots: {} }, "bots.1"],
    [{ bots: { ...bots, "0": "manual" } }, "bots.0"],
    [{ bots: { ...bots, "1": "random" } }, "bots.1"],
    [{ bots, extra: true }, "extra"], [{ bots, seed: ["1", "2", "3"] }, "seed"],
    [{ bots, seed: [1, "2", "3", "4"] }, "seed[0]"],
    [{ bots, seed: ["0", "2", "3", "4"] }, "seed[0]"],
    [{ bots, seed: ["-1", "2", "3", "4"] }, "seed[0]"],
    [{ bots, seed: ["1.2", "2", "3", "4"] }, "seed[0]"],
    [{ bots, seed: ["0xff", "2", "3", "4"] }, "seed[0]"],
    [{ bots, seed: ["18446744073709551616", "2", "3", "4"] }, "seed[0]"],
  ])("rejects invalid run data: %j", (value, path) => {
    rejects(value, path as string, parseSandboxRun);
  });

  it("enforces the run byte limit", () => {
    rejects({ bots, seed: ["0".repeat(1024) + "1", "2", "3", "4"] }, "$", parseSandboxRun);
  });
});
