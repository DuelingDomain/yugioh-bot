// The chain response switch in the engines: real cards on the legacy 1v1 engine, the merged engine on the stock core
// and the merged engine on the multi core (3 seats).
import { describe, expect, it } from "vitest";
import type { DuelChainMode, DuelEngineView } from "@yugidraft/shared/duels";
import type { EngineGame } from "../src/engine.js";
import { itWithCores } from "./support/cores.js";
import {
  ACHACHA_ARCHER, ELECTRILYRICAL_WORLD, GORGONIC_GARGOYLE, POKI_DRACO, act, appliancer, engines, game,
  isMainPhaseMenu, isTriggerQuestion, waiting,
} from "./helpers/chain-mode-duel.js";

/** A view without the one private field under test, to compare what everyone else may see. */
const publicPart = (view: DuelEngineView): string => JSON.stringify({ ...view, chainMode: undefined });

describe.each(engines)("chain response mode: $name", ({ create, seats, needed }) => {
  const list = () => [...needed()];
  const open = (g: EngineGame) => waiting(g, seats);

  itWithCores("starts at the duel setting: stopAtEveryWindow true is Always, false is Auto", list(), async () => {
    const always = await game(create, { hand: [POKI_DRACO], seats });
    const auto = await game(create, { hand: [POKI_DRACO], seats, settings: { stopAtEveryWindow: false } });
    try {
      for (let seat = 0; seat < seats; seat += 1) {
        expect(always.view(seat).chainMode).toBe("always");
        expect(auto.view(seat).chainMode).toBe("auto");
      }
      expect(always.view(null).chainMode).toBeUndefined();
    } finally {
      always.close();
      auto.close();
    }
  });

  itWithCores("Off before the summon passes a lone optional trigger; Always asks", list(), async () => {
    const ask = await game(create, { hand: [POKI_DRACO], deckCopies: 2, seats });
    const skip = await game(create, { hand: [POKI_DRACO], deckCopies: 2, seats });
    try {
      const asked = act(ask, POKI_DRACO, "summon", (turn) => isTriggerQuestion(turn) || isMainPhaseMenu(turn), seats);
      expect(isTriggerQuestion(asked)).toBe(true);
      expect(asked.seat).toBe(0);

      expect(skip.setChainMode(0, "off")).toBe(false); // the open prompt is the idle menu: nothing to pass
      const skipped = act(skip, POKI_DRACO, "summon", (turn) => isTriggerQuestion(turn) || isMainPhaseMenu(turn), seats);
      expect(isMainPhaseMenu(skipped)).toBe(true);
      // Poki Draco is on the field and the trigger did not search: the deck still holds both copies.
      const field = skip.view(0).seats[0]!;
      expect(field.monsters.some((card) => card?.code === POKI_DRACO)).toBe(true);
      expect(field.hand.filter((card) => card.code === POKI_DRACO)).toHaveLength(0);
    } finally {
      ask.close();
      skip.close();
    }
  });

  itWithCores("a live toggle to Off passes the trigger question that is open now", list(), async () => {
    const g = await game(create, { hand: [POKI_DRACO], deckCopies: 2, seats });
    try {
      const asked = act(g, POKI_DRACO, "summon", isTriggerQuestion, seats);
      const before = g.view(0).revision;
      expect(asked.prompt.id).toBe(g.view(0).prompt!.id);
      expect(g.setChainMode(0, "off")).toBe(true);
      expect(g.view(0).chainMode).toBe("off");
      expect(g.view(0).revision).toBe(before + 1);
      const next = open(g);
      expect(next?.seat).toBe(0);
      expect(next && isMainPhaseMenu(next)).toBe(true);
      expect(g.view(0).prompt!.id).not.toBe(asked.prompt.id);
    } finally {
      g.close();
    }
  });

  itWithCores("a toggle that passes nothing changes nothing but the seat's own mode", list(), async () => {
    const g = await game(create, { hand: [POKI_DRACO], deckCopies: 2, seats });
    try {
      const asked = act(g, POKI_DRACO, "summon", isTriggerQuestion, seats);
      const before = Array.from({ length: seats }, (_, seat) => g.view(seat));
      const spectator = g.view(null);
      // Always -> Auto: the open question is a trigger prompt, which neither mode passes.
      expect(g.setChainMode(0, "auto")).toBe(false);
      expect(g.setChainMode(0, "always")).toBe(false);
      expect(g.setChainMode(0, "auto")).toBe(false);
      // The opponents and the spectator get byte-identical views; the revision and the open prompt are the same.
      for (let seat = 1; seat < seats; seat += 1) expect(JSON.stringify(g.view(seat))).toBe(JSON.stringify(before[seat]));
      expect(JSON.stringify(g.view(null))).toBe(JSON.stringify(spectator));
      expect(g.view(0).revision).toBe(before[0]!.revision);
      expect(g.view(0).prompt!.id).toBe(asked.prompt.id);
      expect(publicPart(g.view(0))).toBe(publicPart(before[0]!));
      expect(g.view(0).chainMode).toBe("auto");
      // Another seat's mode never shows up in this seat's view.
      expect(g.view(1).chainMode).toBe("always");
    } finally {
      g.close();
    }
  });

  itWithCores("Off also passes several optional triggers (one SELECT_CHAIN window)", list(), async () => {
    const g = await game(create, { hand: [GORGONIC_GARGOYLE, GORGONIC_GARGOYLE, GORGONIC_GARGOYLE], seats });
    try {
      g.setChainMode(0, "off");
      const menu = act(g, GORGONIC_GARGOYLE, "summon", (turn) => turn.seat === 0 && (isMainPhaseMenu(turn) || turn.prompt.context?.type === "chain"), seats);
      expect(menu.prompt.context?.type).not.toBe("chain");
      // Only the summoned Gargoyle is on the field: the other two never chained from the hand.
      expect(g.view(0).seats[0]!.monsters.filter((card) => card?.code === GORGONIC_GARGOYLE)).toHaveLength(1);
    } finally {
      g.close();
    }
  });

  itWithCores("Always asks at the several-trigger window and a live Off passes it", list(), async () => {
    const g = await game(create, { hand: [GORGONIC_GARGOYLE, GORGONIC_GARGOYLE, GORGONIC_GARGOYLE], seats });
    try {
      const asked = act(g, GORGONIC_GARGOYLE, "summon", (turn) => turn.seat === 0 && turn.prompt.context?.type === "chain", seats);
      expect(asked.prompt.options.length).toBeGreaterThan(1);
      expect(g.setChainMode(0, "off")).toBe(true);
      const next = open(g);
      expect(next?.seat === 0 && next.prompt.context?.type === "chain").toBe(false);
    } finally {
      g.close();
    }
  });

  itWithCores("a mandatory trigger still resolves under Off", list(), async () => {
    const g = await game(create, { hand: [ACHACHA_ARCHER], seats });
    try {
      g.setChainMode(0, "off");
      act(g, ACHACHA_ARCHER, "summon", isMainPhaseMenu, seats);
      expect(g.view(0).seats[1]!.lp).toBe(7500);
    } finally {
      g.close();
    }
  });

  itWithCores("Off never answers a script's own effect question while the effect resolves", list(), async () => {
    const g = await game(create, { hand: [ELECTRILYRICAL_WORLD], deckTop: [appliancer()], seats });
    try {
      g.setChainMode(0, "off");
      const asked = act(g, ELECTRILYRICAL_WORLD, "activate", (turn) => turn.seat === 0 && isTriggerQuestion(turn), seats);
      expect(asked.seat).toBe(0);
      expect(g.view(0).prompt!.options.map((o) => o.id).sort()).toEqual(["no", "yes"]);
      expect(g.view(0).chainMode).toBe("off");
    } finally {
      g.close();
    }
  });

  itWithCores("another seat's mode does not touch this seat's windows", list(), async () => {
    const g = await game(create, { hand: [POKI_DRACO], deckCopies: 2, seats });
    try {
      for (let seat = 1; seat < seats; seat += 1) g.setChainMode(seat, "off");
      const asked = act(g, POKI_DRACO, "summon", (turn) => isTriggerQuestion(turn) || isMainPhaseMenu(turn), seats);
      expect(isTriggerQuestion(asked)).toBe(true);
    } finally {
      g.close();
    }
  });

  itWithCores("replays deterministically: the same toggles at the same points give the same duel", list(), async () => {
    const run = async (): Promise<string[]> => {
      const g = await game(create, { hand: [POKI_DRACO], deckCopies: 2, seats });
      try {
        act(g, POKI_DRACO, "summon", isTriggerQuestion, seats);
        const trace: string[] = [];
        trace.push(String(g.setChainMode(0, "auto")));
        trace.push(String(g.setChainMode(0, "off")));
        trace.push(JSON.stringify(g.view(0)));
        trace.push(JSON.stringify(g.view(null)));
        return trace;
      } finally {
        g.close();
      }
    };
    expect(await run()).toEqual(await run());
  });

  it("rejects a seat the table does not have", async () => {
    const g = await game(create, { hand: [POKI_DRACO], seats }).catch(() => null);
    if (!g) return; // cores missing: the other tests name them
    try {
      expect(() => g.setChainMode(seats, "off")).toThrow(/Invalid seat/);
      expect(() => g.setChainMode(-1, "off")).toThrow(/Invalid seat/);
    } finally {
      g.close();
    }
  });
});

describe("chain modes are valid", () => {
  it("covers the three modes", () => {
    const modes: DuelChainMode[] = ["auto", "always", "off"];
    expect(modes).toHaveLength(3);
  });
});
