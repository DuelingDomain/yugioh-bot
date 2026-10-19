import { DiscordAPIError, HTTPError, RateLimitError, REST, Routes } from "discord.js";
import { report } from "@yugidraft/shared/observability";
import type { OutboxFailure } from "@yugidraft/shared/discord-admin";
import type { DiscordOutboxRow, SharedAdminServices } from "./shared.js";
import type { Stop } from "./types.js";

export interface OutboxDelivery { messageId: string; channelId?: string }
class DeliveryError extends Error {
  constructor(readonly failure: OutboxFailure) { super("Outbox delivery refused"); }
}
function failureFor(error: unknown): OutboxFailure {
  if (error instanceof DeliveryError) return error.failure;
  if (error instanceof RateLimitError) return { code: "rate_limited",
    retryAfterMs: Math.max(1000, error.retryAfter, error.timeToReset, error.sublimitTimeout) };
  if (error instanceof DiscordAPIError || error instanceof HTTPError) {
    if (error.status === 400) return { code: "invalid_payload", permanent: true };
    if ([401, 403, 404].includes(error.status)) return { code: "rejected", permanent: true };
  }
  return { code: "transport" };
}

/** Shared producers supply the complete REST body, including the stable post nonce. */
export function createOutboxDelivery(options: { token: string; restApi?: string; guildId: string; signal: AbortSignal }) {
  return async (row: DiscordOutboxRow): Promise<OutboxDelivery> => {
    let payload: unknown;
    try { payload = JSON.parse(row.payload_json); }
    catch { throw new DeliveryError({ code: "invalid_payload", permanent: true }); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || (row.operation === "edit" && !row.message_id)) {
      throw new DeliveryError({ code: "invalid_payload", permanent: true });
    }
    // One claim at a time and bounded REST I/O keep delivery within the 60-second lease.
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(45_000)]);
    signal.throwIfAborted();
    // Cached rate-limit handlers can create referenced sleeps even when configured to
    // reject. Scope REST to one row so those timers cannot outlive bot shutdown.
    const rest = new REST({ ...(options.restApi ? { api: options.restApi } : {}),
      timeout: 10_000, retries: 0, rejectOnRateLimit: () => true }).setToken(options.token);
    try {
      const channel = await rest.get(Routes.channel(row.channel_id), { signal }) as { guild_id?: string };
      if (channel.guild_id !== options.guildId) throw new DeliveryError({ code: "rejected", permanent: true });
      signal.throwIfAborted();
      const body = { ...payload, allowed_mentions: { parse: [], users: [], roles: [], replied_user: false } };
      // Drain a started write during shutdown so its successful response can be saved.
      // Leave cleanup time within Compose's 45-second stop grace, including slow bodies.
      const remaining = row.lease_expires_at - Date.now() - 5000;
      if (remaining <= 0) throw new DeliveryError({ code: "transport" });
      const writeSignal = AbortSignal.timeout(Math.min(30_000, remaining));
      let message: { id: string; channel_id: string };
      if (row.operation === "post") {
        message = await rest.post(Routes.channelMessages(row.channel_id), { body, signal: writeSignal }) as typeof message;
      } else {
        try {
          message = await rest.patch(Routes.channelMessage(row.channel_id, row.message_id!), { body, signal: writeSignal }) as typeof message;
        } catch (error) {
          // Unknown Message means the edit target was deleted; it needs no further retries.
          if (error instanceof DiscordAPIError && error.code === 10008) {
            return { messageId: row.message_id!, channelId: row.channel_id };
          }
          throw error;
        }
      }
      return { messageId: message.id, channelId: message.channel_id };
    } finally { rest.clearHashSweeper(); rest.clearHandlerSweeper(); }
  };
}

/** Shared SQLite owns claims, fencing, retries, and the cross-process rate budget. */
export function startOutboxPoller(options: {
  shared: SharedAdminServices; guildId: string; signal: AbortSignal;
  deliver: (row: DiscordOutboxRow) => Promise<OutboxDelivery>;
  intervalMs?: number;
}): Stop {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let sentAt: number[] = [];
  let pausedUntil = 0;
  const sweep = async () => {
    while (!stopped && !options.signal.aborted) {
      sentAt = sentAt.filter(at => at > Date.now() - 60_000);
      if (sentAt.length >= 30 || Date.now() < pausedUntil) return;
      const [row] = options.shared.claimOutbox(1);
      if (!row) return;
      sentAt.push(Date.now());
      try { options.shared.markPosted(row, await options.deliver(row)); }
      catch (error) {
        const failure = failureFor(error);
        options.shared.markFailed(row, failure);
        if (failure.code === "rate_limited") pausedUntil = Date.now() + (failure.retryAfterMs ?? 1000);
      }
    }
  };
  const tick = () => {
    if (stopped || options.signal.aborted || inFlight) return;
    inFlight = sweep().catch(error => report(error, { tags: { operation: "bot.outbox" } }))
      .finally(() => { inFlight = undefined; });
  };
  const timer = setInterval(tick, options.intervalMs ?? 3000);
  tick();
  return async () => { stopped = true; clearInterval(timer); await inFlight; };
}
