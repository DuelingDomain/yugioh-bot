import type { z } from "zod";
import type { voiceRecordSchema } from "./voice-diagnostics-schema";

export const voiceMethods = ["two-stage", "kws", "asr"] as const;
export type VoiceMethod = typeof voiceMethods[number];
export const voiceMethodLabels: Record<VoiceMethod, string> = { "two-stage": "Keyword gate + verify", kws: "Keywords only", asr: "Speech model" };
export const voiceCommands = ["draw phase", "standby phase", "main phase one", "battle phase", "main phase two", "end phase", "next phase", "go back a phase", "end turn"] as const;
export const voiceReasons = ["no-keyword", "not-a-command", "illegal-phase", "not-turn-player", "unconfirmed", "needs-confirm", "muted", "other"] as const;
export type VoiceReason = typeof voiceReasons[number];
export type VoiceRecord = z.infer<typeof voiceRecordSchema>;
export type VoiceContext = Extract<VoiceRecord, { kind: "utterance" }>["context"];
export type VoiceDecision = Extract<VoiceRecord, { kind: "utterance" }>["decision"];
export type VoiceMark = Extract<VoiceRecord, { kind: "mark" }>;
export const VOICE_BATCH_MAX_BYTES = 64 * 1024;

/** A bounded, lossy queue. Sending never awaits storage or the network; failed batches are discarded. */
export class VoiceDiagnosticsBatcher {
  private queue: { record: VoiceRecord; bytes: number }[] = [];
  private bytes = 0;
  private lastSent = -Infinity;
  constructor(private readonly send: (body: string, hiding: boolean) => void, private readonly now = Date.now) {}
  add(record: VoiceRecord) {
    const bytes = new TextEncoder().encode(JSON.stringify(record)).length + 1;
    if (bytes > 48 * 1024) return;
    this.queue.push({ record, bytes }); this.bytes += bytes;
    while (this.queue.length > 100 || this.bytes > 48 * 1024) this.bytes -= this.queue.shift()!.bytes;
  }
  flush(hiding = false) {
    const now = this.now();
    if (!this.queue.length || (!hiding && now - this.lastSent < 5000)) return;
    const body = JSON.stringify({ records: this.queue.map(item => item.record) });
    this.queue = []; this.bytes = 0; this.lastSent = now;
    try { this.send(body, hiding); } catch { /* diagnostics never interrupt play */ }
  }
}

/** Only allowlisted fields are copied; worker-owned PCM and incidental worker messages cannot enter a record. */
export function utteranceRecord(input: {
  at?: number; id: string; method: VoiceMethod; text: string; canonical: string; context: VoiceContext; decision: VoiceDecision;
  utterance: { hits: { keyword: string; score?: number }[]; busyMs: number; stage1BusyMs?: number; stage2BusyMs?: number; text?: string; passes?: number; speechMs: number; audioMs: number; decisionMs?: number };
}): Extract<VoiceRecord, { kind: "utterance" }> {
  const u = input.utterance;
  return { kind: "utterance", at: input.at ?? Date.now(), method: input.method, utteranceId: input.id, text: input.text.slice(0, 2000), canonical: input.canonical.slice(0, 200), context: input.context, decision: input.decision,
    stage1: { hits: u.hits.slice(0, 100).map(hit => ({ keyword: hit.keyword.slice(0, 200), score: hit.score ?? null })), busyMs: u.stage1BusyMs ?? (input.method === "asr" ? 0 : u.busyMs) },
    stage2: { transcript: u.text?.slice(0, 2000) ?? null, busyMs: u.stage2BusyMs ?? (input.method === "asr" ? u.busyMs : 0), passes: u.passes ?? 0 },
    speechMs: u.speechMs, audioMs: u.audioMs, decisionMs: u.decisionMs ?? 0 };
}
