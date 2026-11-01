import { describe, expect, it, vi } from "vitest";
import * as shared from "../src/duels/index.js";

const bots = { "1": "pass", "2": "practice", "3": "manual" } as const;
const value = { board: {}, run: { bots } };
const raw = (value: unknown) => "DKSB1:" + Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

// Namespace lookup lets the first run expose missing public exports as test failures.
const encode = (value: unknown) => shared.encodeSandboxShare(value as shared.SandboxShare);
const decode = (code: string) => shared.decodeSandboxShare(code);

function rejects(code: string, path?: string) {
  expect(() => decode(code)).toThrow(shared.SandboxBoardError);
  if (path) {
    try { decode(code); } catch (error) { expect(error).toMatchObject({ path }); }
  }
}

describe("sandbox share code", () => {
  it("exports the version and length limit", () => {
    expect(shared).toHaveProperty("SANDBOX_SHARE_PREFIX", "DKSB1:");
    expect(shared).toHaveProperty("SANDBOX_SHARE_MAX_LENGTH", 49152);
  });

  it("round trips board defaults and bot modes", () => {
    const code = encode(value);
    expect(code).toMatch(/^DKSB1:[A-Za-z0-9_-]+$/);
    expect(decode(code)).toEqual({ board: shared.parseSandboxBoard({}), run: { bots } });
    expect(encode(decode(code))).toBe(code);
  });

  it("preserves phase, elimination, positions, materials, deck order, seed and Unicode name", () => {
    const scenario = {
      name: "  Duelists Kingdom — 青眼 🐉  ",
      board: {
        format: "ffa4", startAt: "main2", turn: "p1", eliminated: ["p2"], p2: { lp: 0 },
        p0: { deck: [3, 2, 1], monsters: [null, { card: 89631139, pos: "set", materials: [1, 2], summoned: true }] },
      },
      run: { bots, seed: ["1", "2", "3", "18446744073709551615"] },
    };
    expect(decode(encode(scenario))).toEqual({
      name: scenario.name.trim(), board: shared.parseSandboxBoard(scenario.board), run: shared.parseSandboxRun(scenario.run),
    });
  });

  it("uses the same UTF-8 plain JSON wire format without Node Buffer", () => {
    const scenario = { ...value, name: "青眼 🐉" };
    const expected = raw({ name: scenario.name, board: shared.parseSandboxBoard({}), run: scenario.run });
    vi.stubGlobal("Buffer", undefined);
    try {
      const code = encode(scenario);
      expect(code).toBe(expected);
      expect(decode(code).name).toBe(scenario.name);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(["", "DKSB2:e30", "dksb1:e30", "e30", " DKSB1:e30", "DKSB1:", "DKSB1:%%%", "DKSB1:e30=", "DKSB1:+/8", "DKSB1:A", "DKSB1:e31"])(
    "rejects a bad prefix or noncanonical base64url: %s", (code) => rejects(code, "share"),
  );

  it("rejects an oversized code before decoding", () => {
    rejects("DKSB1:" + "A".repeat(49152), "share");
  });

  it("rejects invalid UTF-8 and malformed JSON", () => {
    rejects("DKSB1:" + Buffer.from([0xff, 0xfe]).toString("base64url"), "share");
    rejects("DKSB1:" + Buffer.from('{"board":').toString("base64url"), "share");
  });

  it.each([null, [], {}, { board: {} }, { run: { bots } }, { ...value, owner: 42 }])(
    "rejects an invalid envelope: %j", (input) => {
      rejects(raw(input));
      expect(() => encode(input)).toThrow(shared.SandboxBoardError);
    },
  );

  it.each([null, 42, "", "   ", "n".repeat(81)])("rejects an invalid name: %j", (name) => {
    rejects(raw({ ...value, name }), "name");
    expect(() => encode({ ...value, name })).toThrow(shared.SandboxBoardError);
  });

  it("accepts a name of exactly 80 characters", () => {
    expect(decode(encode({ ...value, name: "n".repeat(80) })).name).toHaveLength(80);
  });

  it.each([
    [{ ...value, board: { withoutCoreFunctions: ["Draw"] } }, "withoutCoreFunctions"],
    [{ ...value, board: { p0: { hand: ["Duel.Win(0,0)"] } } }, "p0.hand[0]"],
    [{ ...value, board: { startAt: "battle" } }, "startAt"],
    [{ ...value, board: { format: "ffa3", eliminated: ["p1", "p2"] } }, "eliminated"],
    [{ ...value, run: { bots: { ...bots, "1": "bad" } } }, "bots.1"],
    [{ ...value, run: { bots, seed: ["0", "2", "3", "4"] } }, "seed[0]"],
  ])("validates tampered JSON with the existing parsers: %j", (input, path) => {
    rejects(raw(input), path as string);
    expect(() => encode(input)).toThrow(shared.SandboxBoardError);
  });

  it("fits a large valid four-seat scenario inside the share limit", () => {
    const cards = (n: number) => Array(n).fill(0xffffffff);
    const entry = { card: 0xffffffff, pos: "set", materials: cards(10), summoned: true };
    const seat = { hand: Array(20).fill(entry), monsters: Array(7).fill(entry), deck: cards(60), grave: cards(60), banished: cards(60), extra: cards(30) };
    const scenario = { name: "界".repeat(80), board: { format: "ffa4", deckSize: 60, p0: seat, p1: seat, p2: seat, p3: seat }, run: { bots } };
    const code = encode(scenario);
    expect(code.length).toBeGreaterThan(16384);
    expect(code.length).toBeLessThanOrEqual(49152);
    expect(decode(code).board).toEqual(shared.parseSandboxBoard(scenario.board));
  });
});

describe("sandbox v2 host operation contract", () => {
  it("exports the snapshot result type with board, run and loss notes", () => {
    const snapshot: shared.SandboxSnapshotResult = {
      board: shared.parseSandboxBoard({}), run: { bots }, lost: ["Counters cannot be restored."],
    };
    expect(decode(encode({ board: snapshot.board, run: snapshot.run })).board).toEqual(snapshot.board);
  });
  it("exports all three operation names", () => {
    expect(shared.SANDBOX_OPS).toMatchObject({ eliminate: "sandbox-eliminate", snapshot: "sandbox-snapshot", close: "sandbox-close" });
  });
});
