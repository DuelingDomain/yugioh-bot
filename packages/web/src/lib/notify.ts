import { createBroadcaster, createAnnouncer, httpTransport } from "@yugidraft/shared/notify";
import { env } from "./env";

// Mutations commit before notifications; a stalled internal service must not hold the response open.
const timeoutMs = 5_000;
export const broadcaster = createBroadcaster(httpTransport({ url: env.wsInternalUrl, secret: env.wsInternalSecret, timeoutMs }));
export const announcer = createAnnouncer(httpTransport({ url: env.botAnnounceUrl, secret: env.botAnnounceSecret, timeoutMs }));
