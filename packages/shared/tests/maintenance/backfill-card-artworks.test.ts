import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { backfillCardArtworks } from "../../src/maintenance/backfill-card-artworks.js";
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it("downloads once, checkpoints after commits, and resumes offline without duplicates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-backfill-")); dirs.push(dir);
  const input = { database: join(dir, "test.sqlite"), dump: join(dir, "dump.json"), state: join(dir, "state.json") };
  const db = new Database(input.database); migrate(db);
  db.exec(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values
    (10,'D10','Normal Monster','normal','','','[]','now'),(20,'D20','Normal Monster','normal','','','[]','now');`); db.close();
  const fetch = vi.fn(async () => Response.json({ data: [10,20].map(id => ({ id, name: `D${id}`, type: "Normal Monster", frameType: "normal",
    card_images: [id,id+1].map(id => ({ id, image_url: "full", image_url_small: "small" })) })) }));
  await expect(backfillCardArtworks({ ...input, fetch, onProgress: () => { throw new Error("stop"); } })).rejects.toThrow("stop");
  expect(JSON.parse(readFileSync(input.state,"utf8")).afterId).toBe(10);
  expect(await backfillCardArtworks({ ...input, fetch })).toEqual({ synced: 1, unmatched: [] });
  expect(await backfillCardArtworks({ ...input, fetch })).toEqual({ synced: 0, unmatched: [] });
  expect(fetch).toHaveBeenCalledTimes(1);
  const checked = new Database(input.database);
  expect(checked.prepare("select count(*) as n from card_artworks").get()).toEqual({ n: 4 }); checked.close();
  await expect(backfillCardArtworks({ ...input, dump: input.database, fetch })).rejects.toThrow("distinct");
});

it("dry-runs with a read-only database and no checkpoint, then applies the same dump", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-dry-run-")); dirs.push(dir);
  const input = { database: join(dir, "test.sqlite"), dump: join(dir, "dump.json"), state: join(dir, "state.json") };
  const db = new Database(input.database); migrate(db);
  db.exec("insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (10,'Dragon','Normal Monster','normal','','','[]','now')");
  writeFileSync(input.dump, JSON.stringify({ data: [{ id: 10, name: "Dragon", type: "Normal Monster", frameType: "normal", card_images: [{ id: 10, image_url: "full", image_url_small: "small" }] }] }));
  const before = readFileSync(input.database);
  expect(await backfillCardArtworks({ ...input, dryRun: true })).toEqual({ synced: 0, wouldSync: 1, unmatched: [] });
  expect(readFileSync(input.database)).toEqual(before);
  expect(db.prepare("select count(*) as n from card_artworks").get()).toEqual({ n: 0 });
  expect(existsSync(input.state)).toBe(false);
  expect(await backfillCardArtworks(input)).toEqual({ synced: 1, unmatched: [] });
  db.close();
});
it("resolves npm workspace paths and the default engine data against INIT_CWD", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-paths-")); dirs.push(dir);
  vi.stubEnv("INIT_CWD", dir); vi.stubEnv("DUEL_DATA_DIR", "");
  const engine = join(dir, "data/duel-engine"); mkdirSync(engine, { recursive: true });
  const cdb = new Database(join(engine, "cards.cdb"));
  cdb.exec("create table datas (id integer, alias integer, type integer); create table texts (id integer, name text); insert into datas values (10,0,17),(11,10,17); insert into texts values (10,'Dragon'),(11,'Dragon')"); cdb.close();
  const db = new Database(join(dir, "test.sqlite")); migrate(db);
  db.exec("insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (11,'Dragon','Normal Monster','normal','','','[]','now')");
  writeFileSync(join(dir, "dump.json"), JSON.stringify({ data: [{ id: 11, name: "Dragon", type: "Normal Monster", frameType: "normal", card_images: [{ id: 11, image_url: "full", image_url_small: "small" }] }] }));
  expect(await backfillCardArtworks({ database: "test.sqlite", dump: "dump.json", state: "state.json" })).toEqual({ synced: 1, unmatched: [] });
  expect(db.prepare("select card_id from card_artworks where artwork_id = 11").get()).toEqual({ card_id: 10 }); db.close();
});
