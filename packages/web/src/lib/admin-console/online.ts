import { listOnline } from "@yugidraft/shared/admin";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { ok, type SectionLoader } from "./section";

/** Signed-in people seen in the last 2 minutes, with name, picture and the table or draft they are in. */
export const loadOnline: SectionLoader<"online"> = async ({ now }) => {
  const snapshot = listOnline(getDb(), now, env.discordGuildId || null);
  return ok({
    count: snapshot.count, windowSeconds: snapshot.windowSeconds, bySection: snapshot.bySection,
    // The route template is an internal detail; the label says the same thing in words.
    users: snapshot.users.map(({ route: _route, ...person }) => person),
  }, now);
};
