import type { DuelRoom } from "@yugidraft/shared/duels";
import { BUG_LOG_LINES, publicLogLines, type BugReportRequest } from "@/lib/bug-report";
import { getAnimationSpeed } from "../duel/animation-speed";
import { engineFormat } from "../duel/multi-seat";

/** The part of a bug report the browser fills in by itself. The server checks and filters all of it again. */
export type CollectedContext = Pick<BugReportRequest, "path" | "duelSlug" | "context">;

/**
 * Collects the automatic context of a report. With a room it adds the duel facts every viewer can see: format, mode,
 * the reporter's seat, turn, phase, whose turn, living players and the last public log lines. It never reads a hand,
 * a prompt or a deck. The log is the viewer's own log, which has private lines, so `publicLogLines` runs over the whole
 * log before the last lines are cut.
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

  const engine = room.engine;
  context.format = engineFormat(engine);
  context.duelMode = room.session.mode;
  context.seat = room.mySeat;
  context.animationSpeed = getAnimationSpeed();
  if (engine) {
    context.turn = engine.turn;
    context.phase = engine.phase;
    context.turnSeat = engine.turnSeat;
    context.livingPlayers = engine.seats.filter((seat) => !seat.eliminated && !seat.pendingElimination).length;
    context.log = publicLogLines(engine.log.map((entry) => entry.text)).slice(-BUG_LOG_LINES);
  }
  return { path, duelSlug: room.session.slug, context };
}
