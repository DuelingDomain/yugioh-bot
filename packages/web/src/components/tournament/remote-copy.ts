/** Words for Remote tournaments. One place, so the owner can change them without touching a component. */

/**
 * Shown before a player joins a Remote tournament (decision D8). Short plain text about what is stored and for how long.
 * Placeholder: the owner gives the final text later. It must stay one constant.
 */
export const REMOTE_JOIN_NOTICE =
  "Remote Duel: your match is played on camera with your own cards. The site keeps only the result facts, not video, and deletes them within 14 days.";

/** Shown in place of the deck line: a Remote entrant registers no deck (decision D11). */
export const REMOTE_NO_DECK_NOTE = "No deck to register. You play with your own cards on camera.";

/** Turns a Remote error code into text a player can act on. The server text is the fallback. */
export function remoteErrorText(code: unknown, fallback: string, entrants?: unknown): string {
  switch (code) {
    case "REMOTE_ACCESS_REQUIRED":
      return "This tournament uses Remote Duels. Ask for access first.";
    case "REMOTE_DISABLED":
      return "Remote Duels are not available right now.";
    case "REMOTE_MATCH_PLAYER_REQUIRED":
      return "Only the two players of this match can start its Remote Duel.";
    case "TOURNAMENT_MATCH_UNAVAILABLE":
      return "This match already has a result, or one is waiting for an answer.";
    case "REMOTE_TABLES_FULL":
      return "Too many Remote tables are open. Try again in a few minutes.";
    case "REMOTE_ENTRANTS_BLOCKED": {
      const names = Array.isArray(entrants)
        ? entrants.map((entrant) => (entrant && typeof (entrant as { displayName?: unknown }).displayName === "string" ? (entrant as { displayName: string }).displayName : null)).filter((name): name is string => !!name)
        : [];
      return names.length > 0
        ? `These players do not have Remote Duel access: ${names.join(", ")}. Remove them, or ask for access, then start again.`
        : "Some players do not have Remote Duel access. Remove them, or ask for access, then start again.";
    }
    default:
      return fallback;
  }
}
