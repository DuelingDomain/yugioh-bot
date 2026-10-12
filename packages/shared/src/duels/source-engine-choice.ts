import { isEngineIdentity, type ReplaySource } from "./replay.js";
import type { DuelEngineChoice } from "./engine-switch.js";

/** Recorded identity names the core; old sources keep their saved choice or historical fallback. */
export function sourceEngineChoice(source: Pick<ReplaySource, "setup" | "engineIdentity">): DuelEngineChoice {
  if (isEngineIdentity(source.engineIdentity) && source.engineIdentity.coreFamily !== "multi") return source.engineIdentity.coreFamily;
  return source.setup?.engine ?? (source.setup?.startupScripts?.length ? "pinned" : "legacy");
}
