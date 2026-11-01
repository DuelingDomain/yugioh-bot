/** Read-only, reproducible Next engine evidence. Never invokes a paid judge. */
import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { BridgeEngineQueries } from "../../packages/duel-server/src/bridge-engine-queries.js";
import type { ArchetypeBridge } from "../../packages/shared/src/cards/effects/bridge-types.js";
import type { BridgeDeck } from "../../packages/shared/src/cards/effects/bridge-engines.js";

const [dbPath, output, listsPath = "packages/shared/data/staples/decks.json"] = process.argv.slice(2);
if (!dbPath || !output) throw Error("Usage: compare-approach.ts DB OUTPUT [LISTS]");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const queries = new BridgeEngineQueries(db);
  const lists = Object.values(JSON.parse(readFileSync(listsPath, "utf8"))).flat() as (BridgeDeck & { archetype: string; url: string })[];
  const decks = [10, 9].map(id => {
    const row = db.prepare("SELECT deck_json,mode FROM saved_decks WHERE id=?").get(id) as { deck_json: string; mode: "normal" | "domain" };
    return { label: `deck ${id}`, source: `saved_decks:${id}`, deck: { ...JSON.parse(row.deck_json), mode: row.mode } as BridgeDeck };
  });
  for (const name of ["Labrynth", "Snake-Eye"]) {
    const row = lists.find(row => row.archetype === name) ?? lists.find(row => queries.service.detectEngines(row, "advanced").some(engine => engine.name === name && engine.status === "engine"));
    if (!row) throw Error(`Missing ${name} fixture`);
    decks.push({ label: name, source: row.url, deck: { main: row.main, extra: row.extra, side: row.side } });
  }
  const samples = [];
  for (const { label, source, deck } of decks) {
    const { query, detected } = queries.resolve({ deck, format: "advanced" }, "approach-report");
    const stored = queries.service.engineRows(query.engines, query.format);
    const project = (rows: ArchetypeBridge[]) => queries.project(rows, query, 8).next.map(row => ({
      engine: row.engine, kind: row.kind ?? "bridge", score: row.score,
      cards: row.cards, core: row.core, pros: row.pros,
    }));
    const raw = new Map<string, ArchetypeBridge>();
    for (const engine of query.engines) for (const row of [
      ...queries.service.deepCandidates(engine, query.format, undefined, false),
      ...queries.service.deepInto(engine, query.format),
    ]) raw.set(JSON.stringify([row.source, row.target, row.format]), row);
    samples.push({ label, source, detected, engines: query.engines, next: project(stored),
      candidateCount: raw.size, shortlist: queries.shortlist([...raw.values()], query).map(row => ({
        engine: row.engine, kind: row.kind ?? "bridge", score: row.score,
        reasons: row.links.flatMap(link => link.bridge.reasons.map(reason => reason.description)),
      })) });
    console.log(`${label}: ${samples.at(-1)!.next.length} accepted; ${raw.size} raw candidates`);
  }
  writeFileSync(output, JSON.stringify({ samples }, null, 2) + "\n");
} finally { db.close(); }
