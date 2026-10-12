import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(state.auth);
});
vi.mock("@/lib/duel-host", () => ({ requireDuelActor: async () => ({ ok: false, response: new Response(null, { status: 401 }) }) }));
let imageDir: string;
const session = (id: number) => ({ user: { id: String(id), name: "Member", discordUserId: null } });
const request = (body = {}) => new Request("http://localhost/api/cards/resolve", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubEnv("CARD_FETCH_MEMBER_QUEUE_LIMIT", "1");
  imageDir = mkdtempSync(join(tmpdir(), "member-images-"));
  vi.stubEnv("CARD_IMAGE_CACHE_DIR", imageDir);
  state.db = new Database(":memory:");
  migrate(state.db);
  state.auth.mockReset();
  state.auth.mockResolvedValue(session(1));
});
afterEach(() => { rmSync(imageDir, { recursive: true, force: true }); state.db?.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("member card request routes", () => {
  it("returns 429 for a full member budget and still serves another member", async () => {
    let release!: () => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => {
      release = () => resolve(Response.json({ data: [] }));
    })).mockImplementation(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("../app/api/cards/resolve/route");
    const first = POST(request({ cardName: "First" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    try {
      const second = POST(request({ cardName: "Second" }));
      await vi.advanceTimersByTimeAsync(200);
      const refused = await second;
      expect(refused.status).toBe(429);
      expect((await refused.json()).error).toContain("pending card requests");
      state.auth.mockResolvedValue(session(2));
      const other = POST(request({ cardName: "Other" }));
      await vi.advanceTimersByTimeAsync(200);
      expect((await other).status).toBe(404);
    } finally { release(); await first; }
  });

  it.each([{ ids: [111] }, { ids: [111, 222, 333, 444] }])("keeps a full member budget from turning a cube import into unknown cards ($ids)", async ({ ids }) => {
    let release!: () => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => {
      release = () => resolve(Response.json({ data: [] }));
    })));
    const { createCardCatalogService, fetchCardResource } = await import("@yugidraft/shared/services");
    const { ensureCatalogCards } = await import("../src/lib/cube-pool");
    const pending = fetchCardResource("https://db.ygoprodeck.com/card", fetch, r => r.json(), [], 1);
    try {
      const catalog = createCardCatalogService(state.db!, { memberId: 1 });
      await expect(ensureCatalogCards(catalog, ids)).rejects.toMatchObject({ status: 429 });
    } finally { release(); await pending; }
  });

  it.each([
    { op: "import", ids: [111] },
    { op: "import", ids: [111, 222] },
    { op: "import", ids: [111, 222, 333] },
    { op: "importYdk", ids: [111] },
    { op: "importYdk", ids: [111, 222] },
    { op: "importYdk", ids: [111, 222, 333] },
  ])("returns 429 for $op with a full member budget and uncached passcodes ($ids)", async ({ op, ids }) => {
    vi.stubEnv("DISCORD_GUILD_ID", "guild");
    state.db!.exec(`insert into users(id, username, display_name) values(1, 'member', 'Member');
      insert into cubes(id, guild_id, name, created_by_user_id, created_at, updated_at)
      values(1, 'guild', 'Cube', 1, 't', 't');`);
    let release!: () => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => {
      release = () => resolve(Response.json({ data: [] }));
    }));
    vi.stubGlobal("fetch", fetcher);
    const { fetchCardResource } = await import("@yugidraft/shared/services");
    const { POST } = await import("../app/api/cubes/[id]/cards/route");
    const pending = fetchCardResource("https://db.ygoprodeck.com/card", fetch, r => r.json(), [], 1);
    try {
      const body = op === "import" ? { op, codes: ids } : { op, text: `#main\n${ids.join("\n")}\n` };
      const refused = await POST(request(body), { params: Promise.resolve({ id: "1" }) });
      expect(refused.status).toBe(429);
      expect((await refused.json()).error).toContain("pending card requests");
      expect(refused.headers.get("retry-after")).toBe("1");
      expect(state.db!.prepare("select * from cube_cards where cube_id = 1").all()).toEqual([]);
      expect(state.db!.prepare("select updated_at from cubes where id = 1").get()).toEqual({ updated_at: "t" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { release(); await pending; }
  });

  it("applies the member budget before a draft start fetches its pool", async () => {
    vi.stubEnv("DISCORD_GUILD_ID", "guild");
    state.db!.exec(`insert into users(id, username, display_name) values(1, 'member', 'Member');
      insert into players(id, guild_id, user_id, display_name) values(1, 'guild', 1, 'Member');
      insert into drafts(guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug, visibility)
      values('guild', 'channel', 'Draft', 'pending', 1, '{"mode":"booster","setNames":["Starter"]}', 'lobby', 'open');
      insert into draft_players(draft_id, player_id) values(1, 1);`);
    let release!: () => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => {
      release = () => resolve(Response.json({ data: [] }));
    })).mockImplementation(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    const { fetchCardResource } = await import("@yugidraft/shared/services");
    const pending = fetchCardResource("https://db.ygoprodeck.com/card", fetch, r => r.json(), [], 1);
    const { POST } = await import("../app/api/drafts/[slug]/start/route");
    try {
      const result = POST(request({ revision: 0 }), { params: Promise.resolve({ slug: "lobby" }) });
      await vi.advanceTimersByTimeAsync(200);
      expect((await result).status).toBe(429);
      expect(state.db!.prepare("select status, lobby_start_token from drafts").get()).toEqual({ status: "pending", lobby_start_token: null });
    } finally { release(); await pending; }
  });

  it("returns 429 for a member's full image fetch budget", async () => {
    let release!: () => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => {
      release = () => resolve(new Response("unavailable", { status: 503 }));
    })).mockImplementation(async () => new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const { GET } = await import("../app/api/cards/[passcode]/image/route");
    const image = (passcode: string) => GET(new Request(`http://localhost/api/cards/${passcode}/image`), { params: Promise.resolve({ passcode }) });
    const first = image("123");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    try {
      let response: Response | undefined;
      const second = image("456").then(result => { response = result; return result; });
      await vi.waitFor(() => expect(response).toBeDefined());
      expect((await second).status).toBe(429);
      state.auth.mockResolvedValue(session(2));
      const other = image("789");
      await vi.advanceTimersByTimeAsync(200);
      expect((await other).status).toBe(200);
    } finally { release(); await first; }
  });

  it("limits manual set sync to one per member in ten minutes", async () => {
    const fetcher = vi.fn(async () => Response.json([{ set_name: "Starter", set_code: "ST", num_of_cards: 1 }]));
    vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("../app/api/sets/route");
    expect((await POST()).status).toBe(200);
    const second = POST();
    await vi.advanceTimersByTimeAsync(200);
    const refused = await second;
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toContain("set sync");
    expect(refused.headers.get("retry-after")).toBe("600");
    state.auth.mockResolvedValue(session(2));
    const other = POST();
    await vi.advanceTimersByTimeAsync(200);
    expect((await other).status).toBe(200);
    state.auth.mockResolvedValue(session(1));
    await vi.advanceTimersByTimeAsync(600_000);
    expect((await POST()).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
