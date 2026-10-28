import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { importBridgeArtifact } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";

const db = new Database(":memory:");
try {
  migrate(db); importBridgeArtifact(db);
  const result = [];
  for (const format of ["advanced", "genesys"] as const) {
    const service = createBridgeService(db), start = performance.now();
    const phases: { phase: string; elapsed_ms: number }[] = [];
    const rows = service.liveCandidates("Odion", format, progress => {
      if (!phases.some(value => value.phase === progress.phase)) phases.push({ phase: progress.phase, elapsed_ms: Math.round(performance.now() - start) });
    });
    const cold = performance.now() - start, samples = [];
    for (let i = 0; i < 5; i++) {
      const before = performance.now(); service.liveCandidates("Odion", format); samples.push(performance.now() - before);
    }
    result.push({ format, candidates: rows.length, cold_ms: Math.round(cold), phases, warm_ms: samples.map(Math.round) });
  }
  console.log(JSON.stringify({ sources: result, rss_bytes: process.memoryUsage().rss }, null, 2));
} finally { db.close(); }
