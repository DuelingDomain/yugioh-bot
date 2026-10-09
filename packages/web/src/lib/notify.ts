import { createBroadcaster, createAnnouncer, httpTransport, type Announcer } from "@yugidraft/shared/notify";
import { env } from "./env";

// Mutations commit before notifications; a stalled internal service must not hold the response open.
const timeoutMs = 5_000;
export const broadcaster = createBroadcaster(httpTransport({ url: env.wsInternalUrl, secret: env.wsInternalSecret, timeoutMs }));
export const announcer: Announcer = env.discordBotEnabled
  ? createAnnouncer(httpTransport({ url: env.botAnnounceUrl, secret: env.botAnnounceSecret, timeoutMs }))
  : { announce: async () => ({ ok: false, error: "discord_disabled" }) };
