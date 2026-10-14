import { signedTransport } from "@yugidraft/shared/internal-auth";
import { createBroadcaster, createAnnouncer, type Announcer } from "@yugidraft/shared/notify";
import { env } from "./env";

// Mutations commit before notifications; a stalled internal service must not hold the response open.
const timeoutMs = 5_000;
export const broadcaster = createBroadcaster(signedTransport({ purpose: "ws-broadcast", url: env.wsInternalUrl, secret: env.wsInternalSecret, timeoutMs }));
export const announcer: Announcer = env.discordBotEnabled
  ? createAnnouncer(signedTransport({ purpose: "bot-announce", url: env.botAnnounceUrl, secret: env.botAnnounceSecret, timeoutMs }))
  : { announce: async () => ({ ok: false, error: "discord_disabled" }) };
