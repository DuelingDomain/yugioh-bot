import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import createCore, { OcgDuelMode, OcgLocation, OcgPosition, OcgQueryFlags } from "ocgcore-wasm";
import { loadCardDatabase } from "../src/cards.js";
import { engineDataDirectory } from "./engine-data-dir.js";

// The wrapper is minified and exports neither its reader nor its parsers, so the crafted-byte tests cut the
// patched functions out of dist/index.js and run them in isolation. See docs/engine/ocgcore-wasm-abi.md.
const wrapperSource = readFileSync(fileURLToPath(import.meta.resolve("ocgcore-wasm")), "utf8");

function cutBlock(start: string) {
  const at = wrapperSource.indexOf(start);
  assert(at >= 0, `wrapper no longer contains ${start}`);
  const open = wrapperSource.indexOf("{", at);
  let depth = 0;
  for (let index = open; index < wrapperSource.length; index += 1) {
    const char = wrapperSource[index];
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return wrapperSource.slice(at, index + 1);
  }
  throw new Error(`unbalanced block for ${start}`);
}

interface Reader { avail: number }
interface Parsers {
  Reader: new (view: DataView, offset?: number) => Reader;
  query: (reader: Reader) => Record<string, unknown> | null;
  message: (reader: Reader) => Record<string, unknown> | null;
  /** The wrapper keeps "this core is the legacy core" in a module variable that duelGetMessage sets. The cut-out code has its own copy. */
  setLegacy: (legacy: boolean) => void;
}

function loadParsers(): Parsers {
  const classSource = cutBlock("F=class e{").replace(/^F=/, "const F=");
  const body = [classSource, cutBlock("function p(e){"), cutBlock("function G(e){"), cutBlock("function Q(e){"), cutBlock("function te(e){")].join("\n");
  const factory = new Function(
    "u", "L", "I",
    `var __yl=false;\n${body}\nreturn { Reader: F, query: Q, message: te, setLegacy(value){ __yl=value; } };`,
  ) as (u: unknown, l: unknown, i: unknown) => Parsers;
  return factory(OcgQueryFlags, OcgLocation, OcgPosition);
}

/** Little endian integer of the given byte width. */
function le(width: 1 | 2 | 4 | 8, value: number | bigint) {
  const out: number[] = [];
  let rest = BigInt(value);
  for (let i = 0; i < width; i += 1) { out.push(Number(rest & 0xffn)); rest >>= 8n; }
  return out;
}

function queryField(flag: number, payload: number[]) {
  return [...le(2, payload.length + 4), ...le(4, flag), ...payload];
}

function readerOf(parsers: Parsers, bytes: number[]) {
  const data = new Uint8Array(bytes);
  return new parsers.Reader(new DataView(data.buffer, data.byteOffset, data.byteLength));
}

describe("patched ocgcore-wasm parsers", () => {
  const parsers = loadParsers();
  const END = [...le(2, 4), ...le(4, 0x80000000)];

  it("parses the TYPE query flag and keeps following fields in sync", () => {
    const data = [
      ...queryField(OcgQueryFlags.CODE, le(4, 46986414)),
      ...queryField(OcgQueryFlags.TYPE, le(4, 0x11)),
      ...queryField(OcgQueryFlags.ATTACK, le(4, 2500)),
      ...END,
    ];
    expect(parsers.query(readerOf(parsers, data))).toEqual({ code: 46986414, type: 0x11, attack: 2500 });
  });

  it("skips unknown flags and odd sizes without losing later fields", () => {
    const data = [
      ...queryField(OcgQueryFlags.CODE, le(4, 1234)),
      ...queryField(0x40000000, [...queryField(OcgQueryFlags.ATTACK, le(4, 1)), 7]), // unknown flag, odd payload that looks like a field
      ...queryField(OcgQueryFlags.LEVEL, [9, 9]), // known flag, wrong size
      ...queryField(OcgQueryFlags.OVERLAY_CARD, [9, 0, 0]), // truncated count: field parse fails, stream stays aligned
      ...queryField(OcgQueryFlags.DEFENSE, le(4, 1800)),
      ...END,
    ];
    const result = parsers.query(readerOf(parsers, data));
    expect(result).toEqual({ code: 1234, defense: 1800 });
  });

  it("returns null for an empty card slot and reads the next card cleanly", () => {
    const data = [0, 0, ...queryField(OcgQueryFlags.CODE, le(4, 7)), ...END];
    const reader = readerOf(parsers, data);
    expect(parsers.query(reader)).toBeNull();
    expect(parsers.query(reader)).toEqual({ code: 7 });
  });

  it("reads COUNTERS as type then count", () => {
    const counter = [...le(2, 0x1002), ...le(2, 3)]; // type 0x1002, count 3
    const data = [...queryField(OcgQueryFlags.COUNTERS, [...le(4, 1), ...counter]), ...END];
    expect(parsers.query(readerOf(parsers, data))).toEqual({ counters: { 0x1002: 3 } });
  });

  it("reads ANNOUNCE_ATTRIB available as a 32 bit value", () => {
    const data = [...le(1, 141), ...le(1, 1), ...le(1, 2), ...le(4, 0x01020340)];
    expect(parsers.message(readerOf(parsers, data))).toEqual({ type: 141, player: 1, count: 2, available: 0x01020340 });
  });

  it("reads SWAP_GRAVE_DECK as player, extra count, bitmap length, bitmap", () => {
    const data = [...le(1, 35), ...le(1, 0), ...le(4, 3), ...le(4, 2), 0b00000101, 0b00000010];
    expect(parsers.message(readerOf(parsers, data))).toEqual({ type: 35, player: 0, deck_size: 3, returned_to_extra: [0, 2, 9] });
  });

  it("throws eof on a truncated message, and duelGetMessage catches it per message", () => {
    const truncated = [...le(1, 141), ...le(1, 1), ...le(1, 2), ...le(2, 0x40)];
    expect(() => parsers.message(readerOf(parsers, truncated))).toThrow("eof");
    const loop = wrapperSource.slice(wrapperSource.indexOf("duelGetMessage({"), wrapperSource.indexOf("duelSetResponse("));
    expect(loop).toContain("try{R=te(T)}catch");
    expect(loop).toContain("continue");
  });
});

// createCore({ legacyMessages: true }) (the legacy 1v1 engine) keeps the message layout of the wrapper that production ran before the
// n-seat work. The two messages below are the ones whose layout differs, and a failed parse is not skipped: it throws.
describe("patched ocgcore-wasm parsers, legacy message mode", () => {
  const parsers = loadParsers();
  parsers.setLegacy(true);

  it("reads ANNOUNCE_ATTRIB available as an 8 bit value", () => {
    const data = [...le(1, 141), ...le(1, 1), ...le(1, 2), ...le(1, 0x40)];
    expect(parsers.message(readerOf(parsers, data))).toEqual({ type: 141, player: 1, count: 2, available: 0x40 });
  });

  it("reads SWAP_GRAVE_DECK as player, deck size, then bitmap bits up to the deck size", () => {
    const data = [...le(1, 35), ...le(1, 0), ...le(4, 3), ...le(4, 2), 0b00000101, 0b00000010];
    expect(parsers.message(readerOf(parsers, data))).toEqual({ type: 35, player: 0, deck_size: 3, returned_to_extra: [0, 2] });
  });

  it("reads MOVE with one location byte and a from/to pair per card", () => {
    const place = [...le(4, 111), ...le(1, 0), ...le(1, 2), ...le(4, 0), ...le(4, 0)]; // code, controller, location, sequence, position
    const data = [...le(1, 36), ...le(1, 4), ...le(4, 1), ...place, ...place];
    expect((parsers.message(readerOf(parsers, data)) as { cards?: unknown[] }).cards).toHaveLength(1);
  });
});

describe("ocgcore-wasm queries with the TYPE flag", () => {
  it("returns the card type and keeps later fields correct", async () => {
    const cards = loadCardDatabase(engineDataDirectory);
    const core = await createCore({ sync: true });
    const errors: string[] = [];
    const handle = core.createDuel({
      flags: OcgDuelMode.MODE_MR5,
      seed: [1n, 2n, 3n, 4n],
      team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      cardReader: cards.cardData,
      scriptReader: cards.readScript,
      errorHandler: (_type, text) => errors.push(text),
    });
    assert(handle);
    try {
      for (const name of ["constant.lua", "utility.lua"]) {
        const script = cards.readScript(name);
        assert(script);
        assert(core.loadScript(handle, name, script));
      }
      core.duelNewCard(handle, { team: 0, duelist: 0, code: 46986414, controller: 0, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK });
      core.duelNewCard(handle, { team: 0, duelist: 0, code: 46986414, controller: 0, location: OcgLocation.MZONE, sequence: 1, position: OcgPosition.FACEUP_ATTACK });
      const flags = (OcgQueryFlags.CODE | OcgQueryFlags.TYPE | OcgQueryFlags.LEVEL | OcgQueryFlags.ATTACK | OcgQueryFlags.DEFENSE | OcgQueryFlags.OWNER) as OcgQueryFlags;
      const expected = { code: 46986414, type: 0x11, level: 7, attack: 2500, defense: 2100, owner: 0 };
      const single = core.duelQuery(handle, { controller: 0, location: OcgLocation.MZONE, sequence: 0, overlaySequence: 0, flags });
      expect(single).toMatchObject(expected);
      const location = core.duelQueryLocation(handle, { controller: 0, location: OcgLocation.MZONE, flags });
      expect(location.slice(0, 2)).toEqual([expect.objectContaining(expected), expect.objectContaining(expected)]);
      expect(errors).toEqual([]);
    } finally {
      core.destroyDuel(handle);
    }
  });
});

// Counters. The merged parser reads each counter as type then count. The old wrapper (main's, the legacy 1v1 engine) read them the
// other way round and production shows that: legacy keeps it, for duelQuery AND for duelQueryLocation (a review found that the location
// query always used the merged parser, so the card inspector showed "Counter 4098: 3" in legacy mode where main shows "Counter 3: 4098").
describe("ocgcore-wasm counters query, both modes", () => {
  const counterCard = 46986414; // any monster; the counter is added by a script

  async function queryCounters(legacy: boolean) {
    const cards = loadCardDatabase(engineDataDirectory);
    const core = await createCore({ sync: true, ...(legacy ? { legacyMessages: true } : {}) } as { sync: true });
    const errors: string[] = [];
    const handle = core.createDuel({
      flags: OcgDuelMode.MODE_MR5,
      seed: [1n, 2n, 3n, 4n],
      team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      cardReader: cards.cardData,
      scriptReader: cards.readScript,
      errorHandler: (_type, text) => errors.push(text),
    });
    assert(handle);
    try {
      for (const name of ["constant.lua", "utility.lua"]) {
        const script = cards.readScript(name);
        assert(script);
        assert(core.loadScript(handle, name, script));
      }
      core.duelNewCard(handle, { team: 0, duelist: 0, code: counterCard, controller: 0, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK });
      assert(core.loadScript(handle, "counter.lua", "Duel.GetFieldCard(0,LOCATION_MZONE,0):AddCounter(0x1002,3)"));
      const flags = (OcgQueryFlags.CODE | OcgQueryFlags.COUNTERS) as OcgQueryFlags;
      const single = core.duelQuery(handle, { controller: 0, location: OcgLocation.MZONE, sequence: 0, overlaySequence: 0, flags });
      const location = core.duelQueryLocation(handle, { controller: 0, location: OcgLocation.MZONE, flags });
      expect(errors).toEqual([]);
      return { single: single?.counters, location: location[0]?.counters };
    } finally {
      core.destroyDuel(handle);
    }
  }

  it("merged parser: counter type is the key, the count the value, in duelQuery and duelQueryLocation", async () => {
    expect(await queryCounters(false)).toEqual({ single: { 0x1002: 3 }, location: { 0x1002: 3 } });
  });

  it("legacy parser: duelQuery and duelQueryLocation agree and keep main's layout (count is the key)", async () => {
    expect(await queryCounters(true)).toEqual({ single: { 3: 0x1002 }, location: { 3: 0x1002 } });
  });
});
