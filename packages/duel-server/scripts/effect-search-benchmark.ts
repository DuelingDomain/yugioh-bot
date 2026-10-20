/** Read-only engine benchmark. Each startup opens the same disposable disk DB in a fresh process. */
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrate } from "@yugidraft/shared/db";
import { importCardEffectArtifact } from "@yugidraft/shared/cards/effects";
import { emptyCardQuery } from "@yugidraft/shared/duels";
import { loadCardDatabase } from "../src/cards.js";
import type { CardEffectIndex } from "../src/card-effects.js";
import { queryCards } from "../src/card-search.js";

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const directory = argument("--engine-directory") ?? process.env.DUEL_DATA_DIR;
if (!directory) throw new Error("Supply --engine-directory or DUEL_DATA_DIR; engine files are read-only.");
if (!global.gc) throw new Error("Run Node with --expose-gc to measure retained startup memory.");
const phase = argument("--phase");

if (!phase) {
  const temporary = mkdtempSync(join(tmpdir(), "effect-search-benchmark-"));
  try {
    const database = join(temporary, "shared.sqlite");
    const run = (phase: string) => new Promise<any>((complete, reject) => {
      const options = ["--import-module", "--index-module"].flatMap(name => argument(name) ? [name, resolve(argument(name)!)] : []);
      const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--engine-directory", resolve(directory), "--database", database, "--phase", phase, ...options], { stdio: ["ignore", "pipe", "pipe"] });
      let active = false, treePeak = 0, childPeak = 0, samples = 0, baseline = 0, pending = "", stderr = "", report: any;
      const rss = (pid: number) => {
        try { return Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) * 1024; }
        catch { return 0; }
      };
      const sample = () => {
        if (!active || !child.pid || process.platform !== "linux") return;
        const main = rss(child.pid);
        let descendants = 0;
        const queue = [child.pid];
        while (queue.length) {
          const pid = queue.pop()!;
          try {
            for (const value of readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean)) {
              const descendant = Number(value); descendants += rss(descendant); queue.push(descendant);
            }
          } catch { /* A decoder may exit between the children and RSS reads. */ }
        }
        treePeak = Math.max(treePeak, main + descendants); childPeak = Math.max(childPeak, descendants); samples++;
      };
      const timer = setInterval(sample, 5);
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        pending += chunk;
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          if (!line.trim()) continue;
          try {
            const value = JSON.parse(line);
            if (value.benchmarkEvent === "engine-ready") { baseline = value.rss; active = true; sample(); }
            else if (value.benchmarkEvent === "startup-finished") { sample(); active = false; }
            else report = value;
          } catch (error) { reject(error); }
        }
      });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", status => {
        clearInterval(timer);
        if (status !== 0 || !report) { reject(new Error(`Benchmark ${phase} failed (${status}): ${stderr || pending}`)); return; }
        complete({ ...report, sampledProcessTreePeakRss: samples ? treePeak : null,
          sampledProcessTreePeakRssDelta: samples ? treePeak - baseline : null,
          sampledDecoderPeakRss: samples ? childPeak : null, peakSampleIntervalMs: 5, peakSamples: samples });
      });
    });
    const firstImport = await run("first-import");
    const reusedVersion = await run("reused-version");
    if (firstImport.skipped || !reusedVersion.skipped) throw new Error("Benchmark did not exercise first-import and reused-version startup");
    const report = { ...firstImport, storage: "disk", firstImport, reusedVersion };
    const serialized = JSON.stringify(report, null, 2) + "\n";
    const output = argument("--output");
    if (output) { mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, serialized); }
    console.log(serialized);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  const database = argument("--database");
  if (!database) throw new Error("Internal benchmark phase requires --database");
  const importModule = argument("--import-module");
  const indexModule = argument("--index-module");
  const importArtifact: typeof importCardEffectArtifact = importModule
    ? (await import(pathToFileURL(resolve(importModule)).href)).importCardEffectArtifact : importCardEffectArtifact;
  const { createCanonicalEffectResolver, createCardEffectIndex, initializeCardEffectIndex } = await import(indexModule ? pathToFileURL(resolve(indexModule)).href : "../src/card-effects.js");
  const cards = loadCardDatabase(resolve(directory));
  const db = new Database(database);
  let installedIndex: CardEffectIndex | undefined;
  const names = ["Ash Blossom", "Dark Magician", "Blue-Eyes White Dragon", "Raigeki", "Effect Veiler", "Mystical Space Typhoon", "12345678"];
  const measure = (scope: "name" | "all", enabled: boolean) => {
    const samples: number[] = [];
    for (let i = 0; i < 735; i++) {
      const start = performance.now();
      queryCards(cards, { ...emptyCardQuery(), text: names[i % names.length]!, scope }, undefined, undefined, { effects: installedIndex, effectSearchEnabled: enabled });
      if (i >= 35) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { samples: samples.length, medianMs: samples[350], p95Ms: samples[665] };
  };
  const memory = async () => {
    global.gc!();
    await new Promise<void>(complete => setImmediate(complete));
    global.gc!();
    await new Promise<void>(complete => setImmediate(complete));
    return process.memoryUsage();
  };
  try {
    db.pragma("journal_mode=WAL");
    db.pragma("foreign_keys=ON");
    migrate(db);
    const nameBefore = measure("name", false);
    const defaultScopeBefore = measure("all", false);
    const engineMemory = await memory();
    const enginePeakRss = process.resourceUsage().maxRSS * 1024;
    writeSync(1, JSON.stringify({ benchmarkEvent: "engine-ready", rss: engineMemory.rss }) + "\n");
    const start = performance.now();
    const imported = importArtifact(db, { canonicalize: createCanonicalEffectResolver(cards) });
    const importMs = performance.now() - start;
    const importedMemory = await memory();
    const importedPeakRss = process.resourceUsage().maxRSS * 1024;
    const indexStart = performance.now();
    const index: CardEffectIndex = await (initializeCardEffectIndex ? initializeCardEffectIndex(db, cards) : createCardEffectIndex(db, cards));
    installedIndex = index;
    const indexMs = performance.now() - indexStart;
    const indexedMemory = await memory();
    const startupPeakRss = process.resourceUsage().maxRSS * 1024;
    writeSync(1, JSON.stringify({ benchmarkEvent: "startup-finished", rss: indexedMemory.rss }) + "\n");
    const reading = index.readQuery("banish a monster from the graveyard");
    if (!reading || ![...cards.all()].some(card => index.match(card.code, reading) !== null)) throw new Error("Actual effect index failed the search probe");
    const report = {
      phase, storage: "disk", skipped: imported.skipped,
      cards: [...cards.all()].length, tags: index.size, artifactVersion: imported.version,
      forcedGC: true, importMs, indexMs, startupMs: importMs + indexMs,
      nameBefore, nameAfter: measure("name", true),
      defaultScopeBefore, defaultScopeAfter: measure("all", true), engineMemory, importedMemory, indexedMemory,
      enginePeakRss, importedPeakRss, startupPeakRss,
      startupPeakRssDelta: startupPeakRss - engineMemory.rss,
      peakIncreaseOverEnginePeak: startupPeakRss - enginePeakRss,
      indexHeapDelta: indexedMemory.heapUsed - importedMemory.heapUsed,
      indexRssDelta: indexedMemory.rss - importedMemory.rss,
      overallRssDelta: indexedMemory.rss - engineMemory.rss,
      databaseBytes: statSync(database).size,
      coverage: { catalogCards: imported.coverage.catalogCards, taggedCards: imported.coverage.taggedCards, artifactOnlyCards: imported.coverage.artifactOnlyPasscodes.length },
    };
    console.log(JSON.stringify(report));
  } finally {
    db.close(); cards.close();
  }
}
