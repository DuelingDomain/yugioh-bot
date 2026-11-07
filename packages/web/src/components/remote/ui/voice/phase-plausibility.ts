/**
 * Spoken phase words are also said in talk ("in your draw phase I..."). This pure rule accepts a heard phase word only when it
 * is the next phase or a legal skip from the current one, and only from the turn player. Everything else is ignored quietly.
 */
export const VOICE_PHASES = ["draw", "standby", "main1", "battle", "main2", "end"] as const;
export type VoicePhase = (typeof VOICE_PHASES)[number];
/** What was said: a phase, bare "main" (no number), or "end turn". */
export type HeardPhase = VoicePhase | "main" | "endTurn";
export type PhaseVerdict =
  | { accept: true; move: { kind: "phase"; phase: VoicePhase } | { kind: "turn" } }
  | { accept: false; reason: string };

export const PHASE_LABEL: Record<VoicePhase, string> = { draw: "Draw", standby: "Standby", main1: "Main 1", battle: "Battle", main2: "Main 2", end: "End" };
export const HEARD_PHASES: readonly HeardPhase[] = ["draw", "standby", "main", "main1", "battle", "main2", "end", "endTurn"];

/** Legal forward moves. Main 1 to End and Battle to End are the skips; Draw and Standby cannot be skipped. */
const NEXT: Record<VoicePhase, readonly VoicePhase[]> = {
  draw: ["standby"], standby: ["main1"], main1: ["battle", "end"], battle: ["main2", "end"], main2: ["end"], end: [],
};

/** Canonical parser text (from phrases.ts) to a heard phase word. Anything else (card draw, "next phase", undo) is not a phase word. */
export function heardPhaseOf(canonical: string): HeardPhase | null {
  switch (canonical.trim().toLowerCase()) {
    case "draw phase": return "draw";
    case "standby phase": return "standby";
    case "main phase": return "main";
    case "main phase one": return "main1";
    case "main phase two": return "main2";
    case "battle phase": return "battle";
    case "end phase": return "end";
    case "end turn": return "endTurn";
    default: return null;
  }
}

export function judgePhaseWord(
  current: VoicePhase, turn: number, isTurnPlayer: boolean, heard: HeardPhase,
  options: { battleAllowed?: boolean } = {},
): PhaseVerdict {
  const ignore = (reason: string): PhaseVerdict => ({ accept: false, reason });
  if (!isTurnPlayer) return ignore("not your turn");
  // Players pass the turn from any Main or Battle Phase, so "end turn" is plausible from Main 1 on, not in Draw or Standby.
  if (heard === "endTurn") return VOICE_PHASES.indexOf(current) >= VOICE_PHASES.indexOf("main1") ? { accept: true, move: { kind: "turn" } } : ignore("too early to end the turn");
  // Bare "main" means the Main Phase that comes next: Main 1 before the Battle Phase, Main 2 from the Battle Phase on.
  const target: VoicePhase = heard === "main" ? (VOICE_PHASES.indexOf(current) <= VOICE_PHASES.indexOf("main1") ? "main1" : "main2") : heard;
  if (target === current) return ignore(`already in ${PHASE_LABEL[current]}`);
  if (target === "battle" && !(options.battleAllowed ?? turn > 1)) return ignore("no Battle Phase this turn");
  if (NEXT[current].includes(target)) return { accept: true, move: { kind: "phase", phase: target } };
  return ignore(VOICE_PHASES.indexOf(target) < VOICE_PHASES.indexOf(current) ? "not a next phase" : "skips too far");
}
