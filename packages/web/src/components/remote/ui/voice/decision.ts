import { interpret, type GrammarContext, type VoiceIntent } from "../grammar";
import type { VoiceFinal } from "./live-client";
import type { VoiceReason } from "@/lib/remote/voice-diagnostics";

type PhaseTurn = Extract<VoiceIntent, { kind: "phase" | "turn" }>;
/** All methods meet the same grammar boundary; other grammar intents can never reach the live voice apply path. */
export function decideVoice(final: VoiceFinal, context: GrammarContext, accepting: boolean):
  | { accepted: true; intent: PhaseTurn }
  | { accepted: false; reason: VoiceReason } {
  if (!accepting) return { accepted: false, reason: "muted" };
  if (final.method !== "asr" && !final.utterance.hits.length) return { accepted: false, reason: "no-keyword" };
  if (!final.canonical) return { accepted: false, reason: final.utterance.verification?.stage2 === "skipped" && final.utterance.verification.stage1 === "hit" ? "other" : "not-a-command" };
  if (context.me !== context.state.turnSeat) return { accepted: false, reason: "not-turn-player" };
  if (final.utterance.verification && final.utterance.verification.stage2 !== "confirmed") return { accepted: false, reason: "illegal-phase" };
  const intent = interpret(final.canonical, { ...context, trayOpen: false });
  if (intent.kind === "phase" || intent.kind === "turn") return { accepted: true, intent };
  return { accepted: false, reason: "illegal-phase" };
}
