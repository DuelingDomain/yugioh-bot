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

/** What the owner reads: the server's reason, plus the card names when the reason does not name them. */
export function ownStartBlockedText(blocked: OwnStartBlocked): string {
  const missing = blocked.cardNames.filter((name) => !blocked.reason.includes(name));
  return `Your deck cannot start. ${blocked.reason}${missing.length > 0 ? ` Cards: ${missing.join(", ")}.` : ""}`;
}

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
