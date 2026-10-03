import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth }));
const tempDirs: string[] = [];

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "duel-opening-route-"));
  tempDirs.push(dir);
  process.env.DATABASE_PATH = join(dir, "bot.sqlite");
  process.env.DISCORD_GUILD_ID = "g1";
  process.env.DISCORD_TOKEN = "bot-token";
  process.env.DUEL_INTERNAL_URL = "http://duel.test:4003";
  process.env.DUEL_INTERNAL_SECRET = "s3cret";
  const db = new Database(process.env.DATABASE_PATH);
  migrate(db);
  const insert = db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)");
  const host = Number(insert.run("u-host", "Yugi").lastInsertRowid);
  insert.run("u-other", "Kaiba");
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g1", organizerPlayerId: host, name: "Table", mode: "normal" });
  return { slug: session.slug };
}

function post(slug: string, body: unknown) {
  return [
    new Request(`http://localhost/api/duels/${slug}/opening`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ slug }) },
  ] as const;
}

describe("POST /api/duels/[slug]/opening", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let hostReply: () => Response;
  const hostCalls = () => fetchMock.mock.calls.filter((call) => String(call[0]).startsWith("http://duel.test:4003"));
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: "u-host", name: "Yugi" } });
    hostReply = () => Response.json({ session: { status: "lobby" } });
    // The Discord member check answers 200; the duel host answers with `hostReply`.
    fetchMock = vi.fn(async (url: unknown) => (String(url).startsWith("http://duel.test:4003") ? hostReply() : new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    for (const key of ["DATABASE_PATH", "DISCORD_GUILD_ID", "DISCORD_TOKEN", "DUEL_INTERNAL_URL", "DUEL_INTERNAL_SECRET"]) delete process.env[key];
    vi.unstubAllGlobals();
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  function sentPayload() {
    return JSON.parse(hostCalls()[0][1].body as string) as Record<string, unknown>;
  }

  it("sends a move to the duel host as the signed-in player", async () => {
    const s = seed();
    const { POST } = await import("../app/api/duels/[slug]/opening/route");
    const res = await POST(...post(s.slug, { move: "rock" }));
    expect(res.status).toBe(200);
    expect(sentPayload()).toMatchObject({ op: "opening-pick", slug: s.slug, guildId: "g1", move: "rock" });
  });

  it("sends the winner's choice to the duel host", async () => {
    const s = seed();
    const { POST } = await import("../app/api/duels/[slug]/opening/route");
    const res = await POST(...post(s.slug, { choice: "second" }));
    expect(res.status).toBe(200);
    expect(sentPayload()).toMatchObject({ op: "opening-choose", choice: "second" });
  });

  it("refuses a body that is neither a move nor a choice, without calling the host", async () => {
    const s = seed();
    const { POST } = await import("../app/api/duels/[slug]/opening/route");
    expect((await POST(...post(s.slug, { move: "lizard" }))).status).toBe(400);
    expect((await POST(...post(s.slug, { choice: "third" }))).status).toBe(400);
    expect((await POST(...post(s.slug, "not json"))).status).toBe(400);
    expect(hostCalls()).toHaveLength(0);
  });

  it("passes a host refusal through", async () => {
    const s = seed();
    hostReply = () => Response.json({ error: "You already picked this round" }, { status: 409 });
    const { POST } = await import("../app/api/duels/[slug]/opening/route");
    const res = await POST(...post(s.slug, { move: "paper" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("already picked");
  });

  it("refuses a signed-out request", async () => {
    const s = seed();
    auth.mockResolvedValue(null);
    const { POST } = await import("../app/api/duels/[slug]/opening/route");
    expect((await POST(...post(s.slug, { move: "rock" }))).status).toBeGreaterThanOrEqual(401);
    expect(hostCalls()).toHaveLength(0);
  });
});
