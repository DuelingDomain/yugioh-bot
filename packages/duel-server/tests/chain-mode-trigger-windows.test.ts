// FIRST test of the chain response switch: what the core really asks for the duelist's own optional triggers, with
// real cards on the legacy 1v1 core, on the stock core of the merged engine, and on the multi core (3 seats). The
// measured shapes decide what "Off" may pass (src/chain-mode.ts):
//   - several optional triggers  -> ONE non-forced SELECT_CHAIN listing them. Its spe_count is the number of listed
//     trigger effects (2 here), NOT 0x7f: 0x7f never appeared in these windows.
//   - ONE optional trigger       -> a SELECT_EFFECTYN with description 221 ("Activate the Trigger Effect of ..."),
//     asked outside any resolving chain link, whatever description the card gives its own effect.
//   - a script's own yes/no while its effect resolves -> SELECT_EFFECTYN with the script's description (95 here),
//     asked while a chain link is resolving. No script passes 221.
//   - ONE mandatory trigger      -> no prompt at all; the core resolves it.
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelAnswer, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { OcgMessageType, type OcgCoreSync, type OcgMessage } from "ocgcore-wasm";
import { createEngineGame as createMergedGame, type EngineGame } from "../src/engine.js";
import { createEngineGame as createLegacyGame } from "../src/legacy/engine.js";
import { TRIGGER_EFFECT_YN_DESCRIPTION } from "../src/chain-mode.js";
import { choosePracticeBotAnswer } from "../src/practice-bot.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { itWithCores, needs } from "./support/cores.js";

// Observe the decoded core output without changing it.
const observed = vi.hoisted(() => ({ messages: [] as OcgMessage[] }));
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return {
    ...actual,
    default: async (options: { sync: true }) => {
      const core = await actual.default(options);
      const read = core.duelGetMessage;
      core.duelGetMessage = ((handle) => {
        const messages = read(handle);
        observed.messages.push(...messages);
        return messages;
      }) as OcgCoreSync["duelGetMessage"];
      return core;
    },
  };
});
beforeEach(() => { observed.messages.length = 0; });

type ChainWindow = Extract<OcgMessage, { type: OcgMessageType.SELECT_CHAIN }>;
type EffectYesNo = Extract<OcgMessage, { type: OcgMessageType.SELECT_EFFECTYN }>;
const POKI_DRACO = 8175346; // level 3; optional "when Normal Summoned" search (EFFECT_TYPE_TRIGGER_O), needs a copy in the deck
const GORGONIC_GARGOYLE = 64379261; // level 3 Rock; optional "when a Rock monster is Normal Summoned, Special Summon this from your hand"
const ELECTRILYRICAL_WORLD = 3875465; // field spell; its Activate resolution asks Duel.SelectEffectYesNo(tp, handler, 95)
const ACHACHA_ARCHER = 98865920; // level 3; mandatory "when Normal Summoned" trigger (EFFECT_TYPE_TRIGGER_F), 500 damage

function fillers(): number[] {
  const db = new Database(`${engineDataDirectory}/cards.cdb`, { readonly: true });
  try {
    return (db.prepare("select id from datas where type = 17 and alias = 0 and (ot & 3) != 0 and level between 5 and 8 order by id limit 40")
      .all() as { id: number }[]).map((row) => row.id);
  } finally {
    db.close();
  }
}

/** An Appliancer main-deck monster, which Electrilyrical World's Activate asks to search. */
function appliancer(): number {
  const db = new Database(`${engineDataDirectory}/cards.cdb`, { readonly: true });
  try {
    return (db.prepare("select id from datas where ((setcode & 65535) = 330 or ((setcode >> 16) & 65535) = 330) and type = 33 limit 1").get() as { id: number }).id;
  } finally {
    db.close();
  }
}

type Create = typeof createMergedGame;

/** Seat 0's opening hand is `hand` (topped up with fillers to five cards); `deckTop` and `deckCopies` of `hand[0]` follow. Nothing is shuffled. */
async function game(create: Create, hand: number[], deckCopies = 0, deckTop: number[] = [], seats = 2): Promise<EngineGame> {
  const pool = fillers();
  const first = [...hand, ...pool.slice(0, 5 - hand.length), ...deckTop, ...Array.from({ length: deckCopies }, () => hand[0]!)];
  const decks = [
    { main: [...first, ...pool.slice(0, 40 - first.length)], extra: [], side: [] },
    ...Array.from({ length: seats - 1 }, () => ({ main: pool.slice(0, 40), extra: [], side: [] })),
  ];
  return create({
    mode: "normal", ...(seats === 3 ? { format: "ffa3" as const } : {}), decks,
    seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    settings: { ...defaultDuelSettings("normal"), validateDeck: false, shuffleDeck: false, stopAtEveryWindow: true },
  });
}

function waiting(g: EngineGame, seats: number): { seat: number; view: DuelEngineView; prompt: DuelPrompt } | null {
  for (let seat = 0; seat < seats; seat += 1) {
    const view = g.view(seat);
    if (view.prompt) return { seat, view, prompt: view.prompt };
  }
  return null;
}

function pass(prompt: DuelPrompt): DuelAnswer {
  if (prompt.cancelable) return { cancel: true };
  if (prompt.options.some((option) => option.id === "no")) return { choice: "no" };
  if (prompt.options.some((option) => option.id === "to_ep")) return { choice: "to_ep" };
  return choosePracticeBotAnswer(prompt);
}

const chainWindows = () => observed.messages.filter((m): m is ChainWindow => m.type === OcgMessageType.SELECT_CHAIN);
const describeWindows = () => JSON.stringify(chainWindows().map((w) => [w.player, w.spe_count, w.forced, w.selects.map((s) => s.code)]));
const messageTypes = () => observed.messages.map((m) => OcgMessageType[m.type]);

/** Every SELECT_EFFECTYN the core raised, with the number of chain links that were resolving when it was asked. */
function effectYesNos(): Array<{ message: EffectYesNo; resolving: number }> {
  let resolving = 0;
  const found: Array<{ message: EffectYesNo; resolving: number }> = [];
  for (const message of observed.messages) {
    if (message.type === OcgMessageType.CHAIN_SOLVING) resolving += 1;
    if (message.type === OcgMessageType.CHAIN_SOLVED) resolving -= 1;
    if (message.type === OcgMessageType.SELECT_EFFECTYN) found.push({ message, resolving });
  }
  return found;
}

/**
 * Normal Summon (or activate) `code` from seat 0's hand, passing every other prompt, until `done` says what the
 * test waits for has been seen.
 */
function play(g: EngineGame, code: number, action: "summon" | "activate", done: () => boolean, seats = 2): void {
  let acted = false;
  for (let step = 0; step < 80 && !(acted && done()); step += 1) {
    const turn = waiting(g, seats);
    if (!turn) break;
    const option = acted ? undefined : turn.prompt.options.find((o) => o.id.startsWith(`${action}:`) && o.card?.code === code);
    if (option) acted = true;
    g.answer(turn.seat, turn.prompt.id, option ? { choice: option.id } : pass(turn.prompt));
  }
  expect(acted, `the card was never offered for ${action}`).toBe(true);
}

const engines: Array<{ name: string; create: Create; seats: number; needed: () => ReturnType<typeof needs.cards>[] }> = [
  { name: "legacy 1v1 core", create: createLegacyGame as unknown as Create, seats: 2, needed: () => [needs.cards()] },
  { name: "merged engine, stock core", create: createMergedGame, seats: 2, needed: () => [needs.cards(), needs.standard()] },
  { name: "merged engine, multi core (3 seats)", create: createMergedGame, seats: 3, needed: () => [needs.cards(), needs.installedMulti()] },
];

describe.each(engines)("trigger windows: $name", ({ create, seats, needed }) => {
  const list = () => [...needed(), needs.scripts()];

  itWithCores("several optional triggers arrive as one non-forced SELECT_CHAIN", list(), async () => {
    // Three Gorgonic Gargoyles in hand: summoning one (a Rock) lets each of the other two answer from the hand.
    const g = await game(create, [GORGONIC_GARGOYLE, GORGONIC_GARGOYLE, GORGONIC_GARGOYLE], 0, [], seats);
    try {
      play(g, GORGONIC_GARGOYLE, "summon", () => chainWindows().some((w) => w.selects.length > 1), seats);
      const trigger = chainWindows().find((w) => w.selects.length > 1);
      expect(trigger, `no multi-card SELECT_CHAIN window; saw ${describeWindows()}`).toBeDefined();
      expect(trigger!.selects.every((s) => s.code === GORGONIC_GARGOYLE)).toBe(true);
      expect(trigger!.forced).toBe(false);
      expect(trigger!.player).toBe(0);
      // spe_count 0x7f never marked it: the count is the number of listed trigger effects. Off passes it as a plain optional window.
      expect(trigger!.spe_count).toBe(2);
      expect(chainWindows().map((w) => w.spe_count)).not.toContain(0x7f);
    } finally {
      g.close();
    }
  });

  itWithCores("ONE optional trigger is a SELECT_EFFECTYN with description 221, asked outside any resolving link", list(), async () => {
    const g = await game(create, [POKI_DRACO], 2, [], seats);
    try {
      play(g, POKI_DRACO, "summon", () => effectYesNos().length > 0, seats);
      const asked = effectYesNos();
      expect(asked).toHaveLength(1);
      expect(asked[0]!.message.description).toBe(TRIGGER_EFFECT_YN_DESCRIPTION);
      expect(asked[0]!.message.code).toBe(POKI_DRACO);
      expect(asked[0]!.message.player).toBe(0);
      expect(asked[0]!.resolving).toBe(0);
      expect(chainWindows().filter((w) => w.selects.length > 0), `saw ${describeWindows()}`).toEqual([]);
    } finally {
      g.close();
    }
  });

  itWithCores("a script's own effect question mid-resolution is a SELECT_EFFECTYN with the script's description, never 221", list(), async () => {
    const g = await game(create, [ELECTRILYRICAL_WORLD], 0, [appliancer()], seats);
    try {
      play(g, ELECTRILYRICAL_WORLD, "activate", () => effectYesNos().length > 0, seats);
      const asked = effectYesNos();
      expect(asked).toHaveLength(1);
      expect(asked[0]!.message.code).toBe(ELECTRILYRICAL_WORLD);
      expect(asked[0]!.message.description).toBe(95n);
      expect(asked[0]!.message.description).not.toBe(TRIGGER_EFFECT_YN_DESCRIPTION);
      expect(asked[0]!.resolving).toBe(1);
    } finally {
      g.close();
    }
  });

  itWithCores("a lone mandatory trigger is resolved without any prompt", list(), async () => {
    const g = await game(create, [ACHACHA_ARCHER], 0, [], seats);
    try {
      play(g, ACHACHA_ARCHER, "summon", () => g.view(0).seats[1]!.lp < 8000, seats);
      expect(g.view(0).seats[1]!.lp).toBe(7500);
      expect(chainWindows().filter((w) => w.selects.length > 0), `saw ${describeWindows()}`).toEqual([]);
      expect(messageTypes()).not.toContain("SELECT_EFFECTYN");
    } finally {
      g.close();
    }
  });
});
