import { describe, expect, it } from "vitest";
import {
  CHAIN_MODE_JOURNAL_LIMIT,
  CHAIN_MODE_PROMPT_PREFIX,
  DUEL_CHAIN_MODES,
  chainModeOf,
  defaultChainMode,
  defaultDuelSettings,
  isDuelChainMode,
} from "../../src/duels/index.js";

describe("chain response mode", () => {
  it("names exactly three modes", () => {
    expect([...DUEL_CHAIN_MODES]).toEqual(["auto", "always", "off"]);
    for (const mode of DUEL_CHAIN_MODES) expect(isDuelChainMode(mode)).toBe(true);
    for (const bad of ["", "Auto", "on", "pass", null, undefined, 1, {}]) expect(isDuelChainMode(bad)).toBe(false);
  });

  it("starts at the duel setting: stopAtEveryWindow false is Auto, true or unset is Always", () => {
    expect(defaultChainMode({ stopAtEveryWindow: false })).toBe("auto");
    expect(defaultChainMode({ stopAtEveryWindow: true })).toBe("always");
    expect(defaultChainMode({})).toBe("always");
    expect(defaultChainMode(undefined)).toBe("always");
    expect(defaultChainMode({ ...defaultDuelSettings("normal"), stopAtEveryWindow: false })).toBe("auto");
  });

  it("reads a journaled prompt id back to its mode, and nothing else", () => {
    for (const mode of DUEL_CHAIN_MODES) expect(chainModeOf(`${CHAIN_MODE_PROMPT_PREFIX}${mode}`)).toBe(mode);
    expect(chainModeOf("chain-mode:")).toBeNull();
    expect(chainModeOf("chain-mode:maybe")).toBeNull();
    expect(chainModeOf("eliminate:0")).toBeNull();
    expect(chainModeOf("p12")).toBeNull();
  });

  it("allows a few hundred journal entries per duel", () => {
    expect(CHAIN_MODE_JOURNAL_LIMIT).toBe(400);
  });
});
