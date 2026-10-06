import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { backfillCardArtworks } from "../../src/maintenance/backfill-card-artworks.js";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
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
