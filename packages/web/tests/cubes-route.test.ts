import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDiscordAccess } from "./fixtures/discord-access";

const auth = vi.fn();
const tempDirs: string[] = [];
let discord: ReturnType<typeof mockDiscordAccess>;

vi.mock("@/lib/auth", () => ({ auth }));

async function setupDb() {
  const tempDir = mkdtempSync(join(tmpdir(), "yugioh-cubes-routes-"));
  const dbPath = join(tempDir, "cubes.sqlite");
  tempDirs.push(tempDir);
  process.env.DATABASE_PATH = dbPath;
  process.env.DISCORD_GUILD_ID = "guild-1";

  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("@yugidraft/shared/db");
  const db = new Database(dbPath);
  migrate(db);
  const ins = db.prepare(
    `insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
     values (?,?,?,?,?,?,?,?)`,
  );
  ins.run(1, "Main A", "Normal Monster", "normal", "i", "i", "[]", "t");
  ins.run(2, "Xyz B", "XYZ Monster", "xyz", "i", "i", "[]", "t");
  db.close();
}

async function cubeIdOf(name: string): Promise<number> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(process.env.DATABASE_PATH!);
  const row = db.prepare("select id from cubes where name = ?").get(name) as { id: number };
  db.close();
  return row.id;
}

describe("cube API routes", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: "creator", name: "Yugi" } });
    discord = mockDiscordAccess();
    discord.permissions = "0";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates a blank cube then imports passcodes routed to main/extra", async () => {
    await setupDb();

    const { POST: createCube } = await import("../app/api/cubes/route");
    const created = await createCube(
      new Request("http://x/api/cubes", {
        method: "POST",
        body: JSON.stringify({ kind: "blank", name: "Custom" }),
      }) as any,
    );
    expect(created.status).toBe(201);
    const { cube } = await created.json();

    const { POST: mutate } = await import("../app/api/cubes/[id]/cards/route");
    const res = await mutate(
      new Request("http://x", { method: "POST", body: JSON.stringify({ op: "import", codes: [1, 2] }) }) as any,
      { params: Promise.resolve({ id: String(cube.id) }) },
    );
    const body = await res.json();
    expect(body.pools.main.map((c: any) => c.catalogCardId)).toEqual([1]);
    expect(body.pools.extra.map((c: any) => c.catalogCardId)).toEqual([2]);
  });

  it("allows more than three copies of a card in a cube and rejects a count outside 1 to 99", async () => {
    await setupDb();
    const { POST: createCube } = await import("../app/api/cubes/route");
    const created = await createCube(
      new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "blank", name: "Stun" }) }) as any,
    );
    const { cube } = await created.json();
    const { POST: mutate } = await import("../app/api/cubes/[id]/cards/route");
    const post = (body: object) =>
      mutate(new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as any, {
        params: Promise.resolve({ id: String(cube.id) }),
      });

    const added = await post({ op: "add", catalogCardId: 1, pool: "main", maxCopies: 25 });
    expect(added.status).toBe(200);
    expect((await added.json()).pools.main[0].maxCopies).toBe(25);

    const raised = await post({ op: "setMaxCopies", catalogCardId: 1, maxCopies: 99 });
    expect(raised.status).toBe(200);
    expect((await raised.json()).pools.main[0].maxCopies).toBe(99);

    for (const maxCopies of [0, 100, 2.5, "5"]) {
      const bad = await post({ op: "setMaxCopies", catalogCardId: 1, maxCopies });
      expect(bad.status).toBe(400);
    }
    const bigImport = await post({ op: "import", codes: Array.from({ length: 7 }, () => 2) });
    expect((await bigImport.json()).pools.extra[0].maxCopies).toBe(7);
    const { getDb } = await import("../src/lib/db");
    expect(
      getDb().prepare("select max_copies from cube_cards where cube_id = ? and catalog_card_id = 1").get(cube.id),
    ).toEqual({ max_copies: 99 });
  });

  it("imports a YDK file into a cube, merging copies and reporting unknown passcodes", async () => {
    await setupDb();
    // The catalog asks ygoprodeck about a passcode it does not know; answer with no card.
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] })));
    const { POST: createCube } = await import("../app/api/cubes/route");
    const created = await createCube(
      new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "blank", name: "Imported" }) }) as any,
    );
    const { cube } = await created.json();
    const { POST: mutate } = await import("../app/api/cubes/[id]/cards/route");
    const post = (body: object) =>
      mutate(new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as any, {
        params: Promise.resolve({ id: String(cube.id) }),
      });

    const first = await post({ op: "importYdk", text: "#created by x\n#main\n1\n1\n1\n#extra\n2\n!side\n777\n" });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body).toMatchObject({ added: 2, copies: 4, unknown: [777] });
    expect(body.pools.main.map((c: any) => [c.catalogCardId, c.maxCopies])).toEqual([[1, 3]]);
    expect(body.pools.extra.map((c: any) => [c.catalogCardId, c.maxCopies])).toEqual([[2, 1]]);

    const second = await (await post({ op: "importYdk", text: "#main\n1\n" })).json();
    expect(second.pools.main[0].maxCopies).toBe(4);

    const cap = await (await post({ op: "importYdk", text: `#main\n${"1\n".repeat(150)}` })).json();
    expect(cap.pools.main[0].maxCopies).toBe(99);

    for (const text of ["", "   ", 5, "# only a comment\n", "x".repeat(600_000), "#deckmaster\n1\n#deckmaster\n2\n"]) {
      expect((await post({ op: "importYdk", text })).status).toBe(400);
    }
  });

  describe("import limits", () => {
    async function cubeAndPost() {
      await setupDb();
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] })));
      const { POST: createCube } = await import("../app/api/cubes/route");
      const created = await createCube(
        new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "blank", name: "Limits" }) }) as any,
      );
      const { cube } = await created.json();
      const { POST: mutate } = await import("../app/api/cubes/[id]/cards/route");
      return (body: object) =>
        mutate(new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as any, {
          params: Promise.resolve({ id: String(cube.id) }),
        });
    }
    const distinct = (n: number) => Array.from({ length: n }, (_, i) => 1_000_000 + i);

    it("rejects YDK text over 64 KB and more than 1000 different passcodes, with a clear message", async () => {
      const post = await cubeAndPost();
      const big = await post({ op: "importYdk", text: `#main\n${"1\n".repeat(33_000)}` });
      expect(big.status).toBe(400);
      expect((await big.json()).error).toMatch(/64 KB/);

      const many = await post({ op: "importYdk", text: `#main\n${distinct(1001).join("\n")}\n` });
      expect(many.status).toBe(400);
      expect((await many.json()).error).toBe("That list has 1001 different cards. Import at most 1000 at a time.");

      const ok = await post({ op: "importYdk", text: `#main\n${distinct(1000).join("\n")}\n` });
      expect(ok.status).toBe(200);
      expect((await ok.json()).unknown).toHaveLength(1000);
    });

    it("applies the same cap to the passcode import, counting different cards and not copies", async () => {
      const post = await cubeAndPost();
      const many = await post({ op: "import", codes: distinct(1001) });
      expect(many.status).toBe(400);
      expect((await many.json()).error).toMatch(/1001 different cards/);
      const copies = await post({ op: "import", codes: Array.from({ length: 3000 }, () => 1) });
      expect(copies.status).toBe(200);
    });

    it("lists a passcode the card database answers with HTTP 400 as unknown", async () => {
      const post = await cubeAndPost();
      const discordFetch = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
          String(input).includes("ygoprodeck") ? new Response("{}", { status: 400 }) : discordFetch(input, init),
        ),
      );
      const res = await post({ op: "importYdk", text: "#main\n1\n777\n#extra\n2\n888\n" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ added: 2, unknown: [777, 888] });
      expect(body.pools.main.map((c: any) => c.catalogCardId)).toEqual([1]);
      expect(body.pools.extra.map((c: any) => c.catalogCardId)).toEqual([2]);
    });
  });

  it("exports a cube as a .ydk download named after the cube", async () => {
    await setupDb();
    const { POST: createCube } = await import("../app/api/cubes/route");
    const created = await createCube(
      new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "blank", name: "Stun: pool" }) }) as any,
    );
    const { cube } = await created.json();
    const { POST: mutate } = await import("../app/api/cubes/[id]/cards/route");
    for (const op of [
      { op: "add", catalogCardId: 1, pool: "main", maxCopies: 2 },
      { op: "add", catalogCardId: 2, pool: "extra", maxCopies: 3 },
    ]) {
      await mutate(new Request("http://x", { method: "POST", body: JSON.stringify(op) }) as any, {
        params: Promise.resolve({ id: String(cube.id) }),
      });
    }

    const { GET: exportYdk } = await import("../app/api/cubes/[id]/ydk/route");
    const res = await exportYdk(new Request("http://x") as any, { params: Promise.resolve({ id: String(cube.id) }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('filename="Stun pool.ydk"');
    expect(await res.text()).toBe("#created by Duelists Kingdom\n#main\n1\n1\n#extra\n2\n2\n2\n!side\n");

    const missing = await exportYdk(new Request("http://x") as any, { params: Promise.resolve({ id: "9999" }) });
    expect(missing.status).toBe(404);

    // A cube from another guild is not readable.
    const { getDb } = await import("../src/lib/db");
    const foreign = Number(
      getDb().prepare("insert into cubes (guild_id, name, created_by_user_id) values ('other-guild','Foreign','x')").run()
        .lastInsertRowid,
    );
    const hidden = await exportYdk(new Request("http://x") as any, { params: Promise.resolve({ id: String(foreign) }) });
    expect(hidden.status).toBe(404);
  });

  it("lists cubes for the guild", async () => {
    await setupDb();
    const { POST: createCube, GET: listCubes } = await import("../app/api/cubes/route");
    await createCube(
      new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "blank", name: "Stun" }) }) as any,
    );
    const res = await listCubes();
    const body = await res.json();
    expect(body.cubes.map((c: any) => c.name)).toContain("Stun");
  });

  it("lists the main-pool passcodes of an editor-built cube so a saved pool can load them", async () => {
    await setupDb();
    const { POST: createCube, GET: listCubes } = await import("../app/api/cubes/route");
    const created = await createCube(
      new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "blank", name: "Dark Magician" }) }) as any,
    );
    const { cube } = await created.json();
    const { POST: mutate } = await import("../app/api/cubes/[id]/cards/route");
    await mutate(
      new Request("http://x", { method: "POST", body: JSON.stringify({ op: "import", codes: [1, 2] }) }) as any,
      { params: Promise.resolve({ id: String(cube.id) }) },
    );
    await createCube(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ name: "Saved", config: { setNames: ["Set A"], customCardIds: [1, 1] } }),
      }) as any,
    );

    const body = await (await listCubes()).json();
    const built = body.cubes.find((c: any) => c.name === "Dark Magician");
    expect(built).toMatchObject({ mainCount: 1, extraCount: 1, mainCards: [{ id: 1, copies: 1 }], customCardIds: [] });
    const saved = body.cubes.find((c: any) => c.name === "Saved");
    expect(saved).toMatchObject({ setNames: ["Set A"], customCardIds: [1, 1], mainCards: [] });
  });

  it("lists each main-pool card with its copies, and reads every cube with two queries", async () => {
    await setupDb();
    const { POST: createCube, GET: listCubes } = await import("../app/api/cubes/route");
    const { POST: mutate } = await import("../app/api/cubes/[id]/cards/route");
    const ids: number[] = [];
    for (const name of ["Alpha", "Beta", "Gamma"]) {
      const created = await createCube(
        new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "blank", name }) }) as any,
      );
      ids.push((await created.json()).cube.id);
    }
    const post = (id: number, body: object) =>
      mutate(new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as any, {
        params: Promise.resolve({ id: String(id) }),
      });
    await post(ids[0]!, { op: "add", catalogCardId: 1, pool: "main", maxCopies: 12 });
    await post(ids[1]!, { op: "add", catalogCardId: 1, pool: "main", maxCopies: 2 });
    await post(ids[1]!, { op: "add", catalogCardId: 2, pool: "extra", maxCopies: 3 });
    // A cube in another guild never shows up.
    const { getDb } = await import("../src/lib/db");
    const db = getDb();
    const foreign = Number(
      db.prepare("insert into cubes (guild_id, name, created_by_user_id) values ('other-guild','Foreign','x')").run()
        .lastInsertRowid,
    );
    db.prepare("insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) values (?, 1, 'main', 3)").run(foreign);

    const Database = (await import("better-sqlite3")).default;
    const prepare = vi.spyOn(Database.prototype, "prepare");
    const body = await (await listCubes()).json();
    const prepared = prepare.mock.calls.length;
    prepare.mockRestore();

    expect(prepared).toBeLessThanOrEqual(2);
    expect(body.cubes.map((c: any) => c.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    const [alpha, beta, gamma] = body.cubes;
    expect(alpha).toMatchObject({ mainCount: 1, extraCount: 0, mainCards: [{ id: 1, copies: 12 }] });
    expect(beta).toMatchObject({ mainCount: 1, extraCount: 1, mainCards: [{ id: 1, copies: 2 }] });
    expect(gamma).toMatchObject({ mainCount: 0, extraCount: 0, mainCards: [] });
  });

  it("saves a config-backed cube (pool) and rejects a duplicate name", async () => {
    await setupDb();
    const { POST: createCube } = await import("../app/api/cubes/route");

    const first = await createCube(
      new Request("http://x/api/cubes", {
        method: "POST",
        body: JSON.stringify({ name: "Goat Cube", config: { setNames: [], customCardIds: [46986414, 83764718] } }),
      }) as any,
    );
    expect(first.status).toBe(201);
    const { cube } = await first.json();
    expect(cube.name).toBe("Goat Cube");
    expect(cube.config.customCardIds).toEqual([46986414, 83764718]);

    const second = await createCube(
      new Request("http://x/api/cubes", {
        method: "POST",
        body: JSON.stringify({ name: "Goat Cube", config: { setNames: [], customCardIds: [99999999] } }),
      }) as any,
    );
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ error: 'A cube named "Goat Cube" already exists' });
  });

  it("creates an empty config-backed cube when the title is unique", async () => {
    await setupDb();
    const { POST: createCube } = await import("../app/api/cubes/route");
    const res = await createCube(
      new Request("http://x/api/cubes", {
        method: "POST",
        body: JSON.stringify({ name: "Empty Cube", config: { setNames: [], customCardIds: [] } }),
      }) as any,
    );
    expect(res.status).toBe(201);
    const { cube } = await res.json();
    expect(cube.name).toBe("Empty Cube");
    expect(cube.config.customCardIds).toEqual([]);
  });

  it("PUT renames a cube and 409s on a name collision", async () => {
    await setupDb();
    const { POST: createCube } = await import("../app/api/cubes/route");
    await createCube(new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "blank", name: "Alpha" }) }) as any);
    await createCube(new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "blank", name: "Beta" }) }) as any);
    const id = await cubeIdOf("Alpha");

    const { PUT } = await import("../app/api/cubes/[id]/route");
    const renamed = await PUT(
      new Request(`http://x/api/cubes/${id}`, { method: "PUT", body: JSON.stringify({ name: "Alpha Prime" }) }) as any,
      { params: Promise.resolve({ id: String(id) }) },
    );
    expect(renamed.status).toBe(200);
    expect(await cubeIdOf("Alpha Prime")).toBe(id);

    const collide = await PUT(
      new Request(`http://x/api/cubes/${id}`, { method: "PUT", body: JSON.stringify({ name: "Beta" }) }) as any,
      { params: Promise.resolve({ id: String(id) }) },
    );
    expect(collide.status).toBe(409);
  });

  describe("cube type", () => {
    const post = async (body: object) => {
      const { POST } = await import("../app/api/cubes/route");
      return POST(new Request("http://x/api/cubes", { method: "POST", body: JSON.stringify(body) }) as any);
    };
    const put = async (id: number, body: object) => {
      const { PUT } = await import("../app/api/cubes/[id]/route");
      return PUT(new Request(`http://x/api/cubes/${id}`, { method: "PUT", body: JSON.stringify(body) }) as any, {
        params: Promise.resolve({ id: String(id) }),
      });
    };
    const getOne = async (id: number) => {
      const { GET } = await import("../app/api/cubes/[id]/route");
      return (
        await GET(new Request(`http://x/api/cubes/${id}`) as any, { params: Promise.resolve({ id: String(id) }) })
      ).json();
    };
    const listed = async (name: string) => {
      const { GET } = await import("../app/api/cubes/route");
      return (await (await GET()).json()).cubes.find((c: any) => c.name === name);
    };

    it("defaults to any for a cube made without a type", async () => {
      await setupDb();
      const res = await post({ kind: "blank", name: "Plain" });
      expect(res.status).toBe(201);
      expect((await res.json()).cube.draftType).toBe("any");
      expect((await listed("Plain")).draftType).toBe("any");
      expect((await getOne(await cubeIdOf("Plain"))).cube.draftType).toBe("any");
    });

    it("stores the chosen type on a blank cube and on a saved config cube", async () => {
      await setupDb();
      const blank = await post({ kind: "blank", name: "Themed", draftType: "theme" });
      expect((await blank.json()).cube.draftType).toBe("theme");
      expect((await listed("Themed")).draftType).toBe("theme");

      const saved = await post({ name: "Pool", draftType: "booster", config: { setNames: [], customCardIds: [1] } });
      const { cube } = await saved.json();
      expect(cube.draftType).toBe("booster");
      expect(cube.config.customCardIds).toEqual([1]);
      expect((await listed("Pool")).draftType).toBe("booster");
    });

    it("rejects an unknown type with 400 and creates nothing", async () => {
      await setupDb();
      const res = await post({ kind: "blank", name: "Bad", draftType: "ladder" });
      expect(res.status).toBe(400);
      expect(await listed("Bad")).toBeUndefined();
    });

    it("PUT changes the type, keeps the other config keys and the name", async () => {
      await setupDb();
      await post({ name: "Pool", config: { setNames: ["Set A"], customCardIds: [7] } });
      const id = await cubeIdOf("Pool");
      // The create route keeps only the pool; pack settings arrive from elsewhere (a draft's saved config).
      const Database = (await import("better-sqlite3")).default;
      const raw = new Database(process.env.DATABASE_PATH!);
      raw
        .prepare("update cubes set config_json = ? where id = ?")
        .run(JSON.stringify({ setNames: ["Set A"], customCardIds: [7], cardsPerPlayer: 45, packSize: 9 }), id);
      raw.close();
      const res = await put(id, { draftType: "booster" });
      expect(res.status).toBe(200);
      const { cube } = await getOne(id);
      expect(cube.draftType).toBe("booster");
      expect(cube.name).toBe("Pool");
      expect(cube.settings).toMatchObject({ cardsPerPlayer: 45, packSize: 9 });
      const list = await listed("Pool");
      expect(list.setNames).toEqual(["Set A"]);
      expect(list.customCardIds).toEqual([7]);
    });

    it("PUT with a bad type or an empty body is 400, and a rename still works", async () => {
      await setupDb();
      await post({ kind: "blank", name: "Alpha", draftType: "theme" });
      const id = await cubeIdOf("Alpha");
      expect((await put(id, { draftType: "nope" })).status).toBe(400);
      expect((await put(id, {})).status).toBe(400);
      expect((await getOne(id)).cube.draftType).toBe("theme");
      expect((await put(id, { name: "Alpha Prime" })).status).toBe(200);
      expect((await getOne(id)).cube.draftType).toBe("theme");
    });
  });

  it("DELETE removes a cube; 404 on already-gone", async () => {
    await setupDb();
    const { POST: createCube } = await import("../app/api/cubes/route");
    await createCube(new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "blank", name: "Doomed" }) }) as any);
    const id = await cubeIdOf("Doomed");

    const { DELETE } = await import("../app/api/cubes/[id]/route");
    const ok = await DELETE(new Request(`http://x/api/cubes/${id}`, { method: "DELETE" }) as any, { params: Promise.resolve({ id: String(id) }) });
    expect(ok.status).toBe(200);
    const gone = await DELETE(new Request(`http://x/api/cubes/${id}`, { method: "DELETE" }) as any, { params: Promise.resolve({ id: String(id) }) });
    expect(gone.status).toBe(404);
  });

  it.each(["PUT", "DELETE", "cards"])("%s rejects non-owners and leaves the cube intact", async (method) => {
    await setupDb();
    const { POST } = await import("../app/api/cubes/route");
    const created = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "blank", name: "Owned" }) }));
    const { cube } = await created.json();
    auth.mockResolvedValue({ user: { id: "other-member" } });
    const route = await import("../app/api/cubes/[id]/route");
    const { POST: cards } = await import("../app/api/cubes/[id]/cards/route");
    const handler = method === "cards" ? cards : method === "PUT" ? route.PUT : route.DELETE;
    const res = await handler(new Request("http://x", {
      method: method === "cards" ? "POST" : method,
      body: method === "DELETE" ? undefined : JSON.stringify({ name: "Stolen", op: "add", catalogCardId: 1, pool: "main" }),
    }), { params: Promise.resolve({ id: String(cube.id) }) });
    expect(res.status).toBe(403);
    expect(await cubeIdOf("Owned")).toBe(cube.id);
    const { getDb } = await import("../src/lib/db");
    expect(getDb().prepare("select count(*) as n from cube_cards where cube_id = ?").get(cube.id)).toEqual({ n: 0 });
  });

  it.each(["PUT", "DELETE", "cards"])("%s allows a guild admin who is not the owner", async (method) => {
    await setupDb();
    const { POST } = await import("../app/api/cubes/route");
    const created = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "blank", name: "Owned" }) }));
    const { cube } = await created.json();
    auth.mockResolvedValue({ user: { id: "admin" } });
    discord.permissions = "32";
    const route = await import("../app/api/cubes/[id]/route");
    const { POST: cards } = await import("../app/api/cubes/[id]/cards/route");
    const handler = method === "cards" ? cards : method === "PUT" ? route.PUT : route.DELETE;
    const res = await handler(new Request("http://x", {
      method: method === "cards" ? "POST" : method,
      body: method === "DELETE" ? undefined : JSON.stringify({ name: "Admin edit", op: "add", catalogCardId: 1, pool: "main" }),
    }), { params: Promise.resolve({ id: String(cube.id) }) });
    expect(res.status).toBe(200);
  });

  it.each(["PUT", "DELETE", "cards"])("%s rejects even an owner who is no longer a member", async (method) => {
    await setupDb();
    const { getDb } = await import("../src/lib/db");
    const cubeId = Number(getDb().prepare("insert into cubes (guild_id, name, created_by_user_id) values ('guild-1','Owned','creator')").run().lastInsertRowid);
    discord.memberStatus = 404;
    const route = await import("../app/api/cubes/[id]/route");
    const { POST: cards } = await import("../app/api/cubes/[id]/cards/route");
    const handler = method === "cards" ? cards : method === "PUT" ? route.PUT : route.DELETE;
    const res = await handler(new Request("http://x", {
      method: method === "cards" ? "POST" : method,
      body: method === "DELETE" ? undefined : JSON.stringify({ name: "Stolen", op: "add", catalogCardId: 1, pool: "main" }),
    }), { params: Promise.resolve({ id: String(cubeId) }) });
    expect(res.status).toBe(403);
  });

  it.each(["PUT", "DELETE", "cards"])("%s cannot mutate a cube in another guild", async (method) => {
    await setupDb();
    const { getDb } = await import("../src/lib/db");
    const cubeId = Number(getDb().prepare("insert into cubes (guild_id, name, created_by_user_id) values ('other-guild','Foreign','creator')").run().lastInsertRowid);
    const route = await import("../app/api/cubes/[id]/route");
    const { POST: cards } = await import("../app/api/cubes/[id]/cards/route");
    const handler = method === "cards" ? cards : method === "PUT" ? route.PUT : route.DELETE;
    const res = await handler(new Request("http://x", {
      method: method === "cards" ? "POST" : method,
      body: method === "DELETE" ? undefined : JSON.stringify({ name: "Stolen", op: "add", catalogCardId: 1, pool: "main" }),
    }), { params: Promise.resolve({ id: String(cubeId) }) });
    expect(res.status).toBe(404);
  });
});
