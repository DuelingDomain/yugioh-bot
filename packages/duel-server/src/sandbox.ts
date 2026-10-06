import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { multiplayerSeatsBlockReason, multiplayerTablesEnabled, parseSandboxRun, SandboxBoardError,
  seatCountFor, type SandboxRun } from "@yugidraft/shared/duels";
import type { DuelService } from "@yugidraft/shared/services";
import { multiStartProblem } from "./multi-domain-guard.js";
import { multiCoreAvailable } from "./presets/index.js";
import { validateRuntimeBoard } from "./presets/runtime-board.js";

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
        sandbox, startupScripts: (copts.startupScripts ?? []).map((script) => script.content),
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
