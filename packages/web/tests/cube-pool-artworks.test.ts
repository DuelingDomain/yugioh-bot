import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createCardCatalogService } from "@yugidraft/shared/services";
import { ensureCatalogCards } from "../src/lib/cube-pool";

it("materializes engine-only artwork IDs before a cube can reference them", async () => {
  const db = new Database(":memory:"); migrate(db);
  const fixtures = JSON.parse(readFileSync(new URL("../../shared/tests/fixtures/card-artworks.json", import.meta.url), "utf8"));
  const catalog = createCardCatalogService(db, { identityCatalog: new Map([
    [89631139, { name: "Blue-Eyes White Dragon", type: 17, alias: 0 }],
    [89631147, { name: "Blue-Eyes White Dragon", type: 17, alias: 89631139 }],
  ]), fetch: async () => ({ ok: true, json: async () => ({ data: [fixtures[1]] }) }) });
  try {
    await catalog.syncCardByName("Blue-Eyes White Dragon");
    expect(catalog.findByIds([89631147])).toHaveLength(1);
    expect(catalog.hasCatalogRow(89631147)).toBe(false);
    expect(await ensureCatalogCards(catalog, [89631147])).toEqual([]);
    expect(catalog.hasCatalogRow(89631147)).toBe(true);
    expect(catalog.canonicalId(89631147)).toBe(89631139);
  } finally { db.close(); }
});
