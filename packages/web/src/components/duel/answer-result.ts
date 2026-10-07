import type { DuelRoom } from "@yugidraft/shared/duels";
import { withRoomReceivedAt, type ReceivedDuelRoom } from "./api";

/** The part of SWR's bound `mutate` that an answer needs. */
export type RoomMutate = (data?: ReceivedDuelRoom, options?: { revalidate: boolean }) => Promise<unknown>;

/**
 * Put the room that an action answered with on the board. That room is the full, fresh view, so it is
 * applied as it is and the room is free again at once: the old code asked for the room a second time and
 * held the room busy (zones and buttons dead) for that whole extra round trip. A room the duel host marked
 * stale (its queue was blocked) is the one case that still asks again, in the background.
 * A reply that is not a room (a plain session) cannot be applied, so the room is read again.
 */
export async function applyAnswerResult(
  mutate: RoomMutate,
  result: DuelRoom | { session: unknown } | void,
): Promise<void> {
  if (result && "engine" in result) {
    await mutate(withRoomReceivedAt(result), { revalidate: false });
    if (result.stale === true) void mutate().catch(() => {});
    return;
  }
  await mutate();
}
