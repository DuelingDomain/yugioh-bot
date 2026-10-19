import { Client, Events, GatewayIntentBits, Options, Routes } from "discord.js";
import { openDatabase } from "@yugidraft/shared/db";
import { report } from "@yugidraft/shared/observability";
import { writeHeartbeat, removeHeartbeat } from "./health.js";
import { createRegistry } from "./registry.js";
import { createDispatcher } from "./dispatcher.js";
import { loadSharedAdminServices, type SharedAdminServices, type DiscordOutboxRow } from "./shared.js";
import { createAudit } from "./audit.js";
import { ConfirmationStore } from "./confirm.js";
import { Cooldown } from "./cooldown.js";
import { startOutboxPoller } from "./outbox.js";
import type { BotConfig, FeatureModule, Stop, FeatureContext } from "./types.js";

export const BOT_INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration, GatewayIntentBits.AutoModerationExecution];

export async function startBot(options: {
  config: BotConfig; modules: readonly FeatureModule[]; db?: FeatureContext["db"];
  signal?: AbortSignal;
  shared?: SharedAdminServices;
  /** Phase 1 waitlist task supplies the renderer; no row is claimed without it. */
  deliverOutbox?: (row: DiscordOutboxRow, context: FeatureContext) => Promise<{ messageId: string }>;
}) {
  const { config, modules } = options;
  const registry = createRegistry(modules);
  const controller = new AbortController();
  let accepting = false;
  const client = new Client({ intents: BOT_INTENTS,
    allowedMentions: { parse: [], repliedUser: false },
    makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 0,
      GuildMemberManager: { maxSize: 100, keepOverLimit: member => member.id === member.client.user.id } }),
    rest: { ...(config.restApi ? { api: config.restApi } : {}), timeout: 10_000, retries: 2,
      // Fail startup on a 429; a restart can retry without an unbounded startup wait.
      rejectOnRateLimit: () => !accepting || controller.signal.aborted,
    },
  });
  const db = options.db ?? openDatabase();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const stops: Stop[] = [];
  const inFlight = new Set<Promise<void>>();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let context: FeatureContext | undefined;
  let stopped: Promise<void> | undefined;
  const stop = (): Promise<void> => stopped ??= (async () => {
    controller.abort();
    options.signal?.removeEventListener("abort", abort);
    if (heartbeat) clearInterval(heartbeat);
    // Keep the gateway open until acknowledged interactions and outbox calls drain.
    for (const cleanup of stops.reverse()) {
      try { await cleanup(); } catch (error) { report(error, { tags: { operation: "bot.stop" } }); }
    }
    await Promise.allSettled([...inFlight]);
    context?.confirmations.clear();
    try { await client.destroy(); } finally {
      client.rest.clearHashSweeper(); client.rest.clearHandlerSweeper();
      db.close(); removeHeartbeat(config.healthPath);
    }
  })();
  try {
    const shared = options.shared ?? await loadSharedAdminServices(db);
    context = { db, config, client, rest: client.rest, signal: controller.signal, shared,
      confirmations: new ConfirmationStore(), cooldown: new Cooldown(),
      audit: createAudit(shared, config.guildId),
    };
    const dispatch = createDispatcher(registry, context);
    client.on(Events.InteractionCreate, interaction => {
      if (!accepting || controller.signal.aborted) return;
      const task = dispatch(interaction);
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));
    });
    client.on(Events.Error, error => report(error, { tags: { operation: "bot.gateway" } }));
    client.on(Events.ShardError, error => report(error, { tags: { operation: "bot.shard" } }));
    const startupSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    startupSignal.throwIfAborted();
    let onAbort: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Bot startup was stopped or timed out"));
      startupSignal.addEventListener("abort", onAbort, { once: true });
    });
    try { await Promise.race([client.login(config.token), aborted]); }
    finally { startupSignal.removeEventListener("abort", onAbort!); }
    // A successful login in another guild must not start this service's hooks.
    // GuildManager.fetch has no AbortSignal option. Use the REST edge directly
    // so SIGTERM also cancels the membership check after Gateway login.
    const guild = await client.rest.get(Routes.guild(config.guildId), { signal: startupSignal }) as { id: string };
    if (guild.id !== config.guildId) throw new Error("The configured Discord guild is unavailable");
    controller.signal.throwIfAborted();
    if (client.application?.id !== config.clientId) throw new Error("DISCORD_CLIENT_ID does not match the bot application");
    for (const module of modules) {
      const cleanup = await module.start?.(context);
      if (cleanup) stops.push(cleanup);
      controller.signal.throwIfAborted();
    }
    stops.push(startOutboxPoller({ shared, guildId: config.guildId, signal: controller.signal,
      ...(options.deliverOutbox ? { deliver: row => options.deliverOutbox!(row, context!) } : {}),
    }));
    const beat = () => writeHeartbeat(config.healthPath, client.isReady() ? "ready" : "disconnected");
    beat(); heartbeat = setInterval(beat, 30_000);
    accepting = true;
    return { client, context, stop };
  } catch (error) { await stop(); throw error; }
}
