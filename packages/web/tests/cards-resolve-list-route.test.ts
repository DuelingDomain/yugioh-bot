import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb }));
let db: Database.Database;
let upstream: Mock<typeof globalThis.fetch>;
let before: ReturnType<typeof cubeRows>;
const resolve = async (body: unknown) => (await import("../app/api/cards/resolve/route")).POST(
  new Request("http://localhost/api/cards/resolve", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }),
);
const cubeRows = () => ({
  cubes: db.prepare("select * from cubes order by id").all(),
  cards: db.prepare("select * from cube_cards order by cube_id, catalog_card_id").all(),
});
function seed(id: number, name: string, type = "Spell Card", frame = "spell") {
  db.prepare(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
    values (?,?,?,?, 'Effect text.', 'image', 'small', '[]', 't')`).run(id, name, type, frame);
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
  auth.mockReset(); getDb.mockReset();
  auth.mockResolvedValue({ user: { id: String(fixtureUserId("owner")), discordUserId: fixtureDiscordId("owner") } });
  upstream = vi.fn(async () => Response.json({ error: "No card matching your query was found" }, { status: 400 }));
  vi.stubGlobal("fetch", upstream);
  db = new Database(":memory:"); migrate(db); seedFixtureUsers(db, ["owner", "someone-else"]); getDb.mockReturnValue(db);
  seed(1, "Dark Hole");
  seed(2, "Shooting Star Dragon", "Synchro Monster", "synchro");
  seed(3, "Artifact Moralltach", "Effect Monster", "effect");
  db.exec(`insert into cubes (guild_id,name,created_by_user_id,config_json)
    values ('guild-1','Existing',${fixtureUserId("someone-else")},'{"customCardIds":[1,1],"draftType":"booster"}');
    insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) values (1,1,'main',7)`);
  before = cubeRows();
  // Every test guards all cube writes, including accidental no-op updates.
  for (const table of ["cubes", "cube_cards"]) for (const op of ["insert", "update", "delete"]) {
    db.exec(`create trigger forbid_${table}_${op} before ${op} on ${table}
      begin select raise(ABORT, 'Resolve must not write cubes'); end`);
  }
});
afterEach(() => {
  try { expect(cubeRows()).toEqual(before); }
  finally { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});

describe("POST /api/cards/resolve listText", () => {
  it("resolves names/passcodes in first-appearance order with summed copies and unique diagnostics", async () => {
    const response = await resolve({ listText: "2 Artifact Moraltech\nDark Hole\n3 3\nDark Hole x3\n2 Artifact Moraltech\n3 Glue (note)\n3 Glue (note)\n999" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cards: [
        expect.objectContaining({ id: 3, name: "Artifact Moralltach", type: "Effect Monster", frameType: "effect", effectText: "Effect text.", imageUrl: "image", imageUrlSmall: "small" }),
        expect.objectContaining({ id: 1, name: "Dark Hole" }),
      ],
      entries: [{ id: 3, copies: 7, pool: "main" }, { id: 1, copies: 4, pool: "main" }],
      unknown: ["3 Glue (note)", "999"],
      corrected: [{ from: "Artifact Moraltech", to: "Artifact Moralltach" }],
    });
  });

  it("routes by card type and reports distinct main cards listed under extra across sections", async () => {
    const response = await resolve({ listText: "Shooting Star Dragon\nDark Hole\n#extra\n2 Dark Hole\n#main\nArtifact Moralltach" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      entries: [{ id: 2, copies: 1, pool: "extra" }, { id: 1, copies: 3, pool: "main" }, { id: 3, copies: 1, pool: "main" }],
      unknown: [], corrected: [], movedToMain: 1,
    });
  });

  it.each([
    ["#extra\n2 Dark Hole\nDark Hole\n3 Artifact Moralltach\nShooting Star Dragon\n999", [1, 3, 2], [3, 3, 1], ["999"]],
    ["#main\n2\n#extra\n1\n1\n3\n3\n3", [2, 1, 3], [1, 2, 3], []],
    ["ydke://AgAAAA==!AQAAAAEAAAADAAAAAwAAAAMAAAA=!!", [2, 1, 3], [1, 2, 3], []],
  ])("routes misplaced spells and monsters to main for text, YDK and ydke: %#", async (listText, ids, copies, unknown) => {
    const response = await resolve({ listText });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.entries).toEqual(ids.map((id, index) => ({ id, copies: copies[index], pool: id === 2 ? "extra" : "main" })));
    expect(result).toMatchObject({ movedToMain: 2, unknown, corrected: [] });
    expect(result.cards.map((card: { id: number }) => card.id)).toEqual(ids);
  });

  it.each([
    ["Fusion Pendulum Monster", "fusion_pendulum"],
    ["Synchro Pendulum Effect Monster", "synchro_pendulum"],
    ["XYZ Pendulum Effect Monster", "xyz_pendulum"],
    ["Link Monster", "effect"],
  ])("keeps Extra Deck variants under main in extra and omits movedToMain: %s", async (type, frame) => {
    seed(4, "Extra Variant", type, frame);
    const response = await resolve({ listText: "#main\nExtra Variant\n#extra\nShooting Star Dragon" });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.entries).toEqual([{ id: 4, copies: 1, pool: "extra" }, { id: 2, copies: 1, pool: "extra" }]);
    expect(result).not.toHaveProperty("movedToMain");
  });

  it("keeps YDK file order across main/extra/side/deckmaster and sums repeated passcodes", async () => {
    seed(4, "Monster Reborn");
    const response = await resolve({ listText: "#created by owner\n#main\n3\n3\n#extra\n2\n!side\n1\n#deckmaster\n4" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries).toEqual([
      { id: 3, copies: 2, pool: "main" }, { id: 2, copies: 1, pool: "extra" },
      { id: 1, copies: 1, pool: "main" }, { id: 4, copies: 1, pool: "main" },
    ]);
    expect(body.cards.map((card: { id: number }) => card.id)).toEqual([3, 2, 1, 4]);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("keeps ydke section order as main/extra/side", async () => {
    const encode = (id: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(id); return b.toString("base64"); };
    const response = await resolve({ listText: `ydke://${encode(3)}!${encode(2)}!${encode(1)}!` });
    expect(response.status).toBe(200);
    expect((await response.json()).entries).toEqual([
      { id: 3, copies: 1, pool: "main" }, { id: 2, copies: 1, pool: "extra" }, { id: 1, copies: 1, pool: "main" },
    ]);
  });

  it("caps total copies at 99 and uses cached digit-leading printed names while offline", async () => {
    seed(4, "7 Colored Fish", "Normal Monster", "normal");
    upstream.mockRejectedValue(new TypeError("offline"));
    const response = await resolve({ listText: "7 Colored Fish\n7 Colored Fish x3\n99 Dark Hole\n5 1\n dark-hole " });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      entries: [{ id: 4, copies: 4, pool: "main" }, { id: 1, copies: 99, pool: "main" }], unknown: [], corrected: [],
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(["#comment\n//comment", "Glue"])("returns 200 with empty results for %s", async (listText) => {
    const response = await resolve({ listText });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [], entries: [], unknown: listText === "Glue" ? ["Glue"] : [], corrected: [] });
  });

  it.each(["Fresh Card", "42"])("warms the catalog without creating or updating cubes for %s", async (listText) => {
    upstream.mockResolvedValue(Response.json({ data: [{ id: 42, name: "Fresh Card", type: "Spell Card", frameType: "spell", desc: "Fresh effect",
      card_images: [{ id: 42, image_url: "fresh", image_url_small: "fresh-small" }] }] }));
    const response = await resolve({ listText });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cards: [{ id: 42, name: "Fresh Card", effectText: "Fresh effect", imageUrl: "fresh", imageUrlSmall: "fresh-small" }],
      entries: [{ id: 42, copies: 1, pool: "main" }], unknown: [], corrected: [],
    });
    expect(db.prepare("select name from card_catalog where ygoprodeck_id = 42").get()).toEqual({ name: "Fresh Card" });
  });

  it.each([null, { user: {} }])("requires the existing authenticated user guard before database access: %#", async (session) => {
    auth.mockResolvedValue(session);
    const response = await resolve({ listText: "Dark Hole" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(getDb).not.toHaveBeenCalled(); expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    [null, "Add a card list file or paste a list."],
    [7, "Add a card list file or paste a list."],
    ["", "Add a card list file or paste a list."],
    ["   ", "Add a card list file or paste a list."],
    ["x".repeat(65537), "That list text is too large. The limit is 64 Ki characters."],
    [Array.from({ length: 1001 }, (_, i) => `Card ${i}`).join("\n"), "That list has 1001 different cards. Import at most 1000 at a time."],
    [Array.from({ length: 1001 }, (_, i) => String(i + 1)).join("\n"), "That list has 1001 different cards. Import at most 1000 at a time."],
    ["0 Dark Hole", 'Invalid copy count in "0 Dark Hole".'],
    ["999999999999999999999 Dark Hole", 'Invalid copy count in "999999999999999999999 Dark Hole".'],
    ["#deckmaster\n1\n#deckmaster\n2", "YDK contains multiple #deckmaster sections."],
    ["#deckmaster\nnope", "Invalid Deck Master id in #deckmaster."],
    ["#deckmaster\n1\n2", "YDK #deckmaster must contain exactly one card id."],
  ])("returns the parser's 400 for invalid text before upstream access: %#", async (listText, error) => {
    const response = await resolve({ listText });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns a JSON 400 for malformed ydke", async () => {
    const response = await resolve({ listText: "ydke://%%%!!!" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(["setNames", "customCardIds", "cardName", "fuzzyName", "archetype", "includeExtra"])("rejects mixing listText with %s", async (key) => {
    const response = await resolve({ listText: "Dark Hole", [key]: key.endsWith("s") ? [] : "" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "listText cannot be combined with other resolve options." });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("accepts the exact text and distinct-card limit boundaries", async () => {
    for (let id = 4; id <= 1000; id++) seed(id, `Card ${id}`);
    const list = Array.from({ length: 1000 }, (_, i) => String(i + 1)).join("\n");
    const response = await resolve({ listText: list + "\n#" + "x".repeat(65536 - list.length - 2) });
    expect(response.status).toBe(200);
    expect((await response.json()).entries).toHaveLength(1000);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(["Missing Card", "999"])("keeps the route's 503 and Retry-After for unavailable resolution: %s", async (missing) => {
    upstream.mockResolvedValue(Response.json({}, { status: 503 }));
    const response = await resolve({ listText: `Dark Hole\n${missing}` });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toEqual({ error: "Card database is unavailable. Try again shortly." });
  });

  it("preserves upstream rate-limit Retry-After", async () => {
    upstream.mockResolvedValue(Response.json({}, { status: 429, headers: { "Retry-After": "7" } }));
    const response = await resolve({ listText: "Missing Card" });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("7");
    expect(await response.json()).toEqual({ error: "Card database is unavailable. Try again shortly." });
  });
});


it("shares 50 remote lookups across names, fallbacks and passcodes and reports the limit", async () => {
  const names = Array.from({ length: 60 }, (_, i) => `Unknownword${i} Missingword${i}`);
  const codes = Array.from({ length: 60 }, (_, i) => String(900000 + i));
  const response = await resolve({ listText: [...names, ...codes, "Dark Hole"].join("\n") });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ lookupLimited: true, unknown: [...names, ...codes], entries: [{ id: 1, copies: 1, pool: "main" }] });
  expect(upstream).toHaveBeenCalledTimes(50);
}, 40000);

it.each([50, 70])("resolves %i uncached passcodes in batches of 20 without running out of lookups", async (count) => {
  const cards = Array.from({ length: count }, (_, i) => ({
    id: 900000 + i, name: `Fresh Card ${i}`, type: i % 4 === 0 ? "Fusion Monster" : "Spell Card", frameType: i % 4 === 0 ? "fusion" : "spell",
    card_images: [{ id: 900000 + i, image_url: "fresh", image_url_small: "fresh-small" }],
  }));
  upstream.mockImplementation(async (input) => {
    const params = new URL(String(input)).searchParams;
    const wanted = params.has("id") ? params.get("id")!.split(",").map(Number) : [];
    const found = params.has("id") ? cards.filter((card) => wanted.includes(card.id)) : cards.filter((card) => card.name === params.get("name"));
    return Response.json({ data: found });
  });
  const response = await resolve({ listText: [...cards.map((card) => String(card.id)), "Dark Hole"].join("\n") });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.entries).toEqual([...cards.map((card) => ({ id: card.id, copies: 1, pool: card.type === "Fusion Monster" ? "extra" : "main" })),
    { id: 1, copies: 1, pool: "main" }]);
  expect(result.unknown).toEqual([]);
  expect(result).not.toHaveProperty("lookupLimited");
  expect(upstream.mock.calls.filter(([input]) => new URL(String(input)).searchParams.has("id"))).toHaveLength(Math.ceil(count / 20));
}, 60000);

it("files lines with a trailing [Extra] or [Main] marker in that pool and strips the marker before the lookup", async () => {
  const response = await resolve({ listText: "3 Dark Hole [Main]\n1 Shooting Star Dragon [Extra]\n2 Artifact Moralltach [main]" });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ unknown: [], entries: [
    { id: 1, copies: 3, pool: "main" }, { id: 2, copies: 1, pool: "extra" }, { id: 3, copies: 2, pool: "main" },
  ] });
  expect(result).not.toHaveProperty("lookupLimited");
  expect(upstream).not.toHaveBeenCalled();
});

it("looks up counted card lines before section titles and prose, so a long document keeps its Extra Deck monsters", async () => {
  const fresh = [
    { id: 910001, name: "Fresh Fusion Alpha", type: "Fusion Monster", frameType: "fusion" },
    { id: 910002, name: "Fresh Link Beta", type: "Link Monster", frameType: "link" },
    { id: 910003, name: "Fresh Effect Gamma", type: "Effect Monster", frameType: "effect" },
  ].map((card) => ({ ...card, card_images: [{ id: card.id, image_url: "fresh", image_url_small: "fresh-small" }] }));
  upstream.mockImplementation(async (input) => {
    const params = new URL(String(input)).searchParams;
    const names = params.get("name")?.split("|");
    const word = params.get("fname")?.toLowerCase();
    return Response.json({ data: fresh.filter((card) => names ? names.includes(card.name) : word ? card.name.toLowerCase().includes(word) : false) });
  });
  // The prose probes would use the 50 lookups before the misspelt Extra Deck name is reached, if they came first.
  const prose = Array.from({ length: 40 }, (_, i) => `Heading${i} section${i} number${i}`);
  const response = await resolve({ listText: [...prose, "2 Fresh Fusion Alpah [Extra]", "Fresh Link Beta x1", "3 Fresh Effect Gamma"].join("\n") });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.entries).toEqual([
    { id: 910001, copies: 2, pool: "extra" }, { id: 910002, copies: 1, pool: "extra" }, { id: 910003, copies: 3, pool: "main" },
  ]);
  expect(result.corrected).toEqual([{ from: "Fresh Fusion Alpah", to: "Fresh Fusion Alpha" }]);
  expect(result.unknown).toEqual(prose);
}, 40000);
