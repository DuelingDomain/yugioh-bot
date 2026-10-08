import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";

/** Repeatable, cache-only workload; timing is informational, correctness is asserted. */
it("measures a 1000-name resolution against a 13000-name catalog", async () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    const names = Array.from({ length: 13000 }, (_, i) => `Ancient Dragon ${i.toString(36)} of the Hidden Kingdom`);
    const insert = db.prepare(`insert into card_catalog
      (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (?,?,'Effect Monster','effect','i','i','[]','t')`);
    db.transaction(() => names.forEach((name, i) => insert.run(i + 1, name)))();
    const indices = Array.from({ length: 1000 }, (_, i) => i * 13);
    const catalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch: async () => { throw new Error("Unexpected remote fetch"); } });
    const started = performance.now();
    const resolved = await catalog.resolveCardNames(indices.map((i) => names[i]));
    const elapsed = performance.now() - started;
    expect(resolved.map((r) => r.card?.ygoprodeckId)).toEqual(indices.map((i) => i + 1));
    const result = { inputNames: 1000, catalogNames: 13000, elapsedMs: Number(elapsed.toFixed(2)) };
    if (process.env.CARD_NAME_BENCHMARK_RESULT) writeFileSync(process.env.CARD_NAME_BENCHMARK_RESULT, JSON.stringify(result));
    console.info(`1000 inputs / 13000 catalog names: ${elapsed.toFixed(2)} ms`);
  } finally { db.close(); }
}, 60000);
