import { report } from "@yugidraft/shared/observability";
import type { DiscordOutboxRow, SharedAdminServices } from "./shared.js";
import type { Stop } from "./types.js";

/** B owns claim/retry/dedupe; Phase 1 supplies delivery for each payload kind. */
export function startOutboxPoller(options: {
  shared: SharedAdminServices; guildId: string; signal: AbortSignal;
  deliver?: (row: DiscordOutboxRow) => Promise<{ messageId: string }>;
  intervalMs?: number;
}): Stop {
  if (!options.deliver) return () => {};
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let sentAt: number[] = [];
  const tick = () => {
    if (stopped || options.signal.aborted || inFlight) return;
    sentAt = sentAt.filter(at => at > Date.now() - 60_000);
    const limit = 30 - sentAt.length;
    if (limit <= 0) return;
    inFlight = options.shared.pollDiscordOutbox({ guildId: options.guildId, limit, signal: options.signal,
      async deliver(row) {
        if (stopped || options.signal.aborted) throw new Error("Outbox delivery stopped");
        sentAt = sentAt.filter(at => at > Date.now() - 60_000);
        if (sentAt.length >= 30) throw new Error("Outbox rate limit reached");
        sentAt.push(Date.now());
        return options.deliver!(row);
      },
    }).catch(error => report(error, { tags: { operation: "bot.outbox" } })).finally(() => { inFlight = undefined; });
  };
  const timer = setInterval(tick, options.intervalMs ?? 3000);
  tick();
  return async () => { stopped = true; clearInterval(timer); await inFlight; };
}
