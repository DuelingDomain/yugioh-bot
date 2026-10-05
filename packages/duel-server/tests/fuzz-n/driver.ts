import type { DuelAnswer, DuelDeck, DuelEngineView, DuelFormat, DuelMasterRule, DuelMode, DuelPrompt } from "@yugidraft/shared/duels";
import { seatCountFor } from "@yugidraft/shared/duels";
import { EngineAnswerError, createEngineGame, type EngineDiagnostic, type EngineGame } from "../../src/engine.js";
import { planAnswer } from "../fuzz/answers.js";
import { loadCatalog } from "../fuzz/card-pool.js";
import { Rng, engineSeed } from "../fuzz/rng.js";
import { NChecker, nStateHash, nViewsHash, promptSeats, type DiagnosticEntry, type NViews } from "./invariants.js";
import { buildSeatDecks } from "./decks.js";
import { firstTurnDrawFor } from "../../src/first-turn-draw.js";

export interface NScenario {
  format: DuelFormat;
  seed: number;
  mode: DuelMode;
  masterRule: DuelMasterRule;
  maxSteps: number;
  /** Chance (0..1) that the duel injects host eliminations (surrender, time loss). Seats > 2 only. */
  eliminateRate: number;
}

export type JournalItem =
  | { kind: "answer"; seat: number; promptId: string; revision: number; answer: DuelAnswer }
  | { kind: "eliminate"; seat: number; reason: number; revision: number };

export interface NFailure {
  invariant: string;
  message: string;
  step: number;
  seat?: number;
  prompt?: DuelPrompt;
  detail?: unknown;
  /** The answer or elimination that was in progress (a hang or throw happens inside it). */
  pending?: JournalItem | undefined;
}

export interface NOutcome {
  scenario: NScenario;
  firstTurnDraw: boolean;
  decks: DuelDeck[];
  deckNotes: string[];
  disjoint: boolean;
  steps: number;
  /** `ended`: the engine reported a result. `budget`: the step budget ended a healthy duel. `failed`: see `failure`. */
  status: "ended" | "budget" | "failed";
  result: DuelEngineView["result"];
  journal: JournalItem[];
  finalHash: string;
  failure: NFailure | null;
  softRejections: number;
  promptKinds: Record<string, number>;
  stats: Record<string, number>;
  turns: number;
  eliminations: number;
  diagnostics: EngineDiagnostic[];
}

export interface DriverHooks {
  /** Called before every engine call that may hang. The last record is the one that hung. */
  onPending?(item: JournalItem, prompt: DuelPrompt | null, step: number): void;
  /** Called after an accepted action. */
  onJournal?(item: JournalItem): void;
}

export interface DuelSetup {
  decks: DuelDeck[];
  deckNotes: string[];
  disjoint: boolean;
  engineSeed: string[];
}

export function setupScenario(scenario: NScenario, dataDirectory: string): DuelSetup {
  const catalog = loadCatalog(dataDirectory);
  const rng = new Rng(scenario.seed);
  const built = buildSeatDecks(catalog, rng.fork(1), scenario.mode, seatCountFor(scenario.format));
  return { decks: built.decks, deckNotes: built.notes, disjoint: built.disjoint, engineSeed: engineSeed(scenario.seed) };
}

export function readViews(game: EngineGame, seatCount: number): NViews {
  const seats: DuelEngineView[] = [];
  for (let seat = 0; seat < seatCount; seat++) seats.push(game.view(seat));
  return { seats, spectator: game.view(null) };
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** The entries of `current` (oldest first ring buffer) that are not in `previous` yet. */
export function newDiagnostics(previous: readonly DiagnosticEntry[], current: readonly DiagnosticEntry[]): DiagnosticEntry[] {
  const same = (a: DiagnosticEntry, b: DiagnosticEntry) => a.turn === b.turn && a.phase === b.phase && a.kind === b.kind && a.seat === b.seat && a.detail === b.detail;
  // The ring drops old entries from the front: find the longest tail of `previous` that is a head of `current`.
  for (let drop = 0; drop <= previous.length; drop++) {
    const kept = previous.length - drop;
    if (kept > current.length) continue;
    let ok = true;
    for (let i = 0; i < kept; i++) {
      if (!same(previous[drop + i]!, current[i]!)) {
        ok = false;
        break;
      }
    }
    if (ok) return current.slice(kept);
  }
  return current.slice();
}

/** Steps without a new turn number before the duel counts as stuck inside one turn. */
export const TURN_STALL_STEPS = 400;

/** Host eliminations scheduled for one duel: `[step, seat, reason]`. Empty at two seats. Separate RNG stream, so the play is unchanged. */
export function eliminationSchedule(scenario: NScenario): Array<{ step: number; seat: number; reason: number }> {
  const seats = seatCountFor(scenario.format);
  if (seats <= 2 || scenario.eliminateRate <= 0) return [];
  const rng = new Rng(scenario.seed).fork(3);
  if (!rng.chance(scenario.eliminateRate)) return [];
  // FFA: up to seats - 2 duelists leave, so the duel can still end with a winner. Tag: one team member (the team goes).
  const count = scenario.format === "tag" ? 1 : rng.range(1, seats - 2);
  const order = rng.shuffle(Array.from({ length: seats }, (_, seat) => seat));
  const low = Math.max(5, Math.floor(scenario.maxSteps * 0.05));
  const high = Math.max(low + 1, Math.floor(scenario.maxSteps * 0.6));
  return order.slice(0, count).map((seat) => ({ step: rng.range(low, high), seat, reason: rng.chance(0.5) ? 0 : 3 })).sort((a, b) => a.step - b.step);
}

export interface PlayOptions {
  dataDirectory: string;
  firstTurnDraw?: boolean;
  /** The multi-duelist wasm for formats with more than two seats. Undefined: the engine reads it from the data directory. */
  multiWasmBinary?: ArrayBuffer;
  hooks?: DriverHooks;
  /** Replay: answer from this journal instead of playing random moves. The last `pending` item is tried at the end. */
  script?: { journal: JournalItem[]; pending?: JournalItem | undefined };
}

/** Play one seeded duel at 2, 3 or 4 seats, checking the named invariants after every step. */
export async function playDuel(scenario: NScenario, options: PlayOptions): Promise<NOutcome> {
  const { dataDirectory } = options;
  const seatCount = seatCountFor(scenario.format);
  const setup = setupScenario(scenario, dataDirectory);
  const rng = new Rng(scenario.seed).fork(2);
  const schedule = options.script ? [] : eliminationSchedule(scenario);
  const outcome: NOutcome = {
    scenario,
    firstTurnDraw: options.firstTurnDraw ?? firstTurnDrawFor(scenario.mode, scenario.masterRule, scenario.format),
    decks: setup.decks,
    deckNotes: setup.deckNotes,
    disjoint: setup.disjoint,
    steps: 0,
    status: "failed",
    result: null,
    journal: [],
    finalHash: "",
    failure: null,
    softRejections: 0,
    promptKinds: {},
    stats: {},
    turns: 0,
    eliminations: 0,
    diagnostics: [],
  };
  const fail = (failure: NFailure) => {
    outcome.failure ??= failure;
  };
  const hooks = options.hooks ?? {};

  let game: EngineGame;
  try {
    game = await createEngineGame({
      mode: scenario.mode,
      firstTurnDraw: outcome.firstTurnDraw,
      masterRule: scenario.masterRule,
      decks: setup.decks,
      seed: setup.engineSeed,
      dataDirectory,
      ...(scenario.format !== "1v1" ? { format: scenario.format } : {}),
      ...(options.multiWasmBinary && seatCount > 2 ? { multiWasmBinary: options.multiWasmBinary } : {}),
    });
  } catch (error) {
    fail({ invariant: "engine-throw", message: `create: ${errorText(error)}`, step: 0 });
    return outcome;
  }

  const checker = new NChecker(scenario.format);
  const seen = new Map<string, number>();
  let lastHash = "";
  let consecutive = 0;
  let turnActions = 0;
  let lastTurn = 0;
  let stallFrom = 0;
  let toggleSteps = 0;
  let eliminateSupported = true;
  let scriptAt = 0;

  let diagSnapshot: DiagnosticEntry[] = [];
  let previousMasters: Array<{ inZone: boolean; returns: number } | null> = [];
  const check = (step: number, views: NViews): boolean => {
    if (scenario.mode === "domain") {
      const currentMasters = views.spectator.seats.map((seat) => seat.deckMaster ?? null);
      if (step === 0) outcome.stats["domain-masters"] = currentMasters.filter(Boolean).length;
      currentMasters.forEach((master, seat) => {
        const previous = previousMasters[seat];
        if (!master || !previous || views.spectator.seats[seat]!.eliminated) return;
        if (previous.inZone && !master.inZone) {
          const key = `domain-leaves-seat-${seat}`;
          outcome.stats[key] = (outcome.stats[key] ?? 0) + 1;
        }
        if (master.returns > previous.returns) {
          const key = `domain-returns-seat-${seat}`;
          outcome.stats[key] = (outcome.stats[key] ?? 0) + master.returns - previous.returns;
        }
      });
      previousMasters = currentMasters.map((master) => master ? { inZone: master.inZone, returns: master.returns } : null);
    }
    let fresh: DiagnosticEntry[] | undefined;
    if (typeof game.diagnostics === "function") {
      const current = game.diagnostics();
      fresh = newDiagnostics(diagSnapshot, current);
      diagSnapshot = current;
    }
    const violations = checker.check(step, views, fresh);
    const first = violations[0];
    if (!first) return true;
    const seat = promptSeats(views)[0];
    const prompt = seat !== undefined ? (views.seats[seat]!.prompt ?? undefined) : undefined;
    fail({
      invariant: first.invariant,
      message: first.message,
      step,
      ...(seat !== undefined ? { seat } : {}),
      ...(prompt ? { prompt } : {}),
      detail: { violations: violations.slice(0, 5) },
    });
    return false;
  };

  try {
    let views = readViews(game, seatCount);
    if (!check(0, views)) return finish();

    while (outcome.steps < scenario.maxSteps || options.script) {
      const result = views.spectator.result;
      if (result) {
        outcome.result = result;
        outcome.status = "ended";
        break;
      }
      const waiting = promptSeats(views);
      const seat = waiting[0] ?? -1;
      const prompt = seat >= 0 ? views.seats[seat]!.prompt : null;
      if (seat < 0 || !prompt) {
        if (options.script && scriptAt >= options.script.journal.length && !options.script.pending) break;
        fail({ invariant: "hang", message: "stuck-no-prompt: no prompt and no result", step: outcome.steps, detail: { kind: "stuck-no-prompt", turn: views.spectator.turn, phase: views.spectator.phase } });
        break;
      }
      outcome.promptKinds[prompt.kind] = (outcome.promptKinds[prompt.kind] ?? 0) + 1;
      if (views.spectator.turn !== lastTurn) {
        lastTurn = views.spectator.turn;
        turnActions = 0;
        stallFrom = outcome.steps;
      }
      toggleSteps = prompt.kind === "toggle" ? toggleSteps + 1 : 0;

      // Injected host elimination (live play) or the next journal item (replay).
      let scripted: JournalItem | null = null;
      if (options.script) {
        if (scriptAt < options.script.journal.length) scripted = options.script.journal[scriptAt++]!;
        else if (options.script.pending) {
          scripted = options.script.pending;
          options.script = { journal: options.script.journal };
        } else break;
      } else if (eliminateSupported && schedule.length > 0 && outcome.steps >= schedule[0]!.step) {
        const due = schedule.shift()!;
        scripted = { kind: "eliminate", seat: due.seat, reason: due.reason, revision: views.spectator.revision };
      }

      if (scripted?.kind === "eliminate") {
        if (views.spectator.seats[scripted.seat]?.eliminated) continue;
        hooks.onPending?.(scripted, prompt, outcome.steps);
        try {
          game.eliminate(scripted.seat, scripted.reason);
        } catch (error) {
          if (error instanceof EngineAnswerError) continue;
          if (/no Debug\.EliminateDuelist/.test(errorText(error))) {
            eliminateSupported = false;
            outcome.stats["eliminate-unsupported"] = 1;
            continue;
          }
          fail({ invariant: "engine-throw", message: `eliminate seat ${scripted.seat}: ${errorText(error)}`, step: outcome.steps, pending: scripted });
          break;
        }
        outcome.journal.push(scripted);
        hooks.onJournal?.(scripted);
        outcome.eliminations++;
        outcome.steps++;
        views = readViews(game, seatCount);
        if (!check(outcome.steps, views)) break;
        continue;
      }

      // A legal optional effect may resolve with no change and remain usable
      // in the next chain. At n > 2, let all seats pass before classifying this
      // as a stalled engine. Replay and the legacy two-seat policy stay exact.
      const passRepeatedChain = !scripted && seatCount > 2 && consecutive >= 8 &&
        prompt.context?.type === "chain" && !prompt.context.forced && prompt.cancelable;
      if (passRepeatedChain) outcome.stats["chain-stall-passes"] = (outcome.stats["chain-stall-passes"] ?? 0) + 1;
      const plan = scripted
        ? { candidates: [scripted.answer], exact: false, note: "journal" }
        : passRepeatedChain
          ? { candidates: [{ cancel: true }], exact: true, note: "chain-stall-pass" }
        : planAnswer(prompt, {
            rng,
            turnActions,
            toggleSteps,
            searchCards: (q) => game.searchCards(q),
            living: views.spectator.seats.filter((view) => !view.eliminated).map((view) => view.seat),
          });
      if (plan.candidates.length === 0) {
        fail({ invariant: "no-legal-answer", message: `Driver found no legal answer (${plan.note}) for "${prompt.title}" [${prompt.kind}]`, step: outcome.steps, seat, prompt });
        break;
      }

      const revision = views.spectator.revision;
      let accepted: DuelAnswer | null = null;
      let lastError: unknown = null;
      for (let i = 0; i < plan.candidates.length; i++) {
        const candidate = plan.candidates[i] as DuelAnswer;
        hooks.onPending?.({ kind: "answer", seat, promptId: prompt.id, revision, answer: candidate }, prompt, outcome.steps);
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
          const again = game.view(seat).prompt;
          if (!again || again.id !== prompt.id) {
            fail({ invariant: "rejection-lost-prompt", message: "Prompt changed or vanished after a rejected answer", step: outcome.steps, seat, prompt });
            return finish();
          }
        }
      }
      if (!accepted) {
        const pending: JournalItem = { kind: "answer", seat, promptId: prompt.id, revision, answer: plan.candidates[0] as DuelAnswer };
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
          fail({ invariant: "engine-throw", message: errorText(lastError), step: outcome.steps, seat, prompt, pending });
        }
        break;
      }
      const item: JournalItem = { kind: "answer", seat, promptId: prompt.id, revision, answer: accepted };
      outcome.journal.push(item);
      hooks.onJournal?.(item);
      outcome.steps++;
      turnActions++;

      views = readViews(game, seatCount);
      if (!check(outcome.steps, views)) break;

      // Progress: the same board state must not repeat forever, and a turn must not last forever.
      const hash = nStateHash(views);
      consecutive = hash === lastHash ? consecutive + 1 : 0;
      lastHash = hash;
      const total = (seen.get(hash) ?? 0) + 1;
      seen.set(hash, total);
      const here = promptSeats(views)[0];
      const herePrompt = here !== undefined ? views.seats[here]!.prompt : null;
      const hangDetail = { turn: views.spectator.turn, phase: views.spectator.phase, turnSeat: views.spectator.turnSeat, waitingSeat: here ?? null, lastPrompt: herePrompt?.title ?? null };
      if (consecutive > 25 || total > 200) {
        fail({
          invariant: "hang",
          message: `no-progress: board state repeated ${consecutive > 25 ? `${consecutive} times in a row` : `${total} times`} at turn ${views.spectator.turn} ${views.spectator.phase}, waiting seat ${here ?? "none"}`,
          step: outcome.steps,
          ...(here !== undefined && herePrompt ? { seat: here, prompt: herePrompt } : {}),
          detail: { kind: "no-progress", ...hangDetail },
        });
        break;
      }
      if (outcome.steps - stallFrom > TURN_STALL_STEPS) {
        fail({
          invariant: "hang",
          message: `turn-stall: ${outcome.steps - stallFrom} steps inside turn ${views.spectator.turn} ${views.spectator.phase}, waiting seat ${here ?? "none"}`,
          step: outcome.steps,
          ...(here !== undefined && herePrompt ? { seat: here, prompt: herePrompt } : {}),
          detail: { kind: "turn-stall", ...hangDetail },
        });
        break;
      }
    }
    if (!outcome.failure) {
      const final = readViews(game, seatCount);
      outcome.result = final.spectator.result;
      outcome.status = final.spectator.result ? "ended" : "budget";
    }
    outcome.turns = readViews(game, seatCount).spectator.turn;
  } catch (error) {
    fail({ invariant: "engine-throw", message: errorText(error), step: outcome.steps });
  }
  return finish();

  function finish(): NOutcome {
    Object.assign(outcome.stats, checker.stats);
    if (outcome.failure) outcome.status = "failed";
    try {
      outcome.finalHash = nViewsHash(readViews(game, seatCount));
    } catch {
      // The engine may be in a failed state.
    }
    try {
      outcome.diagnostics = game.diagnostics?.().slice(-40) ?? [];
    } catch {
      // Ignore.
    }
    try {
      game.close();
    } catch {
      // Ignore.
    }
    return outcome;
  }
}
