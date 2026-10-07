import {
  createAnnouncer,
  createBroadcaster,
  httpTransport,
  type AnnouncePayload,
  type SignedPostTransport,
} from "@yugidraft/shared/notify";
import type { DraftBroadcastPayload, TournamentBroadcastPayload } from "@yugidraft/shared/ws";

export type WorkerEffects = {
  discordEnabled: boolean;
  draft(payload: DraftBroadcastPayload): Promise<void>;
  tournament(payload: TournamentBroadcastPayload): Promise<void>;
  discord(payload: AnnouncePayload): Promise<void>;
  duel(slug: string, guildId: string): Promise<void>;
};

export function createEffects(input: {
  enabled: boolean;
  ws: SignedPostTransport;
  bot: SignedPostTransport;
}): WorkerEffects {
  const broadcast = createBroadcaster(input.ws);
  const announce = createAnnouncer(input.bot);
  const safe = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      console.warn("[worker] effect failed", error);
    }
  };

  return {
    discordEnabled: input.enabled,
    draft: payload => safe(() => broadcast.draft(payload)),
    tournament: payload => safe(() => broadcast.tournament(payload)),
    discord: payload => input.enabled ? safe(() => announce.announce(payload)) : Promise.resolve(),
    duel: (slug, guildId) => safe(async () => {
      const result = await input.ws.post("/internal/duel/changed", JSON.stringify({ slug, guildId }));
      if (!result.ok) console.warn("[worker] duel invalidation failed", result.status);
    }),
  };
}

export const WORKER_EFFECT_TIMEOUT_MS = 5000;

export function effectsFromEnv(env: NodeJS.ProcessEnv): WorkerEffects {
  return createEffects({
    enabled: env.DISCORD_BOT_ENABLED === "1",
    // A stalled WS or bot must not hold a tick: these calls give up after five seconds.
    ws: httpTransport({ url: env.WS_INTERNAL_URL ?? "", secret: env.WS_INTERNAL_SECRET ?? "", timeoutMs: WORKER_EFFECT_TIMEOUT_MS }),
    bot: httpTransport({ url: env.BOT_ANNOUNCE_URL ?? "", secret: env.BOT_ANNOUNCE_SECRET ?? "", timeoutMs: WORKER_EFFECT_TIMEOUT_MS }),
  });
}
