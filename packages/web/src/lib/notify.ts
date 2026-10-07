import { createBroadcaster, createAnnouncer, httpTransport, type Announcer } from "@yugidraft/shared/notify";
import { env } from "./env";

export const broadcaster = createBroadcaster(httpTransport({ url: env.wsInternalUrl, secret: env.wsInternalSecret }));
export const announcer: Announcer = env.discordBotEnabled
  ? createAnnouncer(httpTransport({ url: env.botAnnounceUrl, secret: env.botAnnounceSecret }))
  : { announce: async () => ({ ok: false, error: "discord_disabled" }) };
