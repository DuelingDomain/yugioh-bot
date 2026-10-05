import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createCardCatalogService, createCubeService } from "@yugidraft/shared/services";
import { importYdkIntoCube } from "@/lib/cube-ydk";
import { parseDeckText } from "@/components/duel/ydk";
import { mergeCopies, serializeYdk, ydkFileName } from "@/lib/ydk-file";

function setup(fetchImpl?: (input: RequestInfo | URL) => Promise<Response>) {
  const db = new Database(":memory:");
  migrate(db);
  const seed = db.prepare(
    `insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
     values (?,?,?,?,?,?,?,?)`,
  );
  seed.run(1, "Main A", "Normal Monster", "normal", "i", "i", "[]", "t");
  seed.run(2, "Xyz B", "XYZ Monster", "xyz", "i", "i", "[]", "t");
  seed.run(3, "Spell C", "Spell Card", "spell", "i", "i", "[]", "t");
  // A catalog that knows nothing more: an unknown passcode stays unknown, with no network call.
  const catalog = createCardCatalogService(db, {
    fetch: fetchImpl ?? (async () => ({ ok: true, async json() { return { data: [] }; } }) as Response),
  });
  const cubes = createCubeService(db, catalog);
  const cube = cubes.createBlank("g", "Pool", "u");
  return { cubes, cube };
}

const pairs = (entries: Array<{ catalogCardId: number; maxCopies: number }>) =>
  entries.map((e) => [e.catalogCardId, e.maxCopies]);

describe("serializeYdk", () => {
  it("writes the brand header, every copy of each pool and an empty side", () => {
    const text = serializeYdk(
      [{ catalogCardId: 1, maxCopies: 3 }, { catalogCardId: 3, maxCopies: 1 }],
      [{ catalogCardId: 2, maxCopies: 2 }],
    );
    expect(text).toBe("#created by Duelists Kingdom\n#main\n1\n1\n1\n3\n#extra\n2\n2\n!side\n");
  });

  it("round trips through parseYdk", () => {
    const main = [{ catalogCardId: 1, maxCopies: 40 }, { catalogCardId: 3, maxCopies: 2 }];
    const extra = [{ catalogCardId: 2, maxCopies: 15 }];
    const parsed = parseDeckText(serializeYdk(main, extra));
    expect(parsed.main).toHaveLength(42);
    expect(parsed.extra).toHaveLength(15);
    expect(parsed.side).toEqual([]);
    expect(mergeCopies(parsed.main, new Map()).filter((c) => c === 1)).toHaveLength(40);
  });
});

describe("mergeCopies", () => {
  it("adds file copies to the copies the cube holds, capped at 99", () => {
    const merged = mergeCopies([1, 1, 2], new Map([[1, 1], [2, 98]]));
    expect(merged.filter((c) => c === 1)).toHaveLength(3);
    expect(merged.filter((c) => c === 2)).toHaveLength(99);
    expect(mergeCopies(Array(150).fill(4), new Map())).toHaveLength(99);
  });
});

describe("ydkFileName", () => {
  it("uses the cube name and removes characters a file name cannot hold", () => {
    expect(ydkFileName("Blue-Eyes pool")).toBe("Blue-Eyes pool.ydk");
    expect(ydkFileName('a/b:c*"d')).toBe("a b c d.ydk");
    expect(ydkFileName("..")).toBe("cube.ydk");
  });
});

describe("importYdkIntoCube", () => {
  it("counts each line as a copy and routes Extra Deck monsters and #extra lines to the extra pool", async () => {
    const { cubes, cube } = setup();
    const res = await importYdkIntoCube(cubes, cube.id, "#main\n1\n1\n1\n2\n#extra\n2\n2\n!side\n3\n");
    const pools = cubes.getCubePools(cube.id);
    // Card 2 is an Xyz monster: its #main line goes to the extra pool too, so it holds 3 copies.
    expect(pairs(pools.main)).toEqual([[1, 3], [3, 1]]);
    expect(pairs(pools.extra)).toEqual([[2, 3]]);
    expect(res).toMatchObject({ added: 3, copies: 7, unknown: [] });
  });

  it("reads a file with a byte order mark, CRLF lines and comments", async () => {
    const { cubes, cube } = setup();
    await importYdkIntoCube(cubes, cube.id, "\uFEFF#created by someone\r\n#main\r\n1\r\n1\r\n#extra\r\n2\r\n!side\r\n");
    const pools = cubes.getCubePools(cube.id);
    expect(pairs(pools.main)).toEqual([[1, 2]]);
    expect(pairs(pools.extra)).toEqual([[2, 1]]);
  });

  it("sends a normal monster listed under #extra to the extra pool", async () => {
    const { cubes, cube } = setup();
    await importYdkIntoCube(cubes, cube.id, "#extra\n1\n");
    expect(pairs(cubes.getCubePools(cube.id).extra)).toEqual([[1, 1]]);
  });

  it("merges into the cube and stops at 99 copies", async () => {
    const { cubes, cube } = setup();
    cubes.addCard(cube.id, 1, "main", 98);
    const res = await importYdkIntoCube(cubes, cube.id, `#main\n${"1\n".repeat(5)}`);
    expect(pairs(cubes.getCubePools(cube.id).main)).toEqual([[1, 99]]);
    expect(res.copies).toBe(1);
    const again = await importYdkIntoCube(cubes, cube.id, `#main\n${"1\n".repeat(120)}`);
    expect(pairs(cubes.getCubePools(cube.id).main)).toEqual([[1, 99]]);
    expect(again.copies).toBe(0);
  });

  it("adds a second import on top of the first", async () => {
    const { cubes, cube } = setup();
    await importYdkIntoCube(cubes, cube.id, "#main\n1\n1\n");
    await importYdkIntoCube(cubes, cube.id, "#main\n1\n3\n");
    expect(pairs(cubes.getCubePools(cube.id).main)).toEqual([[1, 3], [3, 1]]);
  });

  it("reports unknown passcodes once and still adds the known cards", async () => {
    const { cubes, cube } = setup();
    const res = await importYdkIntoCube(cubes, cube.id, "#main\n1\n9999999\n9999999\n#extra\n9999999\nnope\n");
    expect(res.unknown).toEqual([9999999]);
    expect(res.added).toBe(1);
    expect(res.copies).toBe(1);
    expect(pairs(cubes.getCubePools(cube.id).main)).toEqual([[1, 1]]);
  });

  it("reads a plain passcode list with no #main header as the main section", async () => {
    const { cubes, cube } = setup();
    const res = await importYdkIntoCube(cubes, cube.id, "1\n1\n3\n");
    expect(pairs(cubes.getCubePools(cube.id).main)).toEqual([[1, 2], [3, 1]]);
    expect(res).toMatchObject({ added: 2, copies: 3 });
    // A header later in the file still moves the reader on.
    const more = await importYdkIntoCube(cubes, cube.id, "1\n#extra\n2\n");
    expect(pairs(cubes.getCubePools(cube.id).main)).toEqual([[1, 3], [3, 1]]);
    expect(pairs(cubes.getCubePools(cube.id).extra)).toEqual([[2, 1]]);
    expect(more.added).toBe(2);
  });

  it("treats a passcode the card database rejects with HTTP 400 as unknown, and writes nothing twice", async () => {
    const { cubes, cube } = setup(async () => Response.json({
      error: "No card matching your query was found in the database. Please see https://db.ygoprodeck.com/api-guide/ for syntax usage.",
    }, { status: 400 }));
    const text = "#main\n1\n1\n777\n#extra\n2\n888\n";
    const res = await importYdkIntoCube(cubes, cube.id, text);
    expect(res.unknown).toEqual([777, 888]);
    expect(pairs(cubes.getCubePools(cube.id).main)).toEqual([[1, 2]]);
    expect(pairs(cubes.getCubePools(cube.id).extra)).toEqual([[2, 1]]);
    // Retrying the same file adds the copies once more, never a half-written extra.
    await importYdkIntoCube(cubes, cube.id, text);
    expect(pairs(cubes.getCubePools(cube.id).main)).toEqual([[1, 4]]);
    expect(pairs(cubes.getCubePools(cube.id).extra)).toEqual([[2, 2]]);
  });

  it("writes nothing when the card database cannot be reached", async () => {
    const { cubes, cube } = setup(async () => {
      throw new Error("fetch failed");
    });
    await expect(importYdkIntoCube(cubes, cube.id, "#main\n1\n999\n#extra\n2\n")).rejects.toThrow(/Could not reach/);
    expect(cubes.getCubePools(cube.id)).toEqual({ main: [], extra: [] });
  });
});
