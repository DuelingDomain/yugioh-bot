import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { importBridgeArtifact, rankEngineCandidates } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";

const db = new Database(":memory:");
try {
  migrate(db); importBridgeArtifact(db);
  if (process.argv.includes("--multi")) {
    const service = createBridgeService(db), context = service.rankingContext();
    const inputs = ["Odion", "Ashtra", "Blue-Eyes", "Fiendsmith"];
    const samples = [];
    for (const format of ["advanced", "genesys"] as const) for (let count = 1; count <= 4; count++) {
      const engines = inputs.slice(0, count).sort(), warm: number[] = [];
      let candidates = 0;
      const scan = () => {
        const rows = engines.flatMap(source => [...service.deepCandidates(source, format, undefined, false), ...service.deepInto(source, format)]);
        candidates = rankEngineCandidates(engines, rows, context).length;
      };
      const start = performance.now(); scan(); const cold = performance.now() - start;
      for (let i = 0; i < 5; i++) { const before = performance.now(); scan(); warm.push(performance.now() - before); }
      samples.push({ engines, format, scans: count * 2, candidates, cold_ms: Math.round(cold), warm_ms: warm.map(Math.round),
        p95_ms: Math.round([...warm].sort((a, b) => a - b)[Math.ceil(warm.length * 0.95) - 1]!) });
    }
    console.log(JSON.stringify({ mode: "multi-deterministic-no-paid-reviews", samples, rss_bytes: process.memoryUsage().rss }, null, 2));
  } else {
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
  }
} finally { db.close(); }
