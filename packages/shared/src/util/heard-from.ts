/** "How did you hear about us?" answers. Survey data only: never used for access. */
export const HEARD_FROM = ["youtube", "twitch", "tiktok", "discord", "reddit", "x", "friend", "search", "creator", "other"] as const;
export type HeardFrom = (typeof HEARD_FROM)[number];

/** Labels for selects (marketing site, app waitlist, create-account). "creator" is set by a creator link, not chosen. */
export const HEARD_FROM_LABELS: Record<HeardFrom, string> = {
  youtube: "YouTube", twitch: "Twitch", tiktok: "TikTok", discord: "Discord", reddit: "Reddit", x: "X (Twitter)",
  friend: "A friend", search: "Search engine", creator: "A content creator", other: "Other",
};

export const HEARD_FROM_DETAIL_MAX = 60;

/**
 * Checks a client value against the list. Unknown, empty or "creator" -> null: "creator" is written only by the
 * sign-up attribution of a creator grant, never taken from browser input. The detail is trimmed, control
 * characters removed and cut to 60 characters; it is kept only with a valid answer.
 */
export function parseHeardFrom(value: unknown, detail?: unknown): { heardFrom: HeardFrom; detail: string | null } | null {
  if (typeof value !== "string") return null;
  const answer = value.trim().toLowerCase();
  if (answer === "creator" || !(HEARD_FROM as readonly string[]).includes(answer)) return null;
  const text = typeof detail === "string" ? detail.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, HEARD_FROM_DETAIL_MAX) : "";
  return { heardFrom: answer as HeardFrom, detail: text || null };
}
