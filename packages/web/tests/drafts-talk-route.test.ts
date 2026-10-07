import { fixtureUserId, fixtureDiscordId } from "./fixtures/identity";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDraftDeck } from "./helpers/draft-deck-fixture";

const auth = vi.fn();
const broadcaster = { draft: vi.fn(), tournament: vi.fn() };
const dirs: string[] = [];
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/notify", () => ({ announcer: {}, broadcaster }));

const params = (slug = "slug-1") => ({ params: Promise.resolve({ slug }) });
const post = (body: unknown, raw?: string) =>
  new Request("http://localhost/api/drafts/slug-1/talk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  }) as never;

async function call(body: unknown, slug?: string, raw?: string) {
  const { POST } = await import("../app/api/drafts/[slug]/talk/route");
  return POST(post(body, raw), params(slug));
}

async function seed(status = "active") {
  vi.stubEnv("DATABASE_PATH", process.env.DATABASE_PATH);
  vi.stubEnv("DISCORD_GUILD_ID", process.env.DISCORD_GUILD_ID);
  const fixture = await seedDraftDeck({ picks: [1, 2, 3], status });
  dirs.push(fixture.dir);
  return fixture;
}

/** Seats the fixture's second player ("outsider") in the draft. */
async function seatOutsider(fixture: Awaited<ReturnType<typeof seed>>) {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(join(fixture.dir, "test.sqlite"));
  db.prepare("insert into draft_players (draft_id, player_id) values (?, ?)").run(fixture.draftId, fixture.players.outsider);
  db.close();
}

describe("POST /api/drafts/[slug]/talk", () => {
  beforeEach(async () => {
    vi.resetModules();
    auth.mockReset();
    broadcaster.draft.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("drafter")), discordUserId: fixtureDiscordId("drafter"), name: "Yugi" } });
    (await import("../src/lib/draft-talk")).resetTalkLimiter();
  });
  afterEach(async () => {
    vi.useRealTimers();
    if (dirs.length) {
      const { getDb } = await import("../src/lib/db");
      getDb().close();
    }
    vi.unstubAllEnvs();
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("401 when signed out", async () => {
    await seed();
    auth.mockResolvedValue(null);
    expect((await call({ line: "gg" })).status).toBe(401);
    expect(broadcaster.draft).not.toHaveBeenCalled();
  });

  it.each([
    ["free text", { line: "hello table" }],
    ["the words instead of the id", { line: "hurry up" }],
    ["a number", { line: 1 }],
    ["no line", {}],
    ["an empty line", { line: "" }],
    ["a prototype name", { line: "__proto__" }],
  ])("400 for %s", async (_name, body) => {
    await seed();
    expect((await call(body)).status).toBe(400);
    expect(broadcaster.draft).not.toHaveBeenCalled();
  });

  it("400 for a body that is not JSON", async () => {
    await seed();
    expect((await call(null, undefined, "{nope")).status).toBe(400);
  });

  it("404 for an unknown draft", async () => {
    await seed();
    expect((await call({ line: "gg" }, "nope")).status).toBe(404);
  });

  it("403 when the caller has a player but is not seated in this draft", async () => {
    await seed();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("outsider")), discordUserId: fixtureDiscordId("outsider"), name: "Kaiba" } });
    const res = await call({ line: "gg" });
    expect(res.status).toBe(403);
    expect(broadcaster.draft).not.toHaveBeenCalled();
  });

  it("403 when the caller has no player at all", async () => {
    await seed();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("stranger")), discordUserId: fixtureDiscordId("stranger"), name: "Joey" } });
    expect((await call({ line: "gg" })).status).toBe(403);
  });

  it("409 when the draft is not active", async () => {
    await seed("completed");
    expect((await call({ line: "gg" })).status).toBe(409);
    expect(broadcaster.draft).not.toHaveBeenCalled();
  });

  it("relays the line to the draft room with the sender's player id, and nothing about picks", async () => {
    const fixture = await seed();
    const res = await call({ line: "hurry" });
    expect(res.status).toBe(200);
    expect(broadcaster.draft).toHaveBeenCalledTimes(1);
    expect(broadcaster.draft).toHaveBeenCalledWith({ kind: "talk", slug: "slug-1", playerId: fixture.players.drafter, line: "hurry" });
  });

  it("429 when the same player talks again too soon, and again after the wait", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    await seed();
    expect((await call({ line: "gg" })).status).toBe(200);
    vi.setSystemTime(1_001_000);
    const refused = await call({ line: "lol" });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("3");
    expect(await refused.json()).toMatchObject({ retryAfterMs: 2500 });
    expect(broadcaster.draft).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_003_500);
    expect((await call({ line: "lol" })).status).toBe(200);
    expect(broadcaster.draft).toHaveBeenCalledTimes(2);
  });

  it("gives each seated player their own cooldown", async () => {
    const fixture = await seed();
    await seatOutsider(fixture);
    expect((await call({ line: "gg" })).status).toBe(200);
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("outsider")), discordUserId: fixtureDiscordId("outsider"), name: "Kaiba" } });
    expect((await call({ line: "gl" })).status).toBe(200);
    expect(broadcaster.draft).toHaveBeenLastCalledWith({ kind: "talk", slug: "slug-1", playerId: fixture.players.outsider, line: "gl" });
  });

  it("does not start the cooldown for a refused request", async () => {
    await seed();
    expect((await call({ line: "nope" })).status).toBe(400);
    expect((await call({ line: "gg" })).status).toBe(200);
  });
});

const FIXTURE_KEYS = ["drafter", "outsider", "stranger"] as const;

// Session resolution is mocked; authorization still runs through the real web boundary.
