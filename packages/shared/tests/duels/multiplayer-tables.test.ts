import { describe, expect, it } from "vitest";
import {
  MULTIPLAYER_TABLES_OFF_MESSAGE,
  enabledDuelFormats,
  multiplayerSeatsBlockReason,
  multiplayerTablesBlockReason,
  multiplayerTablesEnabled,
} from "../../src/duels/index.js";

describe("multiplayerTablesEnabled", () => {
  it("is off when the key is missing or empty", () => {
    expect(multiplayerTablesEnabled({})).toBe(false);
    expect(multiplayerTablesEnabled({ MULTIPLAYER_TABLES: "" })).toBe(false);
  });

  it("is off for 0, false, off and anything else", () => {
    for (const value of ["0", "false", "off", "no", "2", "yes"]) {
      expect(multiplayerTablesEnabled({ MULTIPLAYER_TABLES: value })).toBe(false);
    }
  });

  it("is on for 1, true and on, in any case, with spaces", () => {
    for (const value of ["1", "true", "TRUE", "on", " On "]) {
      expect(multiplayerTablesEnabled({ MULTIPLAYER_TABLES: value })).toBe(true);
    }
  });

  it("reads process.env when it gets no argument", () => {
    const saved = process.env.MULTIPLAYER_TABLES;
    try {
      process.env.MULTIPLAYER_TABLES = "1";
      expect(multiplayerTablesEnabled()).toBe(true);
      process.env.MULTIPLAYER_TABLES = "0";
      expect(multiplayerTablesEnabled()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.MULTIPLAYER_TABLES;
      else process.env.MULTIPLAYER_TABLES = saved;
    }
  });
});

describe("table type limits", () => {
  it("offers only 1v1 when off and all four when on", () => {
    expect(enabledDuelFormats(false)).toEqual(["1v1"]);
    expect(enabledDuelFormats(true)).toEqual(["1v1", "tag", "ffa3", "ffa4"]);
  });

  it("blocks Tag and FFA only when off", () => {
    expect(multiplayerTablesBlockReason("1v1", false)).toBeNull();
    expect(multiplayerTablesBlockReason(undefined, false)).toBeNull();
    for (const format of ["tag", "ffa3", "ffa4"] as const) {
      expect(multiplayerTablesBlockReason(format, false)).toBe(MULTIPLAYER_TABLES_OFF_MESSAGE);
      expect(multiplayerTablesBlockReason(format, true)).toBeNull();
    }
  });

  it("blocks more than 2 seats only when off", () => {
    expect(multiplayerSeatsBlockReason(2, false)).toBeNull();
    expect(multiplayerSeatsBlockReason(3, false)).toBe(MULTIPLAYER_TABLES_OFF_MESSAGE);
    expect(multiplayerSeatsBlockReason(4, false)).toBe(MULTIPLAYER_TABLES_OFF_MESSAGE);
    expect(multiplayerSeatsBlockReason(4, true)).toBeNull();
  });
});
