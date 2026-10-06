import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const broadcaster = { draft: vi.fn(), tournament: vi.fn() };
const tempDirs: string[] = [];

vi.mock("@/lib/auth", () => ({
  auth,
}));

vi.mock("@/lib/notify", () => ({
  broadcaster,
  announcer: { announce: vi.fn() },
}));

async function createCompletedDraftWithDeal(status = "completed", withPass = false) {
  const tempDir = mkdtempSync(join(tmpdir(), "yugioh-drafts-delete-route-"));
  const dbPath = join(tempDir, "drafts-delete-route.sqlite");
  tempDirs.push(tempDir);

  process.env.DATABASE_PATH = dbPath;
  process.env.DISCORD_GUILD_ID = "guild-1";
  process.env.WS_INTERNAL_URL = "http://ws:3001";
  process.env.WS_INTERNAL_SECRET = "secret";

  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("@yugidraft/shared/db");
  const { createDraftService, createPlayerService } = await import("@yugidraft/shared/services");
  const db = new Database(dbPath);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);

  const players = createPlayerService(db);
  const creator = players.findOrCreate("guild-1", fixtureUserId("creator-user"), "Yugi");
  const drafts = createDraftService(db);
  const draft = drafts.create(
    "guild-1",
    "channel-1",
    "completed deal draft",
    { setNames: ["Metal Raiders"], packSize: 2, packsPerPlayer: 1 },
    fixtureUserId("creator-user"),
    creator.id,
  );

  // A completed draft carries draft_deal rows. draft_deal.catalog_card_id has an
  // FK to card_catalog, so seed a catalog row before referencing it.
  db.prepare(
    `insert into card_catalog
       (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at)
     values (1, 'Test Card', 'Normal Monster', 'normal', 'http://x/i.png', 'http://x/s.png', '[]', '2026-01-01')`,
  ).run();
  db.prepare("insert into draft_deal (draft_id, position, catalog_card_id) values (?, 0, 1)").run(draft.id);
  if (withPass) {
    db.prepare("insert into draft_passes (draft_id, player_id, wave_number, pick_step, passed_at) values (?, ?, 1, 1, 't')")
      .run(draft.id, creator.id);
  }
  db.prepare("update drafts set status = ? where id = ?").run(status, draft.id);

  db.close();

  return draft;
}

describe("DELETE /api/drafts/[slug]", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    broadcaster.draft.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("creator-user")), discordUserId: fixtureDiscordId("creator-user"), name: "Yugi" } });
  });

  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    delete process.env.WS_INTERNAL_URL;
    delete process.env.WS_INTERNAL_SECRET;

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("deletes a completed draft that has draft_deal rows", async () => {
    const draft = await createCompletedDraftWithDeal();
    const { DELETE } = await import("../app/api/drafts/[slug]/route");

    const response = await DELETE(
      new Request(`http://localhost/api/drafts/${draft.webSlug}`, { method: "DELETE" }),
      { params: Promise.resolve({ slug: draft.webSlug ?? "" }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(true);

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.DATABASE_PATH!);
    const row = db.prepare("select id from drafts where id = ?").get(draft.id);
    const dealRows = db.prepare("select count(*) as c from draft_deal where draft_id = ?").get(draft.id) as { c: number };
    db.close();

    expect(row).toBeUndefined();
    expect(dealRows.c).toBe(0);
  });

  it.each(["completed", "cancelled"])("deletes a %s draft with pass rows", async (status) => {
    const draft = await createCompletedDraftWithDeal(status, true);
    const { DELETE } = await import("../app/api/drafts/[slug]/route");
    const response = await DELETE(
      new Request(`http://localhost/api/drafts/${draft.webSlug}`, { method: "DELETE" }),
      { params: Promise.resolve({ slug: draft.webSlug ?? "" }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).deleted).toBe(true);

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.DATABASE_PATH!);
    expect(db.prepare("select id from drafts where id = ?").get(draft.id)).toBeUndefined();
    expect(db.prepare("select count(*) as n from draft_passes where draft_id = ?").get(draft.id)).toEqual({ n: 0 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });

  it("deletes a completed theme draft that has draft_player_cube rows", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "yugioh-drafts-delete-theme-"));
    const dbPath = join(tempDir, "delete-theme.sqlite");
    tempDirs.push(tempDir);
    process.env.DATABASE_PATH = dbPath;
    process.env.DISCORD_GUILD_ID = "guild-1";

    const Database = (await import("better-sqlite3")).default;
    const { migrate } = await import("@yugidraft/shared/db");
    const { createDraftService, createPlayerService } = await import("@yugidraft/shared/services");
    const db = new Database(dbPath);
    migrate(db);
    seedFixtureUsers(db, FIXTURE_KEYS);

    const players = createPlayerService(db);
    const creator = players.findOrCreate("guild-1", fixtureUserId("creator-user"), "Yugi");
    const drafts = createDraftService(db);
    const draft = drafts.create(
      "guild-1",
      "channel-1",
      "completed theme draft",
      { mode: "theme", allowedCubeIds: [] },
      fixtureUserId("creator-user"),
      creator.id,
    );
    const cubeId = Number(
      db.prepare(`insert into cubes (guild_id, name, created_by_user_id, created_at, updated_at) values ('guild-1', 'Blue-Eyes', ${fixtureUserId("creator-user")}, 't', 't')`).run().lastInsertRowid,
    );
    // FK row that previously blocked deletion.
    db.prepare("insert into draft_player_cube (draft_id, player_id, cube_id) values (?, ?, ?)").run(draft.id, creator.id, cubeId);
    db.prepare("update drafts set status = 'completed' where id = ?").run(draft.id);
    db.close();

    const { DELETE } = await import("../app/api/drafts/[slug]/route");
    const response = await DELETE(
      new Request(`http://localhost/api/drafts/${draft.webSlug}`, { method: "DELETE" }),
      { params: Promise.resolve({ slug: draft.webSlug ?? "" }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).deleted).toBe(true);

    const verify = new Database(dbPath);
    const draftRow = verify.prepare("select id from drafts where id = ?").get(draft.id);
    const dpcRows = verify.prepare("select count(*) as c from draft_player_cube where draft_id = ?").get(draft.id) as { c: number };
    const cubeRow = verify.prepare("select id from cubes where id = ?").get(cubeId);
    verify.close();

    expect(draftRow).toBeUndefined();
    expect(dpcRows.c).toBe(0);
    expect(cubeRow).toBeTruthy(); // the reusable cube itself survives
  });
});

const FIXTURE_KEYS = ["creator-user"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
