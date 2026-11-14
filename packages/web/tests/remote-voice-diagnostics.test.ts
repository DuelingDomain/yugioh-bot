import { voiceBatchSchema } from "@/lib/remote/voice-diagnostics-schema";
import { expect, it } from "vitest";
import { VoiceDiagnosticsBatcher, utteranceRecord, type VoiceRecord } from "@/lib/remote/voice-diagnostics";
import { analyseDiagnostics } from "../../../scripts/voice/analyse-diagnostics";

const context = { turn: 3, phase: "main1", turnSeat: 0, ownSeat: 0 };
const utterance = (id: string, decisionMs = 100) => utteranceRecord({ id, method: "two-stage", text: "battle face", canonical: "battle phase", context,
  decision: { outcome: "acted", reason: null, actionId: `action-${id}` },
  utterance: { hits: [{ keyword: "BATTLE", score: 0.7 }], text: "battle face", passes: 2, stage1BusyMs: 10, stage2BusyMs: 20, busyMs: 30, audioMs: 1200, speechMs: 500, decisionMs } });
it("builds text/number records from existing work, preserves stage times and has no path for PCM", () => {
  const workerResult = { hits: [{ keyword: "F1" }], text: "standby phase", passes: 1, busyMs: 30, stage1BusyMs: 10, stage2BusyMs: 20, speechMs: 500, audioMs: 900, decisionMs: 100, samples: new Float32Array([0.1, 0.2]) };
  const record = utteranceRecord({ id: "a", method: "two-stage", text: "standby phase", canonical: "standby phase", context, decision: { outcome: "rejected", reason: "illegal-phase", actionId: null }, utterance: workerResult });
  expect(record).toMatchObject({ stage1: { hits: [{ keyword: "F1", score: null }], busyMs: 10 }, stage2: { transcript: "standby phase", busyMs: 20, passes: 1 }, context, speechMs: 500, audioMs: 900, decisionMs: 100 });
  expect(JSON.stringify(record)).not.toContain("samples");
  expect(voiceBatchSchema.safeParse({ records: [record] }).success).toBe(true);
});
it("batches no more often than five seconds, drops the oldest backlog and flushes on hide; failures are silent", () => {
  let now = 1000; const sent: { body: string; hiding: boolean }[] = [];
  const queue = new VoiceDiagnosticsBatcher((body, hiding) => { sent.push({ body, hiding }); }, () => now);
  queue.add(utterance("first")); queue.flush(); queue.add(utterance("next")); queue.flush();
  expect(sent).toHaveLength(1);
  now += 5000; queue.flush(); expect(sent).toHaveLength(2);
  for (let n = 0; n < 200; n++) queue.add(utterance(String(n)));
  queue.flush(); expect(sent).toHaveLength(2);
  queue.flush(true); expect(sent).toHaveLength(3); expect(sent[2].hiding).toBe(true);
  expect(Buffer.byteLength(sent[2].body)).toBeLessThan(65536);
  const batch = voiceBatchSchema.parse(JSON.parse(sent[2].body));
  expect(batch.records.at(-1)).toMatchObject({ utteranceId: "199" });
  expect(batch.records.some(r => r.kind === "utterance" && r.utteranceId === "0")).toBe(false);
  const failed = new VoiceDiagnosticsBatcher(() => { throw new Error("offline"); });
  failed.add(utterance("failure")); expect(() => failed.flush()).not.toThrow();
});
it("analyses final decisions, confusion labels, deduplicated undos, nearest-rank p95 and work-weighted idle/active shares", () => {
  const a = utterance("a", 100), b = utterance("b", 200), c = utterance("c", 900);
  b.decision = { outcome: "rejected", reason: "needs-confirm", actionId: null };
  c.decision = { outcome: "rejected", reason: "not-a-command", actionId: null };
  const records: VoiceRecord[] = [a, b, c,
    { kind: "decision", at: b.at + 1, method: "two-stage", utteranceId: "b", context, decision: { outcome: "acted", reason: null, actionId: "action-b" } },
    { kind: "mark", at: 1, method: "two-stage", label: "wrong", utteranceId: "a", contextIds: [], intended: "nothing", note: "" },
    { kind: "mark", at: 2, method: "two-stage", label: "missed", utteranceId: null, contextIds: ["a"], intended: "end turn", note: "" },
    { kind: "undo", at: 3, method: "two-stage", utteranceId: "a", actionId: "action-a", msSinceAction: 10000 },
    { kind: "undo", at: 3, method: "two-stage", utteranceId: "a", actionId: "action-a", msSinceAction: 1000 },
    { kind: "undo", at: 3, method: "two-stage", utteranceId: "b", actionId: "action-b", msSinceAction: 10001 },
    { kind: "perf", at: 1, method: "two-stage", windowMs: 1000, stage1BusyMs: 50, stage2BusyMs: 100, idle: true },
    { kind: "perf", at: 2, method: "two-stage", windowMs: 3000, stage1BusyMs: 150, stage2BusyMs: 0, idle: true },
    { kind: "perf", at: 3, method: "two-stage", windowMs: 2000, stage1BusyMs: 200, stage2BusyMs: 400, idle: false }];
  const result = analyseDiagnostics(records)["two-stage"];
  expect(result).toMatchObject({ utterances: 3, acted: 2, rejected: { "not-a-command": 1 }, marks: { wrong: 1, missed: 1, falseActivation: 1 }, undoWithin10s: { count: 1, actions: 2, rate: 0.5 }, latency: { decision: { meanMs: 400, p95Ms: 900 } }, busy: { idle: { wallMs: 4000, stage1Share: 0.05, stage2Share: 0.025 }, active: { stage1Share: 0.1, stage2Share: 0.2 } } });
  expect(result.confused).toContainEqual({ transcript: "battle face", intended: "nothing", count: 1 });
  expect(analyseDiagnostics([]).asr).toMatchObject({ utterances: 0, undoWithin10s: { rate: null }, latency: { decision: { meanMs: null, p95Ms: null } } });
});
