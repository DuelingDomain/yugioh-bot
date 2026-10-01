import { httpTransport, type SignedPostTransport } from "@yugidraft/shared/notify";

export type NotifyDuelChange = (slug: string, guildId: string) => Promise<void>;

/**
 * Tells the ws server that a duel game changed (for example, its series was
 * closed by a tournament ending) so open duel pages refetch. Never throws.
 */
export function createNotifyDuelChange(transport: SignedPostTransport): NotifyDuelChange {
  return async (slug, guildId) => {
    try {
      const result = await transport.post("/internal/duel/changed", JSON.stringify({ slug, guildId }));
      if (!result.ok) {
        console.warn(
          `[notify-duel] /internal/duel/changed -> ${result.status}${result.text ? ` ${result.text}` : ""}`,
        );
      }
    } catch (error) {
      console.warn("[notify-duel] /internal/duel/changed failed", error);
    }
  };
}

export function createHttpNotifyDuelChange(cfg: { url: string; secret: string }): NotifyDuelChange {
  return createNotifyDuelChange(httpTransport(cfg));
}
