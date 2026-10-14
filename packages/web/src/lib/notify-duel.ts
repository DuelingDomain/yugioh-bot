import { log, report } from "@yugidraft/shared/observability";
import { signedTransport } from "@yugidraft/shared/internal-auth";
import { findDuelEventTarget } from "@yugidraft/shared/services";
import { getDb } from "./db";
import { env } from "./env";

export async function notifyDuelChange(slug: string, guildId: string): Promise<void> {
  try {
    const target = findDuelEventTarget(getDb(), slug, guildId);
    if (!target) return;
    const result = await signedTransport({ purpose: "ws-broadcast",
      url: env.wsInternalUrl,
      secret: env.wsInternalSecret,
    }).post("/internal/duel/changed", JSON.stringify({ slug: target.slug, guildId: target.guildId }));
    if (!result.ok) {
      log("warn", "[notify-duel] Invalidation rejected", { status: result.status });
    }
  } catch (error) {
    report(error, { tags: { operation: "[notify-duel] /internal/duel/changed failed" } });
  }
}
