import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { computeCardDataGap, createLocalCardDataStatus } from "../src/card-data-status.js";

it("compares passcodes and transitive alias/artwork families in both directions, newest first", () => {
  const result = computeCardDataGap(
    [{ id: 10, alias: 0 }, { id: 20, alias: 10 }, { id: 30, alias: 20 }, { id: 40, alias: 50 }, { id: 50, alias: 0 }, { id: 60, alias: 0 }].map(card => ({ ...card, name: "Artwork", type: 1 })),
    [
      { id: 10, name: "Known", cardSets: [] }, { id: 31, name: "Known artwork", cardSets: [] },
      { id: 50, name: "Alias target", cardSets: [] },
      { id: 70, name: "Old", cardSets: [{ set_name: "Old", set_code: "OLD-EN001" }] },
      { id: 80, name: "New", cardSets: [{ set_name: "New" }, { set_name: "Old" }] },
      { id: 81, name: "New artwork", cardSets: [] }, { id: 90, name: "Undated", cardSets: [] },
    ],
    [{ cardId: 30, artworkId: 31 }, { cardId: 80, artworkId: 81 }],
    [{ name: "Old", code: "OLD", releaseDate: "2025-01-01" }, { name: "New", code: "NEW", releaseDate: "2026-09-01" }],
  );
  expect(result).toEqual({
    catalogMissingFromEngineCount: 3,
    catalogMissingFromEngine: [
      { id: 80, name: "New", setCode: "NEW", setReleaseDate: "2026-09-01" },
      { id: 70, name: "Old", setCode: "OLD-EN001", setReleaseDate: "2025-01-01" },
      { id: 90, name: "Undated", setCode: null, setReleaseDate: null },
    ], engineMissingFromCatalogCount: 1,
  });
});

it("handles empty pools and alias cycles without hanging", () => {
  expect(computeCardDataGap([], [], [], [])).toEqual({ catalogMissingFromEngineCount: 0, catalogMissingFromEngine: [], engineMissingFromCatalogCount: 0 });
  expect(computeCardDataGap([{ id: 1, alias: 2, name: "Cycle", type: 1 }, { id: 2, alias: 1, name: "Cycle", type: 1 }], [{ id: 2, name: "Cycle", cardSets: [] }], [], []).engineMissingFromCatalogCount).toBe(0);
});

it("reads manifest CDB provenance and caches until a catalog revision or bundle change", () => {
  const dir = mkdtempSync(join(tmpdir(), "card-status-"));
  const db = new Database(":memory:"); migrate(db);
  const cdb = new Database(join(dir, "cards.cdb"));
  cdb.exec("create table datas (id integer primary key, alias integer, type integer); create table texts (id integer primary key, name text); insert into datas values (10,0,1); insert into texts values (10,'Known')"); cdb.close();
  const manifest = (bundleVersion: string) => writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    bundleVersion, preparedAt: "2026-01-01T00:00:00Z", sources: { database: "pin", databaseFiles: ["cards.cdb", "release-new.cdb"] },
  }));
  manifest("v1");
  const read = createLocalCardDataStatus(db, dir);
  try {
    const first = read();
    expect(first.engine).toMatchObject({ cardCount: 1, cdbFiles: ["cards.cdb", "release-new.cdb"], preparedAtSource: "manifest" });
    expect(first.catalog.lastSuccessfulSyncAt).toBeNull();
    expect(read()).toBe(first);
    db.exec("insert into players (guild_id, discord_user_id, display_name) values ('g','u','U')");
    expect(read()).toBe(first);
    db.exec(`insert into card_sets (set_name,set_code,synced_at,release_date) values ('New','NEW','2026-01-01T00:00:00Z','2026-01-01');
      insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (99,'Missing','Monster','normal','','','[{"set_name":"New"}]','2026-01-01T00:00:00Z')`);
    const second = read();
    expect(second).not.toBe(first);
    expect(second.gap.catalogMissingFromEngineCount).toBe(1);
    expect(second.catalog.newestSets).toEqual([{ name: "New", code: "NEW", releaseDate: "2026-01-01" }]);
    db.exec("delete from card_catalog");
    expect(read().gap.catalogMissingFromEngineCount).toBe(0);
    manifest("v2");
    expect(read().engine.bundleVersion).toBe("v2");
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "v3", sources: {} }));
    expect(read().engine.preparedAtSource).toBe("manifest-mtime");
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it("keeps the newest date even if its set code is unknown", () => {
  expect(computeCardDataGap([], [{ id: 1, name: "New card", cardSets: [{ set_name: "New" }, { set_name: "Old" }] }], [], [
    { name: "New", code: null, releaseDate: "2026-10-01" }, { name: "Old", code: "OLD", releaseDate: "2025-01-01" },
  ]).catalogMissingFromEngine).toEqual([{ id: 1, name: "New card", setCode: null, setReleaseDate: "2026-10-01" }]);
});

it("keeps name-treatment aliases and different card types as distinct engine cards", () => {
  const engine = [
    { id: 1, alias: 2, name: "Treated as Original", type: 1 },
    { id: 2, alias: 0, name: "Original", type: 1 },
    { id: 3, alias: 2, name: "Original", type: 2 },
  ];
  expect(computeCardDataGap(engine, [{ id: 2, name: "Original", cardSets: [] }], [], []).engineMissingFromCatalogCount).toBe(2);
});
