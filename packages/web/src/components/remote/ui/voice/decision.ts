import { interpret, type GrammarContext, type VoiceIntent } from "../grammar";
import type { VoiceFinal } from "./live-client";
import type { VoiceReason } from "@/lib/remote/voice-diagnostics";

type PhaseTurn = Extract<VoiceIntent, { kind: "phase" | "turn" }>;
type Board = Extract<VoiceIntent, { kind: "effect" | "lp" | "attack" | "respond" }>;
/** All methods meet the same grammar boundary. Only "asr-names" may also carry effect, LP and attack lines; the others stay phase/turn only. "asr" and "asr-names" also carry a respond line. */
export function decideVoice(final: VoiceFinal, context: GrammarContext, accepting: boolean):
  | { accepted: true; intent: PhaseTurn | Board }
  | { accepted: false; reason: VoiceReason } {
  if (!accepting) return { accepted: false, reason: "muted" };
  if (final.method !== "asr" && final.method !== "asr-names" && !final.utterance.hits.length) return { accepted: false, reason: "no-keyword" };
  if (!final.canonical) return { accepted: false, reason: final.utterance.verification?.stage2 === "skipped" && final.utterance.verification.stage1 === "hit" ? "other" : "not-a-command" };
  // "response", "I chain": any seat may say it, so it comes before the turn-player rule. Only the methods that hear free text carry it.
  if (final.method === "asr" || final.method === "asr-names") {
    const spoken = interpret(final.canonical, { ...context, trayOpen: false });
    if (spoken.kind === "respond") return { accepted: true, intent: spoken };
  }
  if (final.method === "asr-names") return decideBoard(final.text, final.canonical, context);
  if (context.me !== context.state.turnSeat) return { accepted: false, reason: "not-turn-player" };
  if (final.utterance.verification && final.utterance.verification.stage2 !== "confirmed") return { accepted: false, reason: "illegal-phase" };
  const intent = interpret(final.canonical, { ...context, trayOpen: false });
  if (intent.kind === "phase" || intent.kind === "turn") return { accepted: true, intent };
  return { accepted: false, reason: "illegal-phase" };
}

/** Board lines are proposals: effect needs a card the grammar found on the speaker's field, LP and attack still go through the confirm chip. */
function decideBoard(text: string, canonical: string, context: GrammarContext): ReturnType<typeof decideVoice> {
  const intent = interpret(canonical, { ...context, trayOpen: false });
  const turnPlayer = context.me === context.state.turnSeat;
  if (intent.kind === "phase" || intent.kind === "turn") return turnPlayer ? { accepted: true, intent } : { accepted: false, reason: "not-turn-player" };
  // An effect acts with no chip, so it needs the effect word that was heard AND the strong name match the hot list gives its "activate effect of" form.
  if (intent.kind === "effect") return intent.proposal.type === "effect.activated" && intent.proposal.source.cardRef && canonical.startsWith("activate effect of ") && /\b(?:activate|activates|effect|effects|use)\b/i.test(text) ? { accepted: true, intent } : { accepted: false, reason: "not-a-command" };
  if (intent.kind === "attack") return turnPlayer ? { accepted: true, intent } : { accepted: false, reason: "not-turn-player" };
  // "take two cards" is table talk: an LP line has an LP word or a real amount.
  if (intent.kind === "lp") return /\b(?:lp|life points?)\b/i.test(text) || (Math.abs(intent.delta) >= 50 && !/\bcards?\b/i.test(text)) ? { accepted: true, intent } : { accepted: false, reason: "not-a-command" };
  return { accepted: false, reason: "not-a-command" };
}
