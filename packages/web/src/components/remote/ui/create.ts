import useSWR from "swr";
import { REMOTE_FORMATS, type RemoteRoom } from "@yugidraft/shared/remote";
import type { Choice } from "@/components/duel/sheet-ui";
import { remoteApi } from "./use-remote-room";

/** The table page is cross-origin isolated (COOP/COEP), so we reach it with a full document load. */
export const remoteTableHref = (slug: string) => `/duels/remote/${slug}`;
export const REMOTE_FORMAT_CHOICES: readonly Choice<string>[] = REMOTE_FORMATS.map(({ value, label }) => ({ value, label }));
export const REMOTE_SEAT_CHOICES: readonly Choice<number>[] = [{ value: 2, label: "1v1" }, { value: 3, label: "3-way" }, { value: 4, label: "4-way" }];
export const remoteFormatName = (id: string | undefined) => REMOTE_FORMATS.find(item => item.value === id)?.label ?? "Advanced";

/** The player's saved decks, for the deck pickers of the create screen and the setup room. */
export function useSavedDecks(enabled = true) {
  return useSWR(enabled ? "remote:saved-decks" : null, async () => {
    const response = await fetch("/api/decks", { cache: "no-store" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load saved decks");
    return data as { decks: { id: number; name: string }[] };
  });
}

/** Creates the room, then seats the chosen deck. A deck the table refuses is fixed in the setup room, so it does not undo the room. */
export async function createRemoteRoom(input: { seatCount: number; solo: boolean; format: string; savedDeckId?: number | null }): Promise<RemoteRoom> {
  const room = await remoteApi<RemoteRoom>("", { gameId: "ygo", seatCount: input.seatCount, solo: input.solo, format: input.format });
  if (input.savedDeckId) await remoteApi(`/${room.slug}/deck`, { savedDeckId: input.savedDeckId }).catch(() => undefined);
  return room;
}
