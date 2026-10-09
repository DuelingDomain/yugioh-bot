import { seedUser } from "../helpers/identity.js";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

// The card fetch queue starts 5 requests a second. Raise it before the module loads so the test does not wait.
process.env.CARD_FETCH_REQUESTS_PER_SECOND = "1000";
const { migrate } = await import("../../src/db/index.js");
const { createCubeService } = await import("../../src/services/cubes.js");
const { createCardCatalogService } = await import("../../src/services/card-catalog.js");

function catalogWith(db: Database.Database, calls: string[], limit = Infinity) {
  return createCardCatalogService(db, {
    fetch: async (input) => {
      const url = new URL(String(input));
      calls.push(url.search);
      const ids = (url.searchParams.get("id") ?? "").split(",").filter(Boolean).map(Number).filter((id) => id < limit);
      const data = ids.map((id) => id > 1000
        ? { id, name: `Extra ${id}`, type: "Fusion Monster", frameType: "fusion", card_images: [{ image_url: "i", image_url_small: "i" }] }
        : { id, name: `Main ${id}`, type: "Effect Monster", frameType: "effect", card_images: [{ image_url: "i", image_url_small: "i" }] });
      return { ok: true, async json() { return { data }; } } as Response;
    },
  });
}

describe("long passcode imports", () => {
  const main = Array.from({ length: 90 }, (_, i) => i + 1);
  const extra = Array.from({ length: 30 }, (_, i) => i + 1001);

  it("looks up past the 50 request limit in batches, so Extra Deck passcodes at the end of a file stay", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const calls: string[] = [];
    const cubes = createCubeService(db, catalogWith(db, calls));
    const cube = cubes.createBlank("g", "Long", seedUser(db, "u").userId);
    // The file lists the main deck first and the Extra Deck last, like a .ydk.
    const res = await cubes.importPasscodeGroups(cube.id, [{ codes: main, pool: "main" }, { codes: extra, pool: "extra" }]);
    expect(res).toEqual({ added: 120, unknown: [] });
    const pools = cubes.getCubePools(cube.id);
    expect([pools.main.length, pools.extra.length]).toEqual([90, 30]);
    // 120 passcodes in batches of 20, and no one-card id lookups.
    expect(calls.filter((search) => /id=[^&]*(%2C|,)/.test(search))).toHaveLength(6);
    expect(calls.filter((search) => /id=\d+(&|$)/.test(search))).toHaveLength(0);
  });

  it("leaves a passcode the batch did not return to the one-by-one lookup, then reports it unknown", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const calls: string[] = [];
    const cubes = createCubeService(db, catalogWith(db, calls, 1030));
    const cube = cubes.createBlank("g", "Long", seedUser(db, "u").userId);
    const res = await cubes.importPasscodeGroups(cube.id, [{ codes: [...main.slice(0, 10), 1001, 1031] }]);
    expect(res).toEqual({ added: 11, unknown: [1031] });
    expect(cubes.getCubePools(cube.id).extra.map((c) => c.catalogCardId)).toEqual([1001]);
  });
});
