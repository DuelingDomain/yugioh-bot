import { voiceRecordSchema } from "../../packages/web/src/lib/remote/voice-diagnostics-schema";
import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { voiceMethods, voiceMethodLabels, type VoiceRecord } from "../../packages/web/src/lib/remote/voice-diagnostics";

const summary = (values: number[]) => {
  values.sort((a, b) => a - b);
  return { meanMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, p95Ms: values.length ? values[Math.ceil(values.length * 0.95) - 1] : null };
};
/** Final outcomes supersede needs-confirm; each action/undo is counted once. Busy share is work / wall time, not OS CPU. */
export function analyseDiagnostics(records: VoiceRecord[]) {
  const utterances = new Map<string, Extract<VoiceRecord, { kind: "utterance" }>>();
  for (const record of records) if (record.kind === "utterance") utterances.set(record.utteranceId, record);
  const decisions = new Map([...utterances].map(([id, record]) => [id, { at: record.at, decision: record.decision }]));
  for (const record of records) if (record.kind === "decision" && record.at >= (decisions.get(record.utteranceId)?.at ?? 0)) decisions.set(record.utteranceId, record);
  return Object.fromEntries(voiceMethods.map(method => {
    const rows = [...utterances.values()].filter(record => record.method === method);
    const acted = new Set<string>(), rejected: Record<string, number> = {};
    for (const row of rows) {
      const decision = decisions.get(row.utteranceId)!.decision;
      if (decision.outcome === "acted") acted.add(decision.actionId);
      else rejected[decision.reason] = (rejected[decision.reason] ?? 0) + 1;
    }
    const marks = records.filter((r): r is Extract<VoiceRecord, { kind: "mark" }> => r.kind === "mark" && r.method === method);
    const confused = new Map<string, { transcript: string; intended: string; count: number }>();
    for (const mark of marks) {
      const row = mark.utteranceId ? utterances.get(mark.utteranceId) : undefined;
      const transcript = row?.text ?? "(missed)", intended = mark.intended === "free-text" ? mark.note : mark.intended;
      const key = JSON.stringify([transcript, intended]);
      const pair = confused.get(key) ?? { transcript, intended, count: 0 }; pair.count++; confused.set(key, pair);
    }
    const undone = new Set(records.filter((r): r is Extract<VoiceRecord, { kind: "undo" }> => r.kind === "undo" && r.method === method && r.msSinceAction <= 10_000 && acted.has(r.actionId)).map(r => r.actionId));
    const perf = records.filter((r): r is Extract<VoiceRecord, { kind: "perf" }> => r.kind === "perf" && r.method === method);
    const busy = (idle: boolean) => {
      const windows = perf.filter(record => record.idle === idle);
      const wallMs = windows.reduce((n, r) => n + r.windowMs, 0);
      const stage1BusyMs = windows.reduce((n, r) => n + r.stage1BusyMs, 0), stage2BusyMs = windows.reduce((n, r) => n + r.stage2BusyMs, 0);
      return { wallMs, stage1BusyMs, stage2BusyMs, stage1Share: wallMs ? stage1BusyMs / wallMs : null, stage2Share: wallMs ? stage2BusyMs / wallMs : null };
    };
    return [method, { utterances: rows.length, acted: acted.size, rejected,
      marks: { wrong: marks.filter(r => r.label === "wrong").length, missed: marks.filter(r => r.label === "missed").length,
        falseActivation: marks.filter(r => r.label === "wrong" && r.intended === "nothing" && r.utteranceId && utterances.get(r.utteranceId)?.canonical).length },
      confused: [...confused.values()].sort((a, b) => b.count - a.count || a.transcript.localeCompare(b.transcript)).slice(0, 20),
      undoWithin10s: { count: undone.size, actions: acted.size, rate: acted.size ? undone.size / acted.size : null },
      latency: { decision: summary(rows.map(r => r.decisionMs)), speech: summary(rows.map(r => r.speechMs)), audio: summary(rows.map(r => r.audioMs)) },
      busy: { idle: busy(true), active: busy(false) } }];
  }));
}

const envelope = z.object({ serverTime: z.number().optional(), userId: z.number().optional(), seat: z.number().optional(), tableSlug: z.string().optional(), buildId: z.string().optional() }).passthrough();
async function inputFiles(paths: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const path of paths) {
    const entries = await readdir(path, { withFileTypes: true }).catch(error => { if (error.code === "ENOTDIR") return null; throw error; });
    if (!entries) { result.push(path); continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) result.push(...await inputFiles([join(path, entry.name)]));
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(join(path, entry.name));
    }
  }
  return [...new Set(result)].sort();
}
async function main(args: string[]) {
  const paths = args.filter(arg => arg !== "--json");
  if (!paths.length) throw new Error("Usage: analyse-diagnostics.ts <dir or files> [--json]");
  const records: VoiceRecord[] = [];
  for (const file of await inputFiles(paths)) {
    let line = 0;
    for (const text of (await readFile(file, "utf8")).split("\n")) {
      line++; if (!text.trim()) continue;
      try {
        const { serverTime, userId, seat, tableSlug, buildId, ...record } = envelope.parse(JSON.parse(text));
        records.push(voiceRecordSchema.parse(record));
      } catch { throw new Error(`Invalid diagnostics record: ${file}:${line}`); }
    }
  }
  const result = analyseDiagnostics(records);
  if (args.includes("--json")) { console.log(JSON.stringify(result, null, 2)); return; }
  for (const method of voiceMethods) console.log(`${voiceMethodLabels[method]}\n${JSON.stringify(result[method], null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
