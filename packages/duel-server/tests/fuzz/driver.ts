import type { DuelAnswer, DuelDeck, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { EngineAnswerError, createEngineGame, type EngineGame } from "../../src/engine.js";
import { planAnswer } from "./answers.js";
import { buildDecks, loadCatalog } from "./card-pool.js";
import type { Scenario } from "./config.js";
import { InvariantChecker, stateHash, viewsHash, type Views, type Violation } from "./invariants.js";
import { Rng, engineSeed } from "./rng.js";
import { firstTurnDrawFor } from "../../src/first-turn-draw.js";

export interface JournalEntry {
  seat: number;
  promptId: string;
  revision: number;
  answer: DuelAnswer;
}

export interface FuzzFailure {
  invariant: string;
  message: string;
  step: number;
  seat?: number;
  prompt?: DuelPrompt;
  detail?: unknown;
}

export interface DuelOutcome {
  scenario: Scenario;
  firstTurnDraw: boolean;
  decks: [DuelDeck, DuelDeck];
  deckNotes: [string, string];
  disjoint: boolean;
  steps: number;
  /** True when the engine reported a result. False means the step cap was reached. */
  ended: boolean;
  result: DuelEngineView["result"];
  journal: JournalEntry[];
  finalHash: string;
  stepHashes: string[];
  failure: FuzzFailure | null;
  softRejections: number;
  promptKinds: Record<string, number>;
  stats: Record<string, number>;
  createMs: number;
  playMs: number;
  checkMs: number;
  turns: number;
}

export interface DuelSetup {
  decks: [DuelDeck, DuelDeck];
  deckNotes: [string, string];
  disjoint: boolean;
  engineSeed: string[];
}

export function setupScenario(scenario: Scenario, dataDirectory: string): DuelSetup {
  const catalog = loadCatalog(dataDirectory);
  const rng = new Rng(scenario.seed);
  const built = buildDecks(catalog, rng.fork(1), scenario.mode);
  return { decks: built.decks, deckNotes: built.notes, disjoint: built.disjoint, engineSeed: engineSeed(scenario.seed) };
}

export function readViews(game: EngineGame): Views {
  return { v0: game.view(0), v1: game.view(1), vs: game.view(null) };
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Play one seeded self-play duel, checking invariants after every step. */
export async function runDuel(scenario: Scenario, dataDirectory: string, options: { collectHashes?: boolean; firstTurnDraw?: boolean } = {}): Promise<DuelOutcome> {
  const catalog = loadCatalog(dataDirectory);
  const setup = setupScenario(scenario, dataDirectory);
  const rng = new Rng(scenario.seed).fork(2);
  const outcome: DuelOutcome = {
    scenario,
    firstTurnDraw: options.firstTurnDraw ?? firstTurnDrawFor(scenario.mode, scenario.masterRule),
    decks: setup.decks,
    deckNotes: setup.deckNotes,
    disjoint: setup.disjoint,
    steps: 0,
    ended: false,
    result: null,
    journal: [],
    finalHash: "",
    stepHashes: [],
    failure: null,
    softRejections: 0,
    promptKinds: {},
    stats: {},
    createMs: 0,
    playMs: 0,
    checkMs: 0,
    turns: 0,
  };
  const fail = (failure: FuzzFailure) => {
    outcome.failure ??= failure;
  };

  const t0 = performance.now();
  let game: EngineGame;
  try {
    game = await createEngineGame({
      mode: scenario.mode,
      firstTurnDraw: outcome.firstTurnDraw,
      masterRule: scenario.masterRule,
      decks: setup.decks,
      seed: setup.engineSeed,
      dataDirectory,
    });
  } catch (error) {
    outcome.createMs = performance.now() - t0;
    fail({ invariant: "engine-create", message: errorText(error), step: 0 });
    return outcome;
  }
  outcome.createMs = performance.now() - t0;

  const checker = new InvariantChecker({ mode: scenario.mode, decks: setup.decks, disjoint: setup.disjoint, catalog });
  const seen = new Map<string, number>();
  let lastHash = "";
  let consecutive = 0;
  let turnActions = 0;
  let lastTurn = 0;
  let toggleSteps = 0;
  const playStart = performance.now();
  let checkTime = 0;

  const check = (step: number, views: Views): boolean => {
    const c0 = performance.now();
    const violations: Violation[] = checker.check(step, views);
    checkTime += performance.now() - c0;
    const first = violations[0];
    if (first) {
      const seat = views.v0.prompt ? 0 : views.v1.prompt ? 1 : undefined;
      const prompt = views.v0.prompt ?? views.v1.prompt ?? undefined;
      fail({
        invariant: first.invariant,
        message: first.message,
        step,
        ...(seat !== undefined ? { seat } : {}),
        ...(prompt ? { prompt } : {}),
        detail: { violations: violations.slice(0, 5), ...(first.detail !== undefined ? {} : {}) },
      });
      return false;
    }
    return true;
  };

  try {
    let views = readViews(game);
    if (!check(0, views)) return finish();
    if (options.collectHashes) outcome.stepHashes.push(viewsHash(views));

    while (outcome.steps < scenario.maxSteps) {
      const result = views.v0.result;
      if (result) {
        outcome.ended = true;
        outcome.result = result;
        break;
      }
      const seat = views.v0.prompt ? 0 : views.v1.prompt ? 1 : -1;
      const prompt = seat === 0 ? views.v0.prompt : seat === 1 ? views.v1.prompt : null;
      if (seat < 0 || !prompt) {
        fail({ invariant: "stuck-no-prompt", message: "No prompt and no result", step: outcome.steps });
        break;
      }
      outcome.promptKinds[prompt.kind] = (outcome.promptKinds[prompt.kind] ?? 0) + 1;
      if (views.v0.turn !== lastTurn) {
        lastTurn = views.v0.turn;
        turnActions = 0;
      }
      toggleSteps = prompt.kind === "toggle" ? toggleSteps + 1 : 0;

      const plan = planAnswer(prompt, { rng, turnActions, toggleSteps, searchCards: (q) => game.searchCards(q) });
      if (plan.candidates.length === 0) {
        fail({ invariant: "no-legal-answer", message: `Driver found no legal answer (${plan.note}) for "${prompt.title}" [${prompt.kind}]`, step: outcome.steps, seat, prompt });
        break;
      }

      const revision = views.v0.revision;
      let accepted: DuelAnswer | null = null;
      let lastError: unknown = null;
      for (let i = 0; i < plan.candidates.length; i++) {
        const candidate = plan.candidates[i] as DuelAnswer;
        try {
          game.answer(seat, prompt.id, candidate);
          accepted = candidate;
          break;
        } catch (error) {
          lastError = error;
          if (!(error instanceof EngineAnswerError)) break;
          outcome.softRejections++;
          if (plan.exact && i === 0) {
            fail({
              invariant: "rejected-legal-answer",
              message: `Engine rejected a legal answer for "${prompt.title}" [${prompt.kind}]: ${error.message}`,
              step: outcome.steps,
              seat,
              prompt,
              detail: { answer: candidate },
            });
            return finish();
          }
          // The prompt must still be pending with the same id after a rejection.
          const again = game.view(seat).prompt;
          if (!again || again.id !== prompt.id) {
            fail({ invariant: "rejection-lost-prompt", message: "Prompt changed or vanished after a rejected answer", step: outcome.steps, seat, prompt });
            return finish();
          }
        }
      }
      if (!accepted) {
        if (lastError instanceof EngineAnswerError) {
          fail({
            invariant: "rejected-all-candidates",
            message: `Engine rejected every candidate (${plan.candidates.length}) for "${prompt.title}" [${prompt.kind}]: ${lastError.message}`,
            step: outcome.steps,
            seat,
            prompt,
            detail: { candidates: plan.candidates },
          });
        } else {
          fail({ invariant: "engine-throw", message: errorText(lastError), step: outcome.steps, seat, prompt, detail: { answer: plan.candidates[0] } });
        }
        break;
      }
      outcome.journal.push({ seat, promptId: prompt.id, revision, answer: accepted });
      outcome.steps++;
      turnActions++;

      views = readViews(game);
      if (!check(outcome.steps, views)) break;
      if (options.collectHashes) outcome.stepHashes.push(viewsHash(views));

      // Progress: the same board state must not repeat forever.
      const hash = stateHash(views);
      consecutive = hash === lastHash ? consecutive + 1 : 0;
      lastHash = hash;
      const total = (seen.get(hash) ?? 0) + 1;
      seen.set(hash, total);
      if (consecutive > 25 || total > 200) {
        fail({
          invariant: "no-progress",
          message: `Board state repeated ${consecutive > 25 ? `${consecutive} times in a row` : `${total} times`} at turn ${views.v0.turn} ${views.v0.phase}`,
          step: outcome.steps,
          ...(views.v0.prompt ? { seat: 0, prompt: views.v0.prompt } : views.v1.prompt ? { seat: 1, prompt: views.v1.prompt } : {}),
        });
        break;
      }
    }
    if (!outcome.failure) {
      const final = readViews(game);
      outcome.ended = final.v0.result !== null;
      outcome.result = final.v0.result;
    }
    const last = readViews(game);
    outcome.turns = last.v0.turn;
    outcome.finalHash = viewsHash(last);
  } catch (error) {
    fail({ invariant: "engine-throw", message: errorText(error), step: outcome.steps });
  }
  return finish();

  function finish(): DuelOutcome {
    outcome.playMs = performance.now() - playStart - checkTime;
    outcome.checkMs = checkTime;
    Object.assign(outcome.stats, checker.stats);
    try {
      if (!outcome.finalHash) outcome.finalHash = viewsHash(readViews(game));
    } catch {
      // Ignore: the engine may be in a failed state.
    }
    try {
      game.close();
    } catch {
      // Ignore.
    }
    return outcome;
  }
}
