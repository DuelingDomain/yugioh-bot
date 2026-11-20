import { interpret, type GrammarContext, type VoiceIntent } from "../grammar";
import type { VoiceFinal } from "./live-client";
import type { VoiceReason } from "@/lib/remote/voice-diagnostics";

type PhaseTurn = Extract<VoiceIntent, { kind: "phase" | "turn" }>;
type Board = Extract<VoiceIntent, { kind: "effect" | "lp" | "attack" }>;
/** All methods meet the same grammar boundary. Only "asr-names" may also carry effect, LP and attack lines; the others stay phase/turn only. */
export function decideVoice(final: VoiceFinal, context: GrammarContext, accepting: boolean):
  | { accepted: true; intent: PhaseTurn | Board }
  | { accepted: false; reason: VoiceReason } {
  if (!accepting) return { accepted: false, reason: "muted" };
  if (final.method !== "asr" && final.method !== "asr-names" && !final.utterance.hits.length) return { accepted: false, reason: "no-keyword" };
  if (!final.canonical) return { accepted: false, reason: final.utterance.verification?.stage2 === "skipped" && final.utterance.verification.stage1 === "hit" ? "other" : "not-a-command" };
  if (final.method === "asr-names") return decideBoard(final.canonical, context);
  if (context.me !== context.state.turnSeat) return { accepted: false, reason: "not-turn-player" };
  if (final.utterance.verification && final.utterance.verification.stage2 !== "confirmed") return { accepted: false, reason: "illegal-phase" };
  const intent = interpret(final.canonical, { ...context, trayOpen: false });
  if (intent.kind === "phase" || intent.kind === "turn") return { accepted: true, intent };
  return { accepted: false, reason: "illegal-phase" };
}

/** Board lines are proposals: effect needs a card the grammar found on the speaker's field, LP and attack still go through the confirm chip. */
function decideBoard(canonical: string, context: GrammarContext): ReturnType<typeof decideVoice> {
  const intent = interpret(canonical, { ...context, trayOpen: false });
  const turnPlayer = context.me === context.state.turnSeat;
  if (intent.kind === "phase" || intent.kind === "turn") return turnPlayer ? { accepted: true, intent } : { accepted: false, reason: "not-turn-player" };
  if (intent.kind === "effect") return intent.proposal.type === "effect.activated" && intent.proposal.source.cardRef ? { accepted: true, intent } : { accepted: false, reason: "not-a-command" };
  if (intent.kind === "attack") return turnPlayer ? { accepted: true, intent } : { accepted: false, reason: "not-turn-player" };
  if (intent.kind === "lp") return { accepted: true, intent };
  return { accepted: false, reason: "not-a-command" };
}
