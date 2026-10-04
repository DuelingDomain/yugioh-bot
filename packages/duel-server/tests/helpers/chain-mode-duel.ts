// Real-card duels for the chain response switch tests: seat 0 holds a chosen opening hand, nothing is shuffled.
import Database from "better-sqlite3";
import type { DuelAnswer, DuelEngineView, DuelPrompt, DuelSettings } from "@yugidraft/shared/duels";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { createEngineGame as createMergedGame, type EngineGame } from "../../src/engine.js";
import { createEngineGame as createLegacyGame } from "../../src/legacy/engine.js";
import { choosePracticeBotAnswer } from "../../src/practice-bot.js";
import { engineDataDirectory } from "../engine-data-dir.js";
import { needs } from "../support/cores.js";

export const POKI_DRACO = 8175346; // optional lone trigger on Normal Summon (needs a copy in the deck)
export const GORGONIC_GARGOYLE = 64379261; // optional trigger from the hand when a Rock is Normal Summoned
export const ACHACHA_ARCHER = 98865920; // mandatory trigger on Normal Summon, 500 damage
export const ELECTRILYRICAL_WORLD = 3875465; // field spell; asks Duel.SelectEffectYesNo(tp, handler, 95) mid-resolution

export type Create = typeof createMergedGame;

export function fillers(): number[] {
  const db = new Database(`${engineDataDirectory}/cards.cdb`, { readonly: true });
  try {
    return (db.prepare("select id from datas where type = 17 and alias = 0 and (ot & 3) != 0 and level between 5 and 8 order by id limit 40")
      .all() as { id: number }[]).map((row) => row.id);
  } finally {
    db.close();
  }
}

/** An Appliancer main-deck monster, which Electrilyrical World's Activate asks to search. */
export function appliancer(): number {
  const db = new Database(`${engineDataDirectory}/cards.cdb`, { readonly: true });
  try {
    return (db.prepare("select id from datas where ((setcode & 65535) = 330 or ((setcode >> 16) & 65535) = 330) and type = 33 limit 1").get() as { id: number }).id;
  } finally {
    db.close();
  }
}

export interface GameSpec {
  /** Seat 0's opening hand (topped up with fillers to five cards). */
  hand: number[];
  deckCopies?: number;
  deckTop?: number[];
  seats?: 2 | 3;
  settings?: Partial<DuelSettings>;
}

/** Seat 0's opening hand is `hand`; `deckTop` and `deckCopies` of `hand[0]` follow. Nothing is shuffled. */
export async function game(create: Create, spec: GameSpec): Promise<EngineGame> {
  const pool = fillers();
  const seats = spec.seats ?? 2;
  const first = [...spec.hand, ...pool.slice(0, 5 - spec.hand.length), ...(spec.deckTop ?? []), ...Array.from({ length: spec.deckCopies ?? 0 }, () => spec.hand[0]!)];
  const decks = [
    { main: [...first, ...pool.slice(0, 40 - first.length)], extra: [], side: [] },
    ...Array.from({ length: seats - 1 }, () => ({ main: pool.slice(0, 40), extra: [], side: [] })),
  ];
  return create({
    mode: "normal", ...(seats === 3 ? { format: "ffa3" as const } : {}), decks,
    seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    settings: { ...defaultDuelSettings("normal"), validateDeck: false, shuffleDeck: false, stopAtEveryWindow: true, ...spec.settings },
  });
}

export function waiting(g: EngineGame, seats = 2): { seat: number; view: DuelEngineView; prompt: DuelPrompt } | null {
  for (let seat = 0; seat < seats; seat += 1) {
    const view = g.view(seat);
    if (view.prompt) return { seat, view, prompt: view.prompt };
  }
  return null;
}

export function pass(prompt: DuelPrompt): DuelAnswer {
  if (prompt.cancelable) return { cancel: true };
  if (prompt.options.some((option) => option.id === "no")) return { choice: "no" };
  if (prompt.options.some((option) => option.id === "to_ep")) return { choice: "to_ep" };
  return choosePracticeBotAnswer(prompt);
}

export type Turn = NonNullable<ReturnType<typeof waiting>>;
export const isTriggerQuestion = (turn: Turn) => turn.prompt.options.some((o) => o.id === "yes") && turn.prompt.options.some((o) => o.id === "no");
export const isMainPhaseMenu = (turn: Turn) => turn.prompt.options.some((o) => o.id === "to_ep");

/**
 * Normal Summon (or activate) `code` when it is offered, then answer every other prompt by passing until `until`
 * accepts the prompt that is waiting. Returns that prompt; the game is left with it open.
 */
export function act(g: EngineGame, code: number, action: "summon" | "activate", until: (turn: Turn) => boolean, seats = 2): Turn {
  let acted = false;
  for (let step = 0; step < 60; step += 1) {
    const turn = waiting(g, seats);
    if (!turn) break;
    if (acted && until(turn)) return turn;
    const option = acted ? undefined : turn.prompt.options.find((o) => o.id.startsWith(`${action}:`) && o.card?.code === code);
    if (option) acted = true;
    g.answer(turn.seat, turn.prompt.id, option ? { choice: option.id } : pass(turn.prompt));
  }
  throw new Error(acted ? `No prompt satisfied the condition after ${action} of ${code}` : `The card ${code} was never offered for ${action}`);
}

export const engines: Array<{ name: string; create: Create; seats: 2 | 3; needed: () => ReturnType<typeof needs.cards>[] }> = [
  { name: "legacy 1v1 engine", create: createLegacyGame as unknown as Create, seats: 2, needed: () => [needs.cards()] },
  { name: "merged engine, stock core", create: createMergedGame, seats: 2, needed: () => [needs.cards(), needs.standard()] },
  { name: "merged engine, multi core (3 seats)", create: createMergedGame, seats: 3, needed: () => [needs.cards(), needs.installedMulti()] },
];
