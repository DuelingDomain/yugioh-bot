import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../shared/src/db/schema";
import { importCardEffectArtifact } from "../../shared/src/cards/effects/artifact";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn(), warm: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/discord-web-access", () => ({ checkDiscordWebAccess: async () => ({ ok: true }) }));
vi.mock("@/lib/cube-pool", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/cube-pool")>();
  return { ...original, ensureCatalogCards: (...args: Parameters<typeof original.ensureCatalogCards>) => {
    state.warm(...args);
    return original.ensureCatalogCards(...args);
  } };
});
const owner = "cube-effects-owner";
const request = (body: unknown) => new Request("http://test/api", { method: "POST", body: JSON.stringify(body) });
const context = (id = "1") => ({ params: Promise.resolve({ id }) });
const db = () => state.db!;

beforeEach(() => {
  vi.resetModules();
  state.warm.mockClear();
  vi.stubEnv("DISCORD_GUILD_ID", "g");
  vi.stubEnv("EFFECT_SEARCH", "1");
  vi.stubEnv("DUEL_DATA_DIR", "/tmp/cube-effects-routes-no-engine");
  state.auth.mockResolvedValue({ user: { id: String(owner), name: "Owner" } });
  state.db = new Database(":memory:");
  migrate(db());
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
    state.auth.mockResolvedValue({ user: { id: String("other") } });
    expect((await POST(request(body), context())).status).toBe(404);
    state.auth.mockResolvedValue(null);
    expect((await POST(request(body), context())).status).toBe(401);
  });
});

describe("phrase preview, confirmation and description routes", () => {
  it("accepts the era option at cube and lobby preview boundaries and rejects invalid eras", async () => {
    importCardEffectArtifact(db());
    const { POST } = await import("../app/api/cubes/[id]/seed/preview/route");
    const era = { medianYear: 2005, spread: 2 };
    const response = await POST(request({ phrase: "dark magician", targetCount: 2, era }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ era, rows: expect.any(Array) });
    expect((await POST(request({ phrase: "dark magician", era: { ...era, spread: -1 } }), context())).status).toBe(400);
    vi.stubEnv("THEME_DRAFTS", "1");
    db().prepare("INSERT INTO drafts(channel_id,id,guild_id,name,created_by_user_id,status,web_slug,config_json) VALUES('channel',7,'g','Era lobby',?,'pending','era-lobby',?)")
      .run(owner, JSON.stringify({ mode: "theme", themeSelection: "player_pick", allowedCubeIds: [] }));
    const lobby = await import("../app/api/drafts/[slug]/seed/preview/route");
    const result = await lobby.POST(request({ phrase: "dark magician", targetCount: 2, era }), { params: Promise.resolve({ slug: "era-lobby" }) });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ era });
  });

  it("passes an explicit era from the browser helpers through cube and lobby previews", async () => {
    const cube = await import("../app/api/cubes/[id]/seed/preview/route");
    const lobby = await import("../app/api/drafts/[slug]/seed/preview/route");
    vi.stubEnv("THEME_DRAFTS", "1");
    db().prepare("INSERT INTO drafts(channel_id,id,guild_id,name,created_by_user_id,status,web_slug,config_json) VALUES('channel',7,'g','Era lobby',?,'pending','era-lobby',?)")
      .run(owner, JSON.stringify({ mode: "theme", themeSelection: "player_pick", allowedCubeIds: [] }));
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const req = new Request(`http://test${url}`, init);
      return String(url).includes("/drafts/")
        ? lobby.POST(req, { params: Promise.resolve({ slug: "era-lobby" }) })
        : cube.POST(req, context());
    });
    try {
      const { previewSeed, previewDraftSeed } = await import("../src/components/effect-search/effect-api");
      const era = { medianYear: 2005, spread: 2 };
      expect(await previewSeed(1, "dark magician", { targetCount: 2, era })).toMatchObject({ era });
      expect(await previewDraftSeed("era-lobby", "dark magician", { targetCount: 2, era })).toMatchObject({ era });
    } finally { fetch.mockRestore(); }
  });

  it("previews without writes and confirms only chosen rows through the duplicate-safe batch", async () => {
    importCardEffectArtifact(db());
    const preview = await import("../app/api/cubes/[id]/seed/preview/route");
    const confirm = await import("../app/api/cubes/[id]/seed/confirm/route");
    const before = db().prepare("SELECT * FROM cubes").all();
    const response = await preview.POST(request({ phrase: "dark magician", targetCount: 3, maxCopies: 4 }), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const result = await response.json();
    expect(result).toMatchObject({ effectSearchEnabled: true, targetCount: 3, rows: expect.any(Array), cards: expect.any(Array) });
    expect(result.rows.length).toBe(3);
    expect(db().prepare("SELECT * FROM cubes").all()).toEqual(before);
    expect(db().prepare("SELECT count(*) AS n FROM cube_cards").get()).toEqual({ n: 0 });
    const chosen = [{ id: result.rows[0].id, copies: 4 }];
    const added = await confirm.POST(request({ entries: chosen }), context());
    expect(await added.json()).toMatchObject({ added: 1, copies: 4, duplicates: [] });
    const repeated = await confirm.POST(request({ entries: chosen }), context());
    expect(await repeated.json()).toMatchObject({ added: 0, copies: 0, duplicates: [chosen[0].id] });
    expect(db().prepare("SELECT count(*) AS n FROM cube_cards").get()).toEqual({ n: 1 });
  });

  it("allows only one unfinished preview per user across cubes and draft lobbies and releases after failures", async () => {
    const { POST } = await import("../app/api/cubes/[id]/seed/preview/route");
    db().prepare("INSERT INTO cubes(id,guild_id,name,created_by_user_id) VALUES(3,'g','Second',?),(4,'g','Guest',?)").run(owner, "other");
    vi.stubEnv("THEME_DRAFTS", "1");
    db().prepare("INSERT INTO drafts(channel_id,id,guild_id,name,created_by_user_id,status,web_slug,config_json) VALUES('channel',7,'g','Preview lobby',?,'pending','preview-lobby',?)")
      .run(owner, JSON.stringify({ mode: "theme", themeSelection: "player_pick", allowedCubeIds: [] }));
    const lobbyPreview = await import("../app/api/drafts/[slug]/seed/preview/route");
    const lobbyContext = { params: Promise.resolve({ slug: "preview-lobby" }) };
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const pending = new Request("http://test/api", { method: "POST", duplex: "half", body: new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }) } as RequestInit);
    let entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const getReader = pending.body!.getReader.bind(pending.body!);
    vi.spyOn(pending.body!, "getReader").mockImplementation(() => { entered(); return getReader(); });
    const first = POST(pending, context());
    await reading;
    try {
      const duplicate = await POST(request({ phrase: "dark magician" }), context("3"));
      expect(duplicate.status).toBe(429);
      expect(await duplicate.json()).toMatchObject({ error: "cube_seed_preview_in_flight" });
      expect((await lobbyPreview.POST(request({ phrase: "dark magician" }), lobbyContext)).status).toBe(429);
      state.auth.mockResolvedValue({ user: { id: String("other") } });
      expect((await POST(request({ phrase: "dark magician", targetCount: 1 }), context("4"))).status).toBe(200);
    } finally {
      stream.enqueue(new TextEncoder().encode(JSON.stringify({ phrase: "dark magician", targetCount: 1 })));
      stream.close();
      expect((await first).status).toBe(200);
    }
    state.auth.mockResolvedValue({ user: { id: String(owner) } });
    expect((await POST(request({ phrase: "dark magician", targetCount: 0 }), context())).status).toBe(400);
    expect((await POST(request({ phrase: "dark magician", targetCount: 1 }), context())).status).toBe(200);
    expect((await lobbyPreview.POST(request({ phrase: "dark magician", targetCount: 0 }), lobbyContext)).status).toBe(400);
    expect((await lobbyPreview.POST(request({ phrase: "dark magician", targetCount: 1 }), lobbyContext)).status).toBe(200);
    expect((await POST(request({ phrase: "dark magician", unexpected: true }), context())).status).toBe(400);
    expect((await POST(request({ phrase: "dark magician", targetCount: 1 }), context())).status).toBe(200);
  });

  it("does not warm display metadata for unscoped effect search hits", async () => {
    importCardEffectArtifact(db());
    const { POST } = await import("../app/api/cards/resolve/route");
    const response = await POST(request({ op: "effectSearch", text: "hand traps that negate" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, cards: [{ id: 97268402 }], unknownIds: [] });
    expect(state.warm).not.toHaveBeenCalled();
  });

  it("keeps description search explicit and returns display rows, chips and reasons", async () => {
    importCardEffectArtifact(db());
    const { POST } = await import("../app/api/cards/resolve/route");
    const response = await POST(request({ op: "effectSearch", text: "hand traps that negate", pool: [97268402] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ effectSearchEnabled: true, reading: { chips: expect.any(Array) }, total: 1, cards: [{ id: 97268402, reason: expect.any(String), score: expect.any(Number) }] });
    expect(state.warm).toHaveBeenCalledWith(expect.anything(), [97268402], { remaining: 8, lookupLimited: false });
    const exact = await POST(request({ op: "effectSearch", text: "hand traps", exact: true, pool: [97268402] }));
    expect(await exact.json()).toMatchObject({ reading: null, cards: [], total: 0 });
    const malformed = await POST(request({ op: "effectSearch", text: "searchers", cubeId: 1 }));
    expect(malformed.status).toBe(400);
  });

  it.each(["preview", "confirm"])("protects %s with ownership, flag and strict body validation", async operation => {
    const route = operation === "preview" ? await import("../app/api/cubes/[id]/seed/preview/route") : await import("../app/api/cubes/[id]/seed/confirm/route");
    const body = operation === "preview" ? { phrase: "dark magician", targetCount: 2 } : { entries: [{ id: 46986414, copies: 1 }] };
    expect((await route.POST(request(body), context("2"))).status).toBe(404);
    state.auth.mockResolvedValue({ user: { id: String("other") } });
    expect((await route.POST(request(body), context())).status).toBe(404);
    state.auth.mockResolvedValue(null);
    expect((await route.POST(request(body), context())).status).toBe(401);
    state.auth.mockResolvedValue({ user: { id: String(owner) } });
    expect((await route.POST(request({ ...body, guildId: "g" }), context())).status).toBe(400);
    expect((await route.POST(request(null), context())).status).toBe(400);
    expect((await route.POST(request({ phrase: "x".repeat(70_000) }), context())).status).toBe(413);
    vi.stubEnv("EFFECT_SEARCH", "0");
    const disabled = await route.POST(request(body), context());
    expect(disabled.status).toBe(404);
    expect(await disabled.json()).toMatchObject({ effectSearchEnabled: false });
  });
});

describe("draft preflight pool health", () => {
  const setupDraft = (selection = "player_pick") => {
    vi.stubEnv("THEME_DRAFTS", "1");
    const cfg = { mode: "theme", themeSelection: selection, themePackSize: 3, cardsPerPlayer: 40, extraDeckEnabled: false, allowedCubeIds: [1] };
    db().prepare("INSERT INTO drafts(channel_id,id,guild_id,name,created_by_user_id,status,web_slug,config_json) VALUES('channel',1,'g','Health draft',?,'pending','health-draft',?)").run(owner, JSON.stringify(cfg));
    const insert = db().prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) VALUES(?,?,'Normal Monster','normal','i','s','[]',CURRENT_TIMESTAMP)`);
    const pool = db().prepare("INSERT INTO cube_cards(cube_id,catalog_card_id,pool,max_copies) VALUES(1,?,'main',1)");
    for (let id = 1000; id < 1045; id++) { insert.run(id, `Card ${id}`); pool.run(id); }
  };

  it("GETs a theme lobby without health warnings or insight catalog reads when effects are enabled", async () => {
    setupDraft();
    const read = vi.spyOn(db(), "prepare");
    const { GET } = await import("../app/api/drafts/[slug]/route");
    const response = await GET(new Request("http://test"), { params: Promise.resolve({ slug: "health-draft" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lobby.warnings).toEqual([]);
    expect(read.mock.calls.some(([sql]) => sql.includes("card_tags"))).toBe(false);
    read.mockRestore();
  });

  it("returns structured health per allowed cube and only adds warnings", async () => {
    setupDraft();
    const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
    const result = await GET(new Request("http://test"), { params: Promise.resolve({ slug: "health-draft" }) });
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.errors).toEqual([]);
    expect(body.poolHealth).toMatchObject([{ cubeId: 1, cubeName: "Seed cube", health: { cards: 45, roles: { removal: 0 } } }]);
    expect(body.warnings).toEqual([]);
    expect(body.poolHealth[0].health.warnings).toContainEqual(expect.stringMatching(/removal/));
    vi.stubEnv("EFFECT_SEARCH", "0");
    const disabled = await GET(new Request("http://test"), { params: Promise.resolve({ slug: "health-draft" }) });
    expect(await disabled.json()).toEqual({ errors: [], warnings: [] });
  });

  it("does not expose host-assigned health to a seated non-host", async () => {
    setupDraft("host_assigned");
    const guest = "other";
    db().prepare("INSERT INTO players(id,guild_id,discord_user_id,display_name) VALUES(1,'g',?,'Guest')").run(guest);
    db().prepare("INSERT INTO draft_players(draft_id,player_id) VALUES(1,1)").run();
    state.auth.mockResolvedValue({ user: { id: String(guest) } });
    const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
    const result = await GET(new Request("http://test"), { params: Promise.resolve({ slug: "health-draft" }) });
    expect(await result.json()).toEqual({ errors: [], warnings: [] });
  });
});

describe("theme lobby seed preview", () => {
  const ctx = { params: Promise.resolve({ slug: "lobby-draft" }) };
  const setupLobby = () => {
    vi.stubEnv("THEME_DRAFTS", "1");
    const cfg = { mode: "theme", themeSelection: "player_pick", themePackSize: 3, cardsPerPlayer: 40, extraDeckEnabled: false, allowedCubeIds: [] };
    db().prepare("INSERT INTO drafts(channel_id,id,guild_id,name,created_by_user_id,status,web_slug,config_json) VALUES('channel',1,'g','Lobby draft',?,'pending','lobby-draft',?)").run(owner, JSON.stringify(cfg));
  };

  it("previews for the host without creating a cube", async () => {
    importCardEffectArtifact(db());
    setupLobby();
    const { POST } = await import("../app/api/drafts/[slug]/seed/preview/route");
    const cubes = db().prepare("SELECT count(*) AS n FROM cubes").get();
    const response = await POST(request({ phrase: "dark magician", targetCount: 3, maxCopies: 1 }), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ effectSearchEnabled: true, rows: expect.any(Array), cards: expect.any(Array) });
    expect(db().prepare("SELECT count(*) AS n FROM cubes").get()).toEqual(cubes);
    expect(db().prepare("SELECT count(*) AS n FROM cube_cards").get()).toEqual({ n: 0 });
  });

  it("is host-only, pending-only and flag-gated", async () => {
    setupLobby();
    const { POST } = await import("../app/api/drafts/[slug]/seed/preview/route");
    const body = request({ phrase: "dark magician", targetCount: 3, maxCopies: 1 });
    state.auth.mockResolvedValue({ user: { id: String("other") } });
    expect((await POST(body, ctx)).status).toBeGreaterThanOrEqual(403);
    state.auth.mockResolvedValue({ user: { id: String(owner) } });
    vi.stubEnv("EFFECT_SEARCH", "0");
    expect((await POST(request({ phrase: "dark magician" }), ctx)).status).toBe(404);
    state.auth.mockResolvedValue(null);
    expect((await POST(request({ phrase: "dark magician" }), ctx)).status).toBe(401);
  });
});

describe("light cube era route", () => {
  it("reads every release date above 500 cards and returns a structured count", async () => {
    const insert = db().prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,'Normal Monster','normal','i','s','[]',CURRENT_TIMESTAMP)`);
    const date = db().prepare("INSERT INTO card_release(passcode,tcg_date,quality,source_version) VALUES(?,?,'ok','fixture')");
    const add = db().prepare("INSERT INTO cube_cards(cube_id,catalog_card_id,pool,max_copies) VALUES(1,?,'main',1)");
    db().transaction(() => {
      for (let n = 1; n <= 601; n++) {
        const id = 10000 + n;
        insert.run(id, `Era ${n}`); date.run(id, n <= 600 ? "2005-01" : "2025-01"); add.run(id);
      }
    })();
    const { GET } = await import("../app/api/cubes/[id]/era/route");
    const response = await GET(new Request("http://test/api"), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ era: { medianYear: 2005, spread: 0 }, newerCount: 1 });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await GET(new Request("http://test/api"), context("2"))).status).toBe(404);
    state.auth.mockResolvedValue({ user: { id: String("other") } });
    expect((await GET(new Request("http://test/api"), context())).status).toBe(404);
    state.auth.mockResolvedValue(null);
    expect((await GET(new Request("http://test/api"), context())).status).toBe(401);
  });
  it("honors the feature gate", async () => {
    vi.stubEnv("EFFECT_SEARCH", "0");
    const { GET } = await import("../app/api/cubes/[id]/era/route");
    expect((await GET(new Request("http://test/api"), context())).status).toBe(404);
  });
});

it("keeps release era for an uncached engine artwork without parsing tags", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cube-era-engine-"));
  vi.stubEnv("DUEL_DATA_DIR", directory);
  const engine = new Database(join(directory, "cards.cdb"));
  engine.exec(`CREATE TABLE datas(id INTEGER PRIMARY KEY,alias INTEGER,type INTEGER);
    CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT);
    INSERT INTO datas VALUES(46986414,0,33),(100001,46986414,33);
    INSERT INTO texts VALUES(46986414,'Dark Magician'),(100001,'Dark Magician');`);
  engine.close();
  try {
    db().prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(100001,'Dark Magician','Normal Monster','normal','i','s','[]',CURRENT_TIMESTAMP)`).run();
    db().prepare("INSERT INTO cube_cards(cube_id,catalog_card_id,pool,max_copies) VALUES(1,100001,'main',1)").run();
    db().prepare("INSERT INTO card_release(passcode,tcg_date,quality,source_version) VALUES(46986414,'2005-01','ok','fixture')").run();
    const { GET } = await import("../app/api/cubes/[id]/era/route");
    const response = await GET(new Request("http://test/api"), context());
    expect(await response.json()).toMatchObject({ era: { medianYear: 2005, spread: 0 }, newerCount: 0 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
