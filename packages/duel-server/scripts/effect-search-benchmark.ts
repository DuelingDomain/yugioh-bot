/** Read-only catalog benchmark; imports effect data into an ephemeral SQLite database. */
import Database from "better-sqlite3";
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { migrate } from "@yugidraft/shared/db";
import { importCardEffectArtifact } from "@yugidraft/shared/cards/effects";
import { emptyCardQuery } from "@yugidraft/shared/duels";
import { loadCardDatabase } from "../src/cards.js";
import { createCanonicalEffectResolver, createCardEffectIndex } from "../src/card-effects.js";
import { queryCards } from "../src/card-search.js";

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const directory = argument("--engine-directory") ?? process.env.DUEL_DATA_DIR;
if (!directory) throw new Error("Supply --engine-directory or DUEL_DATA_DIR; engine files are read-only.");
const cards = loadCardDatabase(resolve(directory));
const db = new Database(":memory:");
const names = ["Ash Blossom", "Dark Magician", "Blue-Eyes White Dragon", "Raigeki", "Effect Veiler", "Mystical Space Typhoon", "12345678"];
const measure = (scope: "name" | "all", enabled: boolean) => {
  const samples: number[] = [];
  for (let i = 0; i < 735; i++) {
    const start = performance.now();
    queryCards(cards, { ...emptyCardQuery(), text: names[i % names.length]!, scope }, undefined, undefined, { effectSearchEnabled: enabled });
    if (i >= 35) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { samples: samples.length, medianMs: samples[350], p95Ms: samples[665] };
};

try {
  migrate(db);
  const nameBefore = measure("name", false);
  const defaultScopeBefore = measure("all", false);
  global.gc?.();
  const engineMemory = process.memoryUsage();
  const imported = importCardEffectArtifact(db, { canonicalize: createCanonicalEffectResolver(cards) });
  global.gc?.();
  const importedMemory = process.memoryUsage();
  const index = createCardEffectIndex(db, cards);
  global.gc?.();
  const indexedMemory = process.memoryUsage();
  const report = {
    cards: [...cards.all()].length, tags: index.size, artifactVersion: imported.version,
    forcedGC: Boolean(global.gc), nameBefore, nameAfter: measure("name", true),
    defaultScopeBefore, defaultScopeAfter: measure("all", true), engineMemory, importedMemory, indexedMemory,
    indexHeapDelta: indexedMemory.heapUsed - importedMemory.heapUsed,
    indexRssDelta: indexedMemory.rss - importedMemory.rss,
    overallRssDelta: indexedMemory.rss - engineMemory.rss,
  };
  const serialized = JSON.stringify(report, null, 2) + "\n";
  const output = argument("--output");
  if (output) { mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, serialized); }
  console.log(serialized);
} finally {
  db.close(); cards.close();
}
