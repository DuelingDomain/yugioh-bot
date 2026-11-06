import useSWR from "swr";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import type { Choice } from "@/components/duel/sheet-ui";
import { remoteApi } from "./api";

/** The table page is cross-origin isolated (COOP/COEP), so we reach it with a full document load. */
export const remoteTableHref = (slug: string) => `/duels/remote/${slug}`;
export const REMOTE_SEAT_CHOICES: readonly Choice<number>[] = [{ value: 2, label: "1v1" }, { value: 3, label: "3-way" }, { value: 4, label: "4-way" }];

/** Remote format ids. They are the duel type of the create screen plus the Genesys toggle. */
const REMOTE_FORMAT_NAMES: Record<string, string> = { normal: "Standard duel", domain: "Domain", genesys: "Genesys", "genesys-domain": "Genesys Domain" };
export const remoteFormatId = (domain: boolean, genesys: boolean) => `${genesys ? "genesys" : ""}${genesys && domain ? "-" : ""}${domain ? "domain" : ""}` || "normal";
export const remoteFormatName = (id: string | undefined) => REMOTE_FORMAT_NAMES[id ?? "normal"] ?? "Advanced";

/** The player's saved decks, for the deck pickers of the create screen and the setup room. */
export function useSavedDecks(enabled = true) {
  return useSWR(enabled ? "remote:saved-decks" : null, async () => {
    const response = await fetch("/api/decks", { cache: "no-store" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load saved decks");
    return data as { decks: { id: number; name: string }[] };
  });
}

/** The key under which the create screen leaves a deck error for the setup room of the new table. */
export const deckFailedKey = (slug: string) => `remote:deck-failed:${slug}`;

/**
 * Creates the room, then seats the chosen deck. A deck the table refuses is fixed in the setup room, so it does not
 * undo the room (a retry would make a second room). The message goes to the setup room through sessionStorage.
 */
export async function createRemoteRoom(input: {
  seatCount: number; solo: boolean; format: string; savedDeckId?: number | null; showCardsSetFromDeck?: boolean; rules?: unknown;
}): Promise<RemoteRoom> {
  const room = await remoteApi<RemoteRoom>("", {
    gameId: "ygo", seatCount: input.seatCount, solo: input.solo, format: input.format,
    showCardsSetFromDeck: input.showCardsSetFromDeck, ...(input.rules ? { rules: input.rules } : {}),
  });
  if (input.savedDeckId) {
    await remoteApi(`/${room.slug}/deck`, { savedDeckId: input.savedDeckId }).catch((error: unknown) => {
      try { sessionStorage.setItem(deckFailedKey(room.slug), error instanceof Error ? error.message : "The deck was not seated."); } catch { /* storage may be blocked */ }
    });
  }
  return room;
}
