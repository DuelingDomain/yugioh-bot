import { log, report } from "@yugidraft/shared/observability";
import { httpTransport } from "@yugidraft/shared/notify";
import { env } from "./env";

export async function notifyDuelChange(slug: string, guildId: string): Promise<void> {
  try {
    const result = await httpTransport({
      url: env.wsInternalUrl,
      secret: env.wsInternalSecret,
    }).post("/internal/duel/changed", JSON.stringify({ slug, guildId }));
    if (!result.ok) {
      log("warn", "[notify-duel] Invalidation rejected", { status: result.status });
    }
  } catch (error) {
    report(error, { tags: { operation: "[notify-duel] /internal/duel/changed failed" } });
  }
}
