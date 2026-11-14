import { KwsClient, ASR_BASE, type KwsUtterance } from "./kws-client";
import { TwoStageClient, buildGatePhrases } from "./two-stage";
import { createSentencePiece } from "./sentencepiece";
import { combineHits, isChatter } from "./phrases";
import { matchPhasePhrase } from "./speech-matcher";
import type { GrammarContext } from "../grammar";
import type { VoiceMethod } from "@/lib/remote/voice-diagnostics";
import vocab from "./sp-vocab.json";

export type VoiceFinal = { id: string; method: VoiceMethod; text: string; canonical: string; utterance: KwsUtterance };

/** Imported only after the table's server capability and explicit mic choice both allow capture. */
export function createLiveVoiceClient(options: {
  method: VoiceMethod; context(): GrammarContext; accepting(): boolean;
  onFinal(final: VoiceFinal): void; onReady(): void; onError(message: string): void; onLevel(level: number, speaking: boolean): void;
}) {
  const phrases = buildGatePhrases(createSentencePiece(vocab));
  const session = crypto.randomUUID();
  const common = { accepting: options.accepting, onReady: options.onReady, onError: options.onError, onLevel: options.onLevel,
    onUtterance(u: KwsUtterance) {
      const combined = combineHits(u.hits, phrases.meanings);
      const canonical = u.verification ? u.verification.canonical
        : options.method === "asr" ? matchPhasePhrase(u.text ?? "", u.speechMs)
        : isChatter(combined, phrases.meanings, u.speechMs) ? "" : combined.canonical;
      options.onFinal({ id: `${session}:${u.id}`, method: options.method, text: u.text ?? combined.heard.join(" + "), canonical, utterance: u });
    } };
  return options.method === "two-stage" ? new TwoStageClient({ ...common, phrases, context: options.context })
    : new KwsClient({ ...common, ...(options.method === "asr" ? { base: ASR_BASE } : {}), defaultKeywords: phrases.lines.join("\n"), keywords: "", boost: 1.5, threshold: 0.25 });
}
