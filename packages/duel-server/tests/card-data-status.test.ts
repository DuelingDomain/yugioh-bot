import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { computeCardDataGap, createLocalCardDataStatus } from "../src/card-data-status.js";
const card = (id: number, name = "Card", cardSets: Array<{ set_name: string; set_code?: string }> = []) =>
  ({ id, name, type: "Normal Monster", frameType: "normal", cardSets });

it("uses canonical alias and persisted artwork families, deduplicating missing cards newest first", () => {
  const result = computeCardDataGap(
    [{ id: 10, alias: 0 }, { id: 20, alias: 10 }, { id: 30, alias: 20 }].map(c => ({ ...c, name: "Known", type: 17 })),
    [card(31, "Known"), card(80, "New", [{ set_name: "New" }]), card(81, "New art"), card(70, "Old", [{ set_name: "Old", set_code: "OLD-EN001" }])],
    [{ cardId: 30, artworkId: 31 }, { cardId: 80, artworkId: 81 }],
    [{ name: "Old", code: "OLD", releaseDate: "2025-01-01" }, { name: "New", code: "NEW", releaseDate: "2026-09-01" }],
  );
  expect(result.cachedCatalogMissingCount).toBe(2);
  expect(result.cachedCatalogMissing).toEqual([
    { id: 80, name: "New", setCode: "NEW", setReleaseDate: "2026-09-01" },
    { id: 70, name: "Old", setCode: "OLD-EN001", setReleaseDate: "2025-01-01" },
  ]);
});

it("excludes skills and tokens and reports normalized same-name/type ID mismatches separately", () => {
  const result = computeCardDataGap([
    { id: 1, alias: 0, name: " CARD ", type: 17 },
    { id: 2, alias: 0, name: "Token", type: 0x4011 },
  ], [card(99, "card"), { ...card(3), frameType: "skill" }, { ...card(4), type: "Token", frameType: "token" },
    { ...card(5, "Card"), type: "Spell Card", frameType: "spell" }], [], []);
  expect(result.cachedCatalogMissing.map(c => c.id)).toEqual([5]);
  expect(result.cachedCatalogIdMismatch.map(c => c.id)).toEqual([99]);
});

it("keeps name-treatment aliases and different card types separate and tolerates alias cycles", () => {
  const result = computeCardDataGap([
    { id: 1, alias: 2, name: "Treated as Original", type: 17 },
    { id: 2, alias: 0, name: "Original", type: 17 },
    { id: 3, alias: 2, name: "Original", type: 2 },
    { id: 4, alias: 5, name: "Cycle", type: 17 }, { id: 5, alias: 4, name: "Cycle", type: 17 },
  ], [card(99, "Other"), card(5, "Cycle")], [], []);
  expect(result.cachedCatalogMissing.map(c => c.id)).toEqual([99]);
  expect(result.cachedCatalogIdMismatch).toEqual([]);
});

it("keeps the newest printing date even without a code and retains a known per-set printing code", () => {
  const sets = [{ name: "New", code: null, releaseDate: "2026-10-01" }, { name: "Old", code: "OLD", releaseDate: "2025-01-01" }];
  const newer = card(1, "New card", [{ set_name: "New" }, { set_name: "Old", set_code: "OLD-EN001" }]);
  expect(computeCardDataGap([], [newer], [], sets).cachedCatalogMissing).toEqual([
    { id: 1, name: "New card", setCode: null, setReleaseDate: "2026-10-01" },
  ]);
  const printing = card(2, "Printed", [{ set_name: "Old", set_code: "OLD-EN002" }, { set_name: "Old" }]);
  expect(computeCardDataGap([], [], [], sets, [{ ...sets[1], cards: [printing], checkedAt: "2026-10-01" }])
    .recentSets[0].missingCards[0].setCode).toBe("OLD-EN002");
});

function setup(manifest: object) {
  const dir = mkdtempSync(join(tmpdir(), "card-status-"));
  const db = new Database(":memory:"); migrate(db);
  const cdb = new Database(join(dir, "cards.cdb"));
  cdb.exec("create table datas (id integer primary key, alias integer, type integer); create table texts (id integer primary key, name text); insert into datas values (10,0,17); insert into texts values (10,'Known')"); cdb.close();
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return { dir, db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

it("uses the startup manifest and holds snapshots at least 60 seconds despite revision bumps", () => {
  const manifest = { bundleVersion: "v1", sources: { database: "pin", databaseFiles: ["cards.cdb", "release-new.cdb"] } };
  const { dir, db, cleanup } = setup(manifest);
  let now = Date.parse("2026-10-06T00:00:00Z");
  const read = createLocalCardDataStatus(db, dir, { manifest, now: () => now });
  try {
    const first = read();
    expect(first.engine).toMatchObject({ cardCount: 1, cdbFiles: ["cards.cdb", "release-new.cdb"], preparedAt: null, preparedAtSource: "unknown" });
    db.exec(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (99,'Missing','Normal Monster','normal','','','[]','2026-01-01T00:00:00Z')`);
    now += 59_999; expect(read()).toBe(first);
    now++; expect(read().gap.cachedCatalogMissingCount).toBe(1);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "replaced", sources: {} }));
    now += 60_000; expect(read().engine.bundleVersion).toBe("v1");
  } finally { cleanup(); }
});

it("supports old manifest shape without inventing preparation time or finding unrelated CDB strings", () => {
  const { dir, db, cleanup } = setup({ bundleVersion: "old", sources: { database: "pin" }, unrelated: "other.cdb" });
  try {
    expect(createLocalCardDataStatus(db, dir)().engine).toMatchObject({ cdbFiles: ["cards.cdb"], preparedAt: null, preparedAtSource: "unknown" });
  } finally { cleanup(); }
});

it.each([null, "cards.cdb", ["cards.cdb", 7], [], ["cards.cdb", "nested/release-new.cdb"]].map(databaseFiles => [databaseFiles]))("rejects malformed explicit databaseFiles %j", (databaseFiles) => {
  const { dir, db, cleanup } = setup({ bundleVersion: "bad", sources: { databaseFiles } });
  try { expect(() => createLocalCardDataStatus(db, dir)()).toThrow(/databaseFiles/); }
  finally { cleanup(); }
});
