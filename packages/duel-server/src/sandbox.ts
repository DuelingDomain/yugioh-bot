import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { multiplayerSeatsBlockReason, multiplayerTablesEnabled, parseSandboxRun, SandboxBoardError,
  seatCountFor, type DuelAnswer, type DuelEngineView, type DuelPrompt, type SandboxRun } from "@yugidraft/shared/duels";
import type { DuelService } from "@yugidraft/shared/services";
import { defaultAnswer } from "./scripted-bot.js";
import { botTableOf } from "./practice-bot.js";
import { multiStartProblem } from "./multi-domain-guard.js";
import { multiCoreAvailable } from "./presets/index.js";
import { validateRuntimeBoard } from "./presets/runtime-board.js";
import { mergeRevealedHands, policiesForRun, resolveActingSeat } from "./sandbox-seats.js";
import type { DuelGameWorker } from "./worker-client.js";

type DuelSetup = NonNullable<ReturnType<DuelService["privateState"]>["setup"]>;
type SandboxInfo = NonNullable<DuelSetup["sandbox"]>;

export class SandboxError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SandboxError";
  }
}

/** Shared authorization for info/restart and the seat-control hooks. No environment gate: web checks admin. */
export function requireSandboxOwner(service: DuelService, slug: string, guildId: string, actor: number): void {
  const session = service.get(slug, guildId);
  if (!session.sandbox) throw new SandboxError("This action requires a sandbox duel", 409);
  if (session.organizerPlayerId !== actor) throw new SandboxError("Only the sandbox organizer can access this duel", 403);
}

/**
 * Runtime board ops. The host serializes start/restart by actor, and cancellation by duel slug.
 * Worker creation and registration stay in the host so its normal journal, bot and cleanup paths apply.
 */
export function createSandboxOps(options: {
  db: Database.Database;
  service: DuelService;
  dataDirectory: string;
  now: () => number;
  enqueue<T>(slug: string, work: () => Promise<T>): Promise<T>;
  launch: (slug: string, guildId: string, actor: number, seed: string[], setup: DuelSetup) => Promise<void>;
  cancel: (slug: string, guildId: string, actor: number) => Promise<void>;
}) {
  const { service } = options;
  const starts = new Map<number, number[]>();

  function reserveStart(actor: number): void {
    const cutoff = options.now() - 60_000;
    for (const [player, times] of starts) {
      const recent = times.filter((time) => time > cutoff);
      if (recent.length) starts.set(player, recent);
      else starts.delete(player);
    }
    const recent = starts.get(actor) ?? [];
    if (recent.length >= 10) throw new SandboxError("Use at most 10 sandbox starts per minute", 429);
    starts.set(actor, [...recent, options.now()]);
  }

  function info(slug: string, guildId: string, actor: number): SandboxInfo {
    requireSandboxOwner(service, slug, guildId, actor);
    const sandbox = service.privateState(slug, guildId).setup?.sandbox;
    if (!sandbox) throw new SandboxError("This duel has no saved sandbox board", 409);
    return sandbox;
  }

  async function trimActive(guildId: string, actor: number): Promise<void> {
    const active = options.db.prepare<[string, number], { web_slug: string }>(`
      select web_slug from duels where guild_id = ? and organizer_player_id = ?
        and sandbox = 1 and status = 'active' order by id desc
    `).all(guildId, actor);
    for (const row of active.slice(3)) await options.cancel(row.web_slug, guildId, actor);
  }

  async function start(body: Record<string, unknown>, guildId: string, actor: number, replacing?: string): Promise<{ slug: string }> {
    const validated = validateRuntimeBoard(body.board, options.dataDirectory);
    if (!validated.ok) throw new SandboxError(validated.errors.map((error) => `${error.path}: ${error.message}`).join("; "), 400);
    let run: SandboxRun;
    try {
      run = parseSandboxRun(body.run);
    } catch (error) {
      if (error instanceof SandboxBoardError) throw new SandboxError(`${error.path}: ${error.message}`, 400);
      throw error;
    }
    const scenarioId = body.scenarioId;
    if (scenarioId !== undefined && (typeof scenarioId !== "number" || !Number.isSafeInteger(scenarioId) || scenarioId < 1)) {
      throw new SandboxError("scenarioId must be a positive integer", 400);
    }
    const { board, compiled } = validated;
    const copts = compiled.options;
    const format = board.format ?? "1v1";
    const count = seatCountFor(format);
    const blocked = multiplayerSeatsBlockReason(count, multiplayerTablesEnabled());
    if (blocked) throw new SandboxError(blocked, 403);
    if (count > 2 && !multiCoreAvailable(options.dataDirectory)) {
      throw new SandboxError("This sandbox needs the multi-duelist engine core, which is not installed on this server yet.", 409);
    }
    const coreProblem = multiStartProblem(copts.mode ?? "normal", format, options.dataDirectory);
    if (coreProblem) throw new SandboxError(coreProblem, 409);
    reserveStart(actor);
    // Each seed word must be nonzero. Save random seeds in the run as well as seed_json.
    const seed = run.seed ?? Array.from({ length: 4 }, () => (randomBytes(8).readBigUInt64LE() || 1n).toString()) as NonNullable<SandboxRun["seed"]>;
    run = { ...run, seed };
    const sandbox: SandboxInfo = { board, run, ...(scenarioId !== undefined ? { scenarioId } : {}) };
    const { slug } = service.create({ guildId, organizerPlayerId: actor, name: "Duelists Kingdom Sandbox",
      mode: copts.mode ?? "normal", masterRule: copts.masterRule, format, sandbox: true, ranked: false, bestOf: 1,
      settings: { ...copts.settings, turnSeconds: 0, visibility: "private" } });
    try {
      service.setDeck(slug, guildId, actor, copts.decks[0]!);
      for (let seat = 1; seat < count; seat++) service.addPracticeBot(slug, guildId, actor, copts.decks[seat]!, seat);
      await options.launch(slug, guildId, actor, seed, {
        sandbox, startupScripts: [...(copts.startupScripts ?? []).map((script) => script.content), SANDBOX_PHASE_WINDOWS],
        firstTurnDraw: copts.firstTurnDraw ?? true,
        ...(format === "1v1" ? { engine: "pinned" as const } : {}),
      });
    } catch (error) {
      await options.cancel(slug, guildId, actor);
      throw error;
    }
    // Cancel only after the replacement starts. A failed create must leave the old board usable.
    if (replacing) await options.cancel(replacing, guildId, actor);
    await trimActive(guildId, actor);
    return { slug };
  }

  return {
    validate(board: unknown) {
      const { ok, errors, codes } = validateRuntimeBoard(board, options.dataDirectory);
      return { ok, errors, codes };
    },
    start,
    info,
    async restart(slug: string, guildId: string, actor: number) {
      // Finish earlier seat-control commands before copying the current run. Release the old
      // slug before starting the new one; start/cancel always acquire actor then duel locks.
      const input = await options.enqueue(slug, async () => {
        const saved = info(slug, guildId, actor);
        const seed = service.privateState(slug, guildId).seed;
        if (!seed) throw new SandboxError("This sandbox has no saved seed", 409);
        return { ...saved, run: { ...saved.run, seed } };
      });
      return start(input, guildId, actor, slug);
    },
  };
}

export const SANDBOX_PHASE_WALK_NOTE = "sandbox: phase walk";

export interface SandboxViewOptions { as?: unknown; reveal?: unknown }

/** Project the selected seat's saved deck and final snapshot without exposing other prompts. */
export function prepareSandboxRoom(db: Database.Database, service: DuelService,
  room: ReturnType<DuelService["room"]>, playerId: number, sandboxView: SandboxViewOptions, live: boolean): void {
  const { slug, guildId } = room.session;
  requireSandboxOwner(service, slug, guildId, playerId);
  const saved = service.privateState(slug, guildId);
  const info = saved.setup?.sandbox;
  const manualSeats = info ? policiesForRun(info.run, room.session.format).manualSeats : new Set<number>();
  room.mySeat = resolveActingSeat({ ...room.session, actor: playerId, mySeat: room.mySeat, manualSeats, as: sandboxView.as });
  room.myDeck = saved.decks[room.mySeat!] ?? null;
  // Keep builder and control metadata on the room for the sandbox toolbar.
  Object.assign(room, { sandbox: info });
  if (!live) {
    const snapshots = db.prepare<[string, string], {
      snapshot_seat0_json: string | null; snapshot_seat1_json: string | null; snapshot_seats_json: string | null;
    }>("select snapshot_seat0_json, snapshot_seat1_json, snapshot_seats_json from duels where web_slug = ? and guild_id = ?").get(slug, guildId);
    const views = snapshots?.snapshot_seats_json ? JSON.parse(snapshots.snapshot_seats_json) as Array<DuelEngineView | null> : [];
    for (const [seat, json] of [[0, snapshots?.snapshot_seat0_json], [1, snapshots?.snapshot_seat1_json]] as const) {
      if (!views[seat] && json) views[seat] = JSON.parse(json) as DuelEngineView;
    }
    room.engine = views[room.mySeat!] ?? null;
    if (room.engine && sandboxView.reveal === true) room.engine = mergeRevealedHands(room.engine,
      new Map(views.flatMap((view, seat) => view ? [[seat, view] as const] : [])));
  }
}

/** Persist first; the host then installs fresh policies and wakes the bot loop. */
export function setSandboxControl(service: DuelService, slug: string, guildId: string, actor: number,
  seat: unknown, control: unknown) {
  requireSandboxOwner(service, slug, guildId, actor);
  const state = service.privateState(slug, guildId);
  if (state.session.status !== "active" || !state.setup?.sandbox) throw new SandboxError("This sandbox is not active", 409);
  if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 1 || seat >= seatCountFor(state.session.format)) {
    throw new SandboxError("Choose a bot seat in this duel", 400);
  }
  if (control !== "pass" && control !== "practice" && control !== "manual") throw new SandboxError("Choose pass, practice, or manual", 400);
  const run = { ...state.setup.sandbox.run, bots: { ...state.setup.sandbox.run.bots, [seat]: control } };
  service.setSetup(slug, guildId, { ...state.setup, sandbox: { ...state.setup.sandbox, run } });
  return run;
}

// The worker passes empty chain windows internally. A read-only global phase hook
// gives it a real engine prompt at each boundary, even on an empty board. The
// answer has no game effect. Saved startup Lua makes recovery/replay deterministic.
const PHASE_MARKER = 0x53425800;
const SANDBOX_PHASE_WINDOWS = `
do
  for _,phase in ipairs({PHASE_DRAW,PHASE_STANDBY,PHASE_MAIN1,PHASE_BATTLE_START,PHASE_MAIN2,PHASE_END}) do
    local e=Effect.GlobalEffect()
    e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
    e:SetCode(EVENT_PHASE+phase)
    e:SetCountLimit(1)
    e:SetOperation(function() Duel.AnnounceNumber(Duel.GetTurnPlayer(),${PHASE_MARKER}) end)
    Duel.RegisterEffect(e,0)
  end
end`;

export function isSandboxPhaseWindow(prompt: DuelPrompt | null): boolean {
  return prompt?.kind === "choice" && prompt.options.length === 1 && prompt.options[0]?.id === "num:0"
    && prompt.options[0]?.values?.[0] === PHASE_MARKER;
}

/** Keep the engine's prompt/answer IDs; give the no-op boundary a useful label. */
export function projectSandboxPhaseWindow(view: DuelEngineView) {
  if (!isSandboxPhaseWindow(view.prompt)) return view;
  return { ...view, prompt: { ...view.prompt!, title: "Continue this phase", source: undefined,
    options: [{ id: "num:0", label: "Continue" }] } };
}

const PHASES = ["draw", "standby", "main1", "battle", "main2", "end"] as const;
export type SandboxPhase = Exclude<typeof PHASES[number], "draw">;
export function sandboxPhase(value: unknown): SandboxPhase {
  if (typeof value !== "string" || !(PHASES.slice(1) as readonly string[]).includes(value)) {
    throw new SandboxError("Choose standby, main1, battle, main2, or end", 400);
  }
  return value as SandboxPhase;
}

/** One bounded walk. Each accepted answer uses the host's normal journal path. */
export async function walkSandboxPhases(options: {
  game: DuelGameWorker;
  manualSeats: ReadonlySet<number>;
  actingSeat: number;
  to?: SandboxPhase;
  answer: (seat: number, view: DuelEngineView,
    answer: DuelAnswer) => Promise<void>;
}): Promise<void> {
  const { game, to } = options;
  const first = await game.view(options.actingSeat);
  for (let step = 0; step < 128; step++) {
    const view = await game.view(options.actingSeat);
    const phase = view.phase.startsWith("battle") || view.phase.startsWith("damage") ? "battle" : view.phase;
    if (view.result || view.turn !== first.turn || (to !== undefined && phase === to)) return;
    // A phase command never silently rolls into the next turn or skips a requested phase.
    if (to !== undefined && PHASES.indexOf(phase as typeof PHASES[number]) > PHASES.indexOf(to)) return;
    const seat = view.prioritySeat;
    if (seat === null || seat === undefined) return;
    const own = seat === options.actingSeat ? view : await game.view(seat);
    const prompt = own.prompt;
    if (!prompt) return;
    const manual = options.manualSeats.has(seat);
    const boundary = isSandboxPhaseWindow(prompt);
    const phaseChoice = prompt.kind === "choice" && prompt.options.some((option) => ["to_bp", "to_m2", "to_ep"].includes(option.id));
    if (manual && !boundary && !phaseChoice && (prompt.kind !== "choice" || prompt.options.length > 0)) return;
    // Empty optional chain windows are plain passes, not effect decisions.
    let answer: DuelAnswer;
    if (boundary) {
      answer = { choice: "num:0" };
    } else if (prompt.kind === "choice" && prompt.options.length === 0 && prompt.cancelable && prompt.min === 0) {
      answer = { cancel: true };
    } else if (phaseChoice) {
      // Visit Battle and Main 2 before End whenever the core offers them.
      const choice = ["to_bp", "to_m2", "to_ep"].find((id) => prompt.options.some((option) => option.id === id))!;
      if (to === "battle" && choice !== "to_bp" && own.phase === "main1") return;
      if (to === "main2" && choice === "to_ep" && own.phase !== "main2") return;
      answer = { choice };
    } else {
      if (manual) return;
      answer = defaultAnswer(prompt, { table: botTableOf(own) }).answer;
    }
    await options.answer(seat, own, answer);
  }
}
