import { isEngineIdentity, type ReplaySource } from "./replay.js";
import type { DuelEngineChoice } from "./engine-switch.js";

/** Old 1v1 sources without a recorded choice, identity or startup scripts may try either family. */
export function isUnknownEngineChoice(source: Pick<ReplaySource, "session" | "setup" | "engineIdentity">): boolean {
  return source.session.format === "1v1" && source.engineIdentity === null && source.setup?.engine == null
    && !source.setup?.startupScripts?.length;
}

/** Recorded identity names the core; old sources keep their saved choice or historical fallback. */
export function sourceEngineChoice(source: Pick<ReplaySource, "setup" | "engineIdentity">): DuelEngineChoice {
  if (isEngineIdentity(source.engineIdentity) && source.engineIdentity.coreFamily !== "multi") return source.engineIdentity.coreFamily;
  return source.setup?.engine ?? (source.setup?.startupScripts?.length ? "pinned" : "legacy");
}
