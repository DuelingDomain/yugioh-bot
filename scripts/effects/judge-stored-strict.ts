import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { migrate } from "@yugidraft/shared/db";
import { bridgeGate, bridgeJudgeSpendSummary, buildBridgeJudgeEvidence, judgeBridgePair, readBridgeJudgements, saveBridgeJudgement,
  type ArchetypeBridge, type BridgeJudgeOptions } from "@yugidraft/shared/cards/effects";
import { BridgeEngineQueries } from "../../packages/duel-server/src/bridge-engine-queries.js";
import { exportBridgeBatchJudgements } from "./judge-bridges.js";

/** One pass over every stored strict row; judgeBridgePair owns both reviews, fact checks and reservations. */
export async function judgeStoredStrict(db: Database.Database, options: BridgeJudgeOptions = {}) {
  const rows = (db.prepare(`SELECT bridge_json FROM archetype_bridge
    WHERE coalesce(json_extract(bridge_json,'$.tier'),'strict')='strict' ORDER BY format,source,target`).all() as { bridge_json: string }[])
    .map(row => JSON.parse(row.bridge_json) as ArchetypeBridge);
  const before = bridgeJudgeSpendSummary(db);
  let next = 0, completed = 0;
  await Promise.all(Array.from({ length: Math.min(2, rows.length) }, async () => {
    while (next < rows.length) {
      await judgeBridgePair(db, rows[next++]!, options);
      if (++completed % 10 === 0) console.log(JSON.stringify({ completed, total: rows.length }));
    }
  }));
  const counts = (format: string) => {
    const counts = { total: 0, accepted: 0, rejected: 0, disputed: 0, pending: 0 };
    for (const row of rows.filter(row => row.format === format)) {
      counts.total++;
      const state = bridgeGate(db, row).state;
      counts[state === "shown" ? "accepted" : state === "invalid" ? "rejected" : state === "review" ? "disputed" : "pending"]++;
    }
    return counts;
  };
  const queries = new BridgeEngineQueries(db);
  const groups = Object.keys(queries.service.rankingContext().groups);
  const fastLists: Record<string, number> = {};
  for (const format of ["advanced", "genesys"] as const) {
    fastLists[format] = groups.filter(source => queries.project(queries.service.engineRows([source], format),
      { source, engines: [source], format }).next.length > 0).length;
  }
  const after = bridgeJudgeSpendSummary(db);
  return { advanced: counts("advanced"), genesys: counts("genesys"), fastLists,
    requests: after.requests - before.requests, costUsd: (after.actualMicros - before.actualMicros) / 1_000_000,
    reservedUsd: after.reservedMicros / 1_000_000 };
}

async function main() {
  const { values } = parseArgs({ options: { database: { type: "string" }, output: { type: "string" },
    "process-id": { type: "string" }, child: { type: "boolean" } } });
  if (!values.database || !values.output) throw new Error("Pass --database and --output");
  if (!values.child) {
    if (!/^\d+$/.test(values["process-id"] ?? "")) throw new Error("Pass the running duel-server --process-id");
    const proc = `/proc/${values["process-id"]}`;
    const cmd = readFileSync(`${proc}/cmdline`, "utf8").replaceAll("\0", " ");
    if (!/server\.[jt]s/.test(cmd)) throw new Error("The selected process is not a duel server");
    // Credentials enter only the child environment. Never log this buffer or environment.
    const inherited = Object.fromEntries(readFileSync(`${proc}/environ`, "utf8").split("\0").filter(Boolean)
      .map(entry => { const split = entry.indexOf("="); return [entry.slice(0, split), entry.slice(split + 1)]; }));
    if (!inherited.ANTHROPIC_API_KEY) throw new Error("The duel-server process has no Anthropic key");
    const child = spawnSync(process.execPath, ["--conditions=source", "--import", "tsx", process.argv[1]!,
      "--database", values.database, "--output", values.output, "--child"], {
      env: { ...process.env, ...inherited, BRIDGE_JUDGE_MODEL: "claude-haiku-5-5" }, stdio: "inherit",
    });
    process.exitCode = child.status ?? 1; return;
  }
  const output = resolve(values.output); mkdirSync(output, { recursive: true, mode: 0o700 });
  const backup = join(output, "bot-before.sqlite"), scratch = join(output, "judging.sqlite");
  if (existsSync(scratch)) throw new Error("One-time judging scratch DB already exists; do not automatically repeat paid calls");
  const source = new Database(resolve(values.database), { readonly: true, fileMustExist: true });
  try {
    if (!existsSync(backup)) await source.backup(backup);
    await source.backup(scratch);
  } finally { source.close(); }
  const db = new Database(scratch);
  try {
    // Schema changes are confined to the scratch copy, never the duel-host DB.
    migrate(db);
    db.pragma("busy_timeout=5000");
    const errors: unknown[] = [];
    const result = await judgeStoredStrict(db, { log: () => {}, onError: entry => { errors.push(entry); console.error(JSON.stringify(entry)); } });
    const live = new Database(resolve(values.database), { fileMustExist: true });
    try {
      live.pragma("busy_timeout=5000");
      // Only judgement writes; the existing trigger invalidates bridge caches.
      const rows = db.prepare("SELECT bridge_json FROM archetype_bridge WHERE coalesce(json_extract(bridge_json,'$.tier'),'strict')='strict'").all() as { bridge_json: string }[];
      live.transaction(() => {
        for (const value of rows) {
          const row = JSON.parse(value.bridge_json) as ArchetypeBridge;
          const evidence = buildBridgeJudgeEvidence(db, row);
          if (!evidence) continue;
          if (buildBridgeJudgeEvidence(live, row)?.input_hash !== evidence.input_hash) throw new Error("Live bridge evidence changed during judging; no verdicts written");
          for (const record of readBridgeJudgements(db, row.evidence_hash).filter(record => record.input_hash === evidence.input_hash)) {
            const existing = live.prepare("SELECT judgement_json FROM bridge_judgement WHERE evidence_hash=? AND judge=?").get(record.evidence_hash, record.judge) as { judgement_json: string } | undefined;
            if (existing?.judgement_json !== JSON.stringify(record)) saveBridgeJudgement(live, record);
          }
        }
      }).immediate();
    } finally { live.close(); }
    exportBridgeBatchJudgements(db, "packages/shared/data/effects");
    writeFileSync(join(output, "report.json"), JSON.stringify({ ...result, backup, scratch, errors }, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  const key = process.env.ANTHROPIC_API_KEY;
  const message = error instanceof Error ? error.message : "Stored strict judging failed";
  console.error((key ? message.replaceAll(key, "[redacted]") : message).replace(/sk-ant-[\w-]+/g, "[redacted]"));
  process.exitCode = 1;
});
