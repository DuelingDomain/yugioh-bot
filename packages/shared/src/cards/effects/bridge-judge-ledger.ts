import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { BRIDGE_JUDGE_MODEL, bridgeJudgeRates } from "./bridge-judge-model.js";

export const BRIDGE_JUDGE_OUTPUT_TOKENS = 4096;
// Reserve the full context at the highest cache-write tier, including output.
export const BRIDGE_JUDGE_RESERVATION_MICROS = 1_000_000 + BRIDGE_JUDGE_OUTPUT_TOKENS * 2.5;
export interface BridgeJudgeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
}
export interface BridgeJudgeSpendSummary { requests: number; actualMicros: number; reservedMicros: number }

export function bridgeJudgeBilledMicros(usage: BridgeJudgeUsage, batch = false, model: string = BRIDGE_JUDGE_MODEL): number {
  const input = usage.input_tokens, output = usage.output_tokens;
  const writes = usage.cache_creation_input_tokens ?? 0, reads = usage.cache_read_input_tokens ?? 0;
  const hourWrites = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const fiveWrites = usage.cache_creation?.ephemeral_5m_input_tokens ?? writes - hourWrites;
  if ([input, output, writes, reads, hourWrites, fiveWrites].some(value => !Number.isSafeInteger(value) || value < 0)
    || hourWrites + fiveWrites !== writes || input + writes + reads > 1_000_000 || output > BRIDGE_JUDGE_OUTPUT_TOKENS) throw new Error("Invalid bridge judge usage");
  const rates = bridgeJudgeRates(model, input + writes + reads);
  return Math.ceil((input * rates.input + fiveWrites * rates.fiveWrite + hourWrites * rates.hourWrite + reads * rates.read + output * rates.output) / (batch ? 2 : 1));
}

export function reserveBridgeJudgeSpend(db: Database.Database, options: { id?: string; requestKey?: string; count: number; batch?: boolean; now?: Date; monthlyUsd?: string | number }): string | null {
  if (!Number.isSafeInteger(options.count) || options.count < 1) throw new Error("Invalid bridge judge reservation count");
  const now = options.now ?? new Date(), month = now.toISOString().slice(0, 7);
  const cap = options.monthlyUsd === undefined ? undefined : Number(options.monthlyUsd);
  if (cap !== undefined && (!Number.isFinite(cap) || cap < 0 || String(options.monthlyUsd).trim() === "")) throw new Error("Invalid bridge judge monthly budget");
  const reserved = Math.ceil(BRIDGE_JUDGE_RESERVATION_MICROS * options.count / (options.batch ? 2 : 1));
  return db.transaction(() => {
    if (options.requestKey && db.prepare("SELECT 1 FROM bridge_judge_spend WHERE request_key=?").get(options.requestKey)) return null;
    const used = db.prepare<[string], { micros: number }>(`SELECT coalesce(sum(CASE WHEN state='settled' THEN actual_micros ELSE reserved_micros END),0) AS micros FROM bridge_judge_spend WHERE month=?`).get(month)!.micros;
    if (cap !== undefined && used + reserved > cap * 1_000_000) return null;
    const id = options.id ?? randomBytes(16).toString("hex");
    db.prepare("INSERT INTO bridge_judge_spend(id,request_key,month,state,reserved_micros,requests,batch,created_at) VALUES(?,?,?,'reserved',?,?,?,?)").run(id, options.requestKey ?? null, month, reserved, options.count, options.batch ? 1 : 0, now.toISOString());
    return id;
  }).immediate();
}

export function startBridgeJudgeSpend(db: Database.Database, id: string): void {
  if (db.prepare("UPDATE bridge_judge_spend SET state='submission_started' WHERE id=? AND state='reserved'").run(id).changes !== 1) throw new Error("Bridge judge reservation unavailable");
}

export function releaseBridgeJudgeSpend(db: Database.Database, id: string, failedLiveRequest = false): void {
  db.prepare("DELETE FROM bridge_judge_spend WHERE id=? AND (state='reserved' OR ? AND state='submission_started' AND batch=0)").run(id, failedLiveRequest ? 1 : 0);
}

export function settleBridgeJudgeSpend(db: Database.Database, id: string, usage: BridgeJudgeUsage, batch?: boolean, model: string = BRIDGE_JUDGE_MODEL): void {
  const row = db.prepare("SELECT reserved_micros,batch FROM bridge_judge_spend WHERE id=? AND state='submission_started'").get(id) as { reserved_micros: number; batch: number } | undefined;
  if (!row || batch !== undefined && Number(batch) !== row.batch) throw new Error("Bridge judge settlement unavailable");
  const actual = bridgeJudgeBilledMicros(usage, !!row.batch, model);
  if (actual > row.reserved_micros) throw new Error("Bridge judge usage exceeds reservation");
  db.prepare("UPDATE bridge_judge_spend SET state='settled',actual_micros=?,usage_json=? WHERE id=? AND state='submission_started'").run(actual, JSON.stringify(usage), id);
}

export function bridgeJudgeSpendSummary(db: Database.Database, id?: string): BridgeJudgeSpendSummary {
  return db.prepare(`SELECT coalesce(sum(requests),0) AS requests,coalesce(sum(actual_micros),0) AS actualMicros,
    coalesce(sum(CASE WHEN state!='settled' THEN reserved_micros ELSE 0 END),0) AS reservedMicros FROM bridge_judge_spend${id ? " WHERE id=?" : ""}`).get(...(id ? [id] : [])) as BridgeJudgeSpendSummary;
}
