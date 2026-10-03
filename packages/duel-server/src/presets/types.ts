import type { DuelFormat } from "@yugidraft/shared/duels";
import type { Rule } from "../scripted-bot.js";
import type { BoardSpec } from "./board.js";

/**
 * A hand scenario. The human plays seat 0. A scripted bot plays every other seat with its ordered rules
 * (`bots[seat]`, an empty list = the bot only passes). `board` is compiled to startup scripts and decks
 * (see `compileBoard`). `checklist` is what the tester must see, in order. `rules` are the ADR-0002 rule ids
 * the scenario covers (scripts/rule-coverage.ts reads the literal array).
 */
export interface Preset {
  id: string;
  title: string;
  format: DuelFormat;
  humanSeat: 0;
  board: BoardSpec;
  bots: Record<number, Rule[]>;
  checklist: string[];
  rules: string[];
  /** "multi-core": the preset needs the multi-duelist core (more than two seats). */
  needs?: "multi-core";
}

/** True when a chain is open. Keeps a bot from using a card in an empty chain window (for example the Draw Phase). */
export const onChain = (_prompt: unknown, view: { chain: unknown[] }): boolean => view.chain.length > 0;
