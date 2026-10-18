import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("../src/lib/web-access", () => ({ requireWebAccess: vi.fn() }));

it("shares the startup database, prepared seed data and request guard across separate server module graphs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "effect-startup-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "shared.sqlite"));
  vi.stubEnv("DUEL_DATA_DIR", join(directory, "absent-engine"));
  let db: import("better-sqlite3").Database | undefined;
  try {
    const firstDb = await import("../src/lib/db");
    const separateDb = "../src/lib/db.ts?server-graph=route";
    const routeDb = await import(separateDb) as typeof firstDb;
    expect(routeDb).not.toBe(firstDb);
    db = firstDb.getDb();
    expect(routeDb.getDb()).toBe(db);
    db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(46986414,'Dark Magician','Normal Monster','normal','i','s','[]',CURRENT_TIMESTAMP)`).run();

    const startup = await import("../../shared/src/services/cube-seed-index.js");
    const separateIndex = new URL("../../shared/src/services/cube-seed-index.ts?server-graph=route", import.meta.url).href;
    const route = await import(separateIndex) as typeof startup;
    expect(route).not.toBe(startup);
    const prepared = startup.prepareCubeSeedIndex(db);
    expect(route.getCubeSeedIndex(routeDb.getDb())).toBe(prepared);

    const cube = await import("../src/lib/cube-effects-api");
    const separateGuard = "../src/lib/cube-effects-api.ts?server-graph=draft";
    const draft = await import(separateGuard) as typeof cube;
    expect(draft).not.toBe(cube);
    const held = cube.acquireCubeSeedPreview(600001);
    expect(held.ok).toBe(true);
    if (!held.ok) throw new Error("Failed to reserve first preview");
    try {
      const overlap = draft.acquireCubeSeedPreview(600001);
      expect(overlap.ok).toBe(false);
      if (!overlap.ok) {
        expect(overlap.response.status).toBe(429);
        expect(await overlap.response.json()).toEqual({ error: "cube_seed_preview_in_flight" });
      }
    } finally { held.release(); }
    const next = draft.acquireCubeSeedPreview(600001);
    expect(next.ok).toBe(true);
    if (next.ok) next.release();
  } finally {
    db?.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
  }
});
