import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../shared/src/db/schema";
import { fixtureUserId, seedFixtureUsers } from "./fixtures/identity";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(state.auth);
});
const owner = fixtureUserId("cube-effects-owner");
const request = (body: unknown) => new Request("http://test/api", { method: "POST", body: JSON.stringify(body) });
const context = (id = "1") => ({ params: Promise.resolve({ id }) });
const db = () => state.db!;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DISCORD_GUILD_ID", "g");
  vi.stubEnv("EFFECT_SEARCH", "1");
  vi.stubEnv("DUEL_DATA_DIR", "/tmp/cube-effects-routes-no-engine");
  state.auth.mockResolvedValue({ user: { id: String(owner), name: "Owner" } });
  state.db = new Database(":memory:");
  migrate(db());
  seedFixtureUsers(db(), ["cube-effects-owner", "other"]);
  db().prepare("INSERT INTO cubes(id,guild_id,name,created_by_user_id) VALUES(1,'g','Seed cube',?),(2,'other-guild','Other',?)").run(owner, owner);
  const insert = db().prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,archetype,image_url,image_url_small,card_sets_json,cached_at)
    VALUES(?,?,?,?,?,?,?,?,'image','small','[]',CURRENT_TIMESTAMP)`);
  insert.run(46986414, "Dark Magician", "Spellcaster / Normal Monster", "normal", "The ultimate wizard.", "DARK", 7, "Dark Magician");
  insert.run(7084129, "Magician's Rod", "Spellcaster / Effect Monster", "effect", 'Add a card that mentions "Dark Magician".', "DARK", 3, "Dark Magician");
  insert.run(97268402, "Effect Veiler", "Spellcaster / Tuner Effect Monster", "effect", "Negate a monster effect.", "LIGHT", 1, null);
  insert.run(44508094, "Stardust Dragon", "Synchro Effect Monster", "synchro", "Negate destruction.", "WIND", 8, "Stardust");
});
afterEach(() => { state.db?.close(); vi.unstubAllEnvs(); });

describe("cube batch HTTP and SQLite boundary", () => {
  it("adds many chosen rows and reports duplicates without changing existing copies", async () => {
    const { POST } = await import("../app/api/cubes/[id]/cards/route");
    const body = { op: "addBatch", entries: [{ id: 46986414, copies: 4 }, { id: 44508094, copies: 2, pool: "main" }] };
    const response = await POST(request(body), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ added: 2, copies: 6, duplicates: [], pools: {
      main: [{ catalogCardId: 46986414, maxCopies: 4 }], extra: [{ catalogCardId: 44508094, maxCopies: 2 }],
    } });
    const repeated = await POST(request(body), context());
    expect(await repeated.json()).toMatchObject({ added: 0, copies: 0, duplicates: [46986414, 44508094] });
  });

  it.each([null, {}, [{ id: 46986414, copies: 0 }], [{ id: -1, copies: 1 }], [{ id: 46986414, copies: 1, pool: "side" }]])("rejects malformed entries %j before any writes", async entries => {
    const { POST } = await import("../app/api/cubes/[id]/cards/route");
    expect((await POST(request({ op: "addBatch", entries }), context())).status).toBe(400);
    expect(db().prepare("SELECT count(*) AS n FROM cube_cards").get()).toEqual({ n: 0 });
  });

  it("enforces user and community ownership before card work", async () => {
    const { POST } = await import("../app/api/cubes/[id]/cards/route");
    const body = { op: "addBatch", entries: [{ id: 46986414, copies: 1 }] };
    expect((await POST(request(body), context("2"))).status).toBe(404);
    state.auth.mockResolvedValue({ user: { id: String(fixtureUserId("other")) } });
    expect((await POST(request(body), context())).status).toBe(404);
    state.auth.mockResolvedValue(null);
    expect((await POST(request(body), context())).status).toBe(401);
  });
});
