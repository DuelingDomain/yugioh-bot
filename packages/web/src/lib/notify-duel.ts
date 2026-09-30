import { httpTransport } from "@yugidraft/shared/notify";
import { env } from "./env";

export async function notifyDuelChange(slug: string, guildId: string): Promise<void> {
  try {
    const result = await httpTransport({
      url: env.wsInternalUrl,
      secret: env.wsInternalSecret,
    }).post("/internal/duel/changed", JSON.stringify({ slug, guildId }));
    if (!result.ok) {
      console.warn(
        `[notify-duel] /internal/duel/changed -> ${result.status}${result.text ? ` ${result.text}` : ""}`,
      );
    }
  } catch (error) {
    console.warn("[notify-duel] /internal/duel/changed failed", error);
  }
}
