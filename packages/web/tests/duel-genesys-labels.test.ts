import { describe, expect, it } from "vitest";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import {
  boardMasterRule, genesysCapShort, genesysLabel, genesysModeName, genesysOf, parseGenesysCap, sessionBoardRule,
} from "@/components/duel/genesys";
import { tagModeLabel } from "@/components/duel/tag/tag-header";

const cap = { pointCap: 100 };

describe("Genesys labels", () => {
  it("says nothing for an ordinary duel", () => {
    expect(genesysOf({ settings: defaultDuelSettings("normal") })).toBeNull();
    expect(genesysOf({})).toBeNull();
    expect(genesysModeName("normal", null)).toBeNull();
    expect(genesysLabel("domain", undefined)).toBeNull();
  });

  it("names Genesys and Genesys Domain with the cap", () => {
    expect(genesysModeName("normal", cap)).toBe("Genesys");
    expect(genesysModeName("domain", cap)).toBe("Genesys Domain");
    expect(genesysModeName("domain", cap, true)).toBe("Custom Genesys Domain");
    expect(genesysCapShort({ pointCap: 0 })).toBe("0 pts");
    expect(genesysLabel("normal", cap)).toBe("Genesys · 100 pts");
    expect(genesysLabel("domain", { pointCap: 80 })).toBe("Genesys Domain · 80 pts");
  });

  it("labels the Tag header pill", () => {
    const base = { masterRule: 5 as const, settings: defaultDuelSettings("normal", "tag") };
    expect(tagModeLabel({ ...base, mode: "normal" })).toBe("MR5");
    expect(tagModeLabel({ ...base, mode: "normal", settings: { ...base.settings, genesys: cap } })).toBe("Genesys · 100 pts");
    expect(tagModeLabel({ ...base, mode: "domain", settings: { ...defaultDuelSettings("domain"), genesys: cap } })).toBe("Genesys Domain · 100 pts");
  });
});

describe("Genesys board layout rule", () => {
  it("draws a Genesys board without Extra Monster Zones or Pendulum Zones", () => {
    for (const rule of [3, 4, 5] as const) expect(boardMasterRule(rule, { genesys: true })).toBe(2);
  });

  it("leaves other boards alone", () => {
    for (const rule of [1, 2, 3, 4, 5] as const) expect(boardMasterRule(rule, null)).toBe(rule);
    expect(boardMasterRule(1, { genesys: true })).toBe(1);
    expect(sessionBoardRule({ masterRule: 5 }, { field: { genesys: true } })).toBe(2);
    expect(sessionBoardRule({ masterRule: 5 }, {})).toBe(5);
    expect(sessionBoardRule({ masterRule: 5 }, { field: { genesys: false } })).toBe(5);
  });
});

describe("parseGenesysCap", () => {
  it.each(["0", "100", "1000", " 25 "])("accepts %j", (text) => {
    expect(parseGenesysCap(text)).toEqual({ ok: true, value: Number(text.trim()) });
  });
  it.each(["", " ", "abc", "-1", "1001", "1.5", "1e2"])("rejects %j", (text) => {
    expect(parseGenesysCap(text).ok).toBe(false);
  });
});
