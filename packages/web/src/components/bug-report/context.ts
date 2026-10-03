import type { DuelRoom } from "@yugidraft/shared/duels";
import type { BugReportRequest } from "@/lib/bug-report";
import { getAnimationSpeed } from "../duel/animation-speed";

/** The part of a bug report the browser fills in by itself. The server checks and filters all of it again. */
export type CollectedContext = Pick<BugReportRequest, "path" | "duelSlug" | "context">;

/**
 * Collects the automatic context of a report: the page path, the duel slug, the animation speed and browser data. The
 * duel facts (format, turn, phase, seats) and the recent log are NOT sent: the server reads them from the duel host's
 * public view, so a private log line of this player never leaves the browser.
 */
export function collectBugContext(room: DuelRoom | null): CollectedContext {
  const context: CollectedContext["context"] = {
    userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent,
    viewport: typeof window === "undefined" ? undefined : { width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) },
    timestamp: new Date().toISOString(),
  };
  if (context.userAgent === undefined) delete context.userAgent;
  if (context.viewport === undefined) delete context.viewport;
  const path = typeof window === "undefined" ? "/" : window.location.pathname || "/";
  if (!room) return { path, context };

  context.animationSpeed = getAnimationSpeed();
  return { path, duelSlug: room.session.slug, context };
}
