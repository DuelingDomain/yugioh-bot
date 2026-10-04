import { describe, expect, it } from "vitest";
import type { DuelCardInfo, DuelChainMode } from "@yugidraft/shared/duels";
import {
  OcgEffectClientMode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  type OcgCardData,
  type OcgHintTiming,
  type OcgMessage,
} from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import { OFF_SKIPS_OPTIONAL_TRIGGERS, TRIGGER_EFFECT_YN_DESCRIPTION, chainWindowPasses, effectYesNoPasses, effectiveChainMode } from "../src/chain-mode.js";
import { autoResponse as mergedAutoResponse, mapPrompt as mergedMapPrompt } from "../src/prompts.js";
import { autoResponse as legacyAutoResponse, mapPrompt as legacyMapPrompt } from "../src/legacy/prompts.js";

function info(code: number): DuelCardInfo {
  return { code, name: `Card ${code}`, description: "", type: 1, attack: 1000, defense: 1000, level: 4, attribute: 1, race: "warrior" };
}

const cards: CardDatabase = {
  search: () => [],
  deckCard: () => undefined,
  all: () => [],
  setnames: () => new Map(),
  get: (code) => info(code),
  cardData: (code): OcgCardData | null => ({
    code, alias: 0, setcodes: [], type: 1, level: 4, attribute: 1, race: 1n, attack: 1000, defense: 1000,
    lscale: 0, rscale: 0, link_marker: 0,
  }),
  resolveLabel: () => "",
  system: () => undefined,
  victory: () => undefined,
  counter: () => undefined,
  readScript: () => null,
  close() {},
};

function chainWindow(overrides: { spe_count?: number; forced?: boolean; selects?: number; player?: number }): OcgMessage {
  const count = overrides.selects ?? 1;
  return {
    type: OcgMessageType.SELECT_CHAIN,
    player: overrides.player ?? 0,
    spe_count: overrides.spe_count ?? 0,
    forced: overrides.forced ?? false,
    hint_timing: 0 as OcgHintTiming,
    hint_timing_other: 0 as OcgHintTiming,
    selects: Array.from({ length: count }, (_, sequence) => ({
      code: 1,
      controller: 0,
      location: OcgLocation.SZONE,
      sequence,
      position: OcgPosition.FACEUP,
      description: 1n,
      client_mode: OcgEffectClientMode.NORMAL,
    })),
  };
}

const pass = { type: OcgResponseType.SELECT_CHAIN, index: null };
const first = { type: OcgResponseType.SELECT_CHAIN, index: 0 };

const engines = [
  { name: "merged engine", autoResponse: mergedAutoResponse, mapPrompt: mergedMapPrompt },
  { name: "legacy engine", autoResponse: legacyAutoResponse, mapPrompt: legacyMapPrompt },
] as const;

const PHASES = ["draw", "standby", "main1", "battle", "main2", "end"];
const TRIGGER = 0x7f; // not what the core sends (it sends the trigger count), kept as an arbitrary large spe_count in the matrix

describe.each(engines)("chain mode in autoResponse: $name", ({ autoResponse, mapPrompt }) => {
  const run = (message: OcgMessage, mode: DuelChainMode | undefined, phase?: string, stopAtEveryWindow?: boolean) =>
    autoResponse(mapPrompt(message, cards, "p0-1"), { chainMode: mode, stopAtEveryWindow, phase });

  describe("optional window (not forced)", () => {
    // [spe_count, label]: a window where nothing fits, one that fits, and an optional trigger.
    const windows: Array<[number, string]> = [[0, "nothing fits"], [1, "a card fits"], [TRIGGER, "optional trigger"]];

    it.each(PHASES)("Always asks in every window in %s", (phase) => {
      for (const [spe] of windows) expect(run(chainWindow({ spe_count: spe }), "always", phase)).toBeNull();
    });

    it.each(PHASES)("Auto passes only a window where nothing fits, and not in the Draw or Standby Phase (%s)", (phase) => {
      const quiet = phase !== "draw" && phase !== "standby";
      expect(run(chainWindow({ spe_count: 0 }), "auto", phase)).toEqual(quiet ? pass : null);
      expect(run(chainWindow({ spe_count: 1 }), "auto", phase)).toBeNull();
      expect(run(chainWindow({ spe_count: TRIGGER }), "auto", phase)).toBeNull();
    });

    it.each(PHASES)("Off passes every optional window in %s, even with a card that fits", (phase) => {
      expect(run(chainWindow({ spe_count: 0 }), "off", phase)).toEqual(pass);
      expect(run(chainWindow({ spe_count: 1 }), "off", phase)).toEqual(pass);
      expect(run(chainWindow({ spe_count: 5, selects: 3 }), "off", phase)).toEqual(pass);
    });

    it.each(PHASES)("Off also passes an optional trigger in %s (the named rule is skip)", (phase) => {
      expect(OFF_SKIPS_OPTIONAL_TRIGGERS).toBe(true);
      expect(run(chainWindow({ spe_count: TRIGGER }), "off", phase)).toEqual(pass);
      expect(run(chainWindow({ spe_count: TRIGGER, selects: 2 }), "off", phase)).toEqual(pass);
    });
  });

  describe("forced window", () => {
    it.each(["auto", "always", "off"] as const)("%s never passes a mandatory effect", (mode) => {
      for (const phase of PHASES) {
        expect(run(chainWindow({ spe_count: 0, forced: true, selects: 2 }), mode, phase)).toBeNull();
        expect(run(chainWindow({ spe_count: TRIGGER, forced: true, selects: 2 }), mode, phase)).toBeNull();
        expect(run(chainWindow({ spe_count: 1, forced: true, selects: 2 }), mode, phase)).toBeNull();
        // A forced window with exactly one choice is answered with that choice.
        expect(run(chainWindow({ spe_count: 0, forced: true }), mode, phase)).toEqual(first);
        expect(run(chainWindow({ spe_count: TRIGGER, forced: true }), mode, phase)).toEqual(first);
      }
    });
  });

  describe("the yes/no of one optional trigger (SELECT_EFFECTYN)", () => {
    const effectYesNo = (description: bigint): OcgMessage => ({
      type: OcgMessageType.SELECT_EFFECTYN, player: 0, code: 1, controller: 0, location: OcgLocation.MZONE, sequence: 0,
      position: OcgPosition.FACEUP_ATTACK, description,
    });
    const no = { type: OcgResponseType.SELECT_EFFECTYN, yes: false };

    it("Off answers no to the trigger prompt (description 221) and to nothing else", () => {
      expect(run(effectYesNo(TRIGGER_EFFECT_YN_DESCRIPTION), "off", "main1")).toEqual(no);
      // A script's own question while its effect resolves: 95 by default, 96 for a replacement, a card string, or none.
      for (const description of [95n, 96n, 0n, 3875465n * 16n]) expect(run(effectYesNo(description), "off", "main1")).toBeNull();
      expect(run({ type: OcgMessageType.SELECT_YESNO, player: 0, description: TRIGGER_EFFECT_YN_DESCRIPTION }, "off", "main1")).toBeNull();
    });

    it.each(["auto", "always", undefined] as const)("%s asks about the trigger", (mode) => {
      expect(run(effectYesNo(TRIGGER_EFFECT_YN_DESCRIPTION), mode, "main1")).toBeNull();
      expect(run(effectYesNo(95n), mode, "main1")).toBeNull();
    });
  });

  describe("empty window", () => {
    it.each(["auto", "always", "off"] as const)("%s passes a window that lists no card", (mode) => {
      for (const phase of PHASES) expect(run(chainWindow({ selects: 0 }), mode, phase)).toEqual(pass);
    });
  });

  describe("no chainMode (callers and saved duels from before per-seat modes)", () => {
    it("falls back to stopAtEveryWindow: undefined and true ask, false is Auto", () => {
      expect(run(chainWindow({ spe_count: 0 }), undefined, "main1", undefined)).toBeNull();
      expect(run(chainWindow({ spe_count: 0 }), undefined, "main1", true)).toBeNull();
      expect(run(chainWindow({ spe_count: 0 }), undefined, "main1", false)).toEqual(pass);
      expect(run(chainWindow({ spe_count: 0 }), undefined, "standby", false)).toBeNull();
      expect(run(chainWindow({ spe_count: 1 }), undefined, "main1", false)).toBeNull();
    });

    it("an explicit chainMode wins over stopAtEveryWindow", () => {
      expect(run(chainWindow({ spe_count: 0 }), "off", "main1", true)).toEqual(pass);
      expect(run(chainWindow({ spe_count: 0 }), "always", "main1", false)).toBeNull();
      expect(run(chainWindow({ spe_count: 0 }), "auto", "main1", true)).toEqual(pass);
    });
  });
});

describe("the named rule", () => {
  it("chainWindowPasses is the one place that decides an optional window", () => {
    expect(chainWindowPasses({ forced: false, spe_count: 3 }, "off", "main1")).toBe(true);
    expect(chainWindowPasses({ forced: false, spe_count: TRIGGER }, "off", "main1")).toBe(OFF_SKIPS_OPTIONAL_TRIGGERS);
    expect(chainWindowPasses({ forced: true, spe_count: 0 }, "off", "main1")).toBe(false);
    expect(chainWindowPasses({ forced: false, spe_count: 0 }, "always", "main1")).toBe(false);
    expect(chainWindowPasses({ forced: false, spe_count: 0 }, "auto", "main2")).toBe(true);
  });

  it("effectYesNoPasses follows the same rule for the lone-trigger prompt", () => {
    expect(effectYesNoPasses({ description: TRIGGER_EFFECT_YN_DESCRIPTION }, "off")).toBe(OFF_SKIPS_OPTIONAL_TRIGGERS);
    expect(effectYesNoPasses({ description: TRIGGER_EFFECT_YN_DESCRIPTION }, "auto")).toBe(false);
    expect(effectYesNoPasses({ description: 95n }, "off")).toBe(false);
  });

  it("effectiveChainMode derives the starting mode from the duel setting", () => {
    expect(effectiveChainMode({})).toBe("always");
    expect(effectiveChainMode({ stopAtEveryWindow: true })).toBe("always");
    expect(effectiveChainMode({ stopAtEveryWindow: false })).toBe("auto");
    expect(effectiveChainMode({ stopAtEveryWindow: false, chainMode: "off" })).toBe("off");
  });
});
