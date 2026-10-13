import type { DuelRoom } from "@yugidraft/shared/duels";

export type OwnStartBlocked = NonNullable<DuelRoom["startBlocked"]>;

/** The viewer's own deck blocker on a room read. Only that player gets it; anything else is ignored. */
export function ownStartBlocked(room: { startBlocked?: unknown }): OwnStartBlocked | null {
  const value = room.startBlocked;
  if (!value || typeof value !== "object") return null;
  const { reason, cardNames } = value as Partial<OwnStartBlocked>;
  if (typeof reason !== "string" || !reason) return null;
  return { reason, cardNames: Array.isArray(cardNames) ? cardNames.filter((name): name is string => typeof name === "string") : [] };
}

/**
 * What the owner reads: the server's reason, plus the card names when the reason does not name them.
 * With `reasonShown`, another line on the screen already says the reason, so only the missing names remain.
 */
export function ownStartBlockedText(blocked: OwnStartBlocked, reasonShown = false): string {
  const missing = blocked.cardNames.filter((name) => !blocked.reason.includes(name));
  const names = missing.length > 0 ? `Cards: ${missing.join(", ")}.` : "";
  if (reasonShown) return names;
  return `Your deck cannot start. ${blocked.reason}${names ? ` ${names}` : ""}`;
}

/** What the other seated players read while a deck blocks the start. It names no card; the host sends the same words. */
export const NEUTRAL_START_BLOCKED_TEXT = "Start blocked: another player's deck needs attention.";

/** Shown to a seated tournament player, whose registered deck cannot be edited from the room. */
export const LOCKED_DECK_BLOCKED_TEXT = "Your registered deck is locked. Ask the tournament organizer.";

/**
 * The neutral answer the other players get from a ready, deck or start call when someone's deck blocks the
 * start. It is a plain string with no card names. A room read carries an object instead, so only a string counts.
 */
export function neutralStartBlocked(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("startBlocked" in result)) return null;
  const value = (result as { startBlocked?: unknown }).startBlocked;
  return typeof value === "string" && value ? value : null;
}

/** The answer without the neutral string, so the string never lands where a room's own blocker object belongs. */
export function withoutNeutralStartBlocked<T>(result: T): T {
  if (neutralStartBlocked(result) === null) return result;
  const { startBlocked: _dropped, ...rest } = result as T & { startBlocked?: string };
  return rest as T;
}
