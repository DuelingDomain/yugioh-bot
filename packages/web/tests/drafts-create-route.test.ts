import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const tempDirs: string[] = [];

vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});

describe("POST /api/drafts", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("creator-user")), discordUserId: fixtureDiscordId("creator-user"), name: "Yugi" } });
  });

  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    delete process.env.DISCORD_DEFAULT_CHANNEL_ID;

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it.each([false, true])("creates a draft from custom card ids without selected sets (email-only=%s)", async emailOnly => {
    if (emailOnly) auth.mockResolvedValue({ user: { id: String(fixtureUserId("creator-user")), discordUserId: null, name: "Yugi" } });
    const tempDir = mkdtempSync(join(tmpdir(), "yugioh-drafts-create-route-"));
    const dbPath = join(tempDir, "drafts-create-route.sqlite");
    tempDirs.push(tempDir);

    process.env.DATABASE_PATH = dbPath;
    process.env.DISCORD_GUILD_ID = "guild-1";
    process.env.DISCORD_DEFAULT_CHANNEL_ID = "channel-1";

    const Database = (await import("better-sqlite3")).default;
    const { migrate } = await import("@yugidraft/shared/db");
    const db = new Database(dbPath);
    migrate(db);
    seedFixtureUsers(db, FIXTURE_KEYS);
    // This test exercises draft creation with a known custom pool, entirely offline.
    const card = db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values(?,?,'Normal Monster','normal','i','i','[]',?)");
    for (const id of [46986414, 83764718]) card.run(id, `Card ${id}`, new Date().toISOString());
    if (emailOnly) db.prepare("update users set discord_user_id=null where id=?").run(fixtureUserId("creator-user"));
    db.close();

    const { POST } = await import("../app/api/drafts/route");
    const request = new Request("http://localhost/api/drafts", {
      method: "POST",
      body: JSON.stringify({
        name: "Custom Pool Draft",
        config: { setNames: [], customCardIds: [46986414, 83764718], packSize: 8, packsPerPlayer: 5 },
      }),
    }) as NextRequest;
    const response = await POST(request);

    expect(response.status).toBe(201);

    const verifyDb = new Database(dbPath);
    const row = verifyDb.prepare("select config_json from drafts where name = ?").get("Custom Pool Draft") as {
      config_json: string;
    };
    expect(JSON.parse(row.config_json).customCardIds).toEqual([46986414, 83764718]);
    verifyDb.close();
  });

  it("creates and deals a draft from a saved cube's cards", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "yugioh-drafts-create-route-"));
    const dbPath = join(tempDir, "drafts-create-saved.sqlite");
    tempDirs.push(tempDir);

    process.env.DATABASE_PATH = dbPath;
    process.env.DISCORD_GUILD_ID = "guild-1";
    process.env.DISCORD_DEFAULT_CHANNEL_ID = "channel-1";

    const Database = (await import("better-sqlite3")).default;
    const { migrate } = await import("@yugidraft/shared/db");
    const db = new Database(dbPath);
    migrate(db);
    seedFixtureUsers(db, FIXTURE_KEYS);
    const insCard = db.prepare(
      `insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
       values (?,?,?,?,?,?,?,?)`,
    );
    const mainIds = Array.from({ length: 20 }, (_, i) => 1000 + i);
    for (const id of mainIds) insCard.run(id, `Main ${id}`, "Effect Monster", "effect", "i", "i", "[]", "t");
    insCard.run(2000, "Extra 2000", "Fusion Monster", "fusion", "i", "i", "[]", "t");
    const cube = Number(
      db.prepare(`insert into cubes (guild_id, name, created_by_user_id) values ('guild-1', 'Dark Magician', ${fixtureUserId("u")})`).run()
        .lastInsertRowid,
    );
    const insCube = db.prepare("insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) values (?, ?, ?, ?)");
    // The first card has five copies in the cube, more than the three one player may hold.
    const copiesOf = (id: number) => (id === mainIds[0] ? 5 : 3);
    for (const id of mainIds) insCube.run(cube, id, "main", copiesOf(id));
    insCube.run(cube, 2000, "extra", 3);
    db.close();

    // What the form does: list the saved pools, load one, post it as the draft pool.
    const { GET: listCubes } = await import("../app/api/cubes/route");
    const listed = (await (await listCubes()).json()) as {
      cubes: Array<{ name: string; customCardIds: number[]; mainCards: Array<{ id: number; copies: number }> }>;
    };
    const saved = listed.cubes.find((c) => c.name === "Dark Magician")!;
    // The pool editor turns a cube's main pool into one passcode per copy for the draft config.
    const { poolFromEntries, poolToIds } = await import("../src/components/draft/pool/pool-model");
    const loaded = poolToIds(poolFromEntries(saved.mainCards));
    const expected = mainIds.flatMap((id) => Array.from({ length: copiesOf(id) }, () => id));
    expect(loaded).toEqual(expected);

    const { POST } = await import("../app/api/drafts/route");
    const response = await POST(
      new Request("http://localhost/api/drafts", {
        method: "POST",
        body: JSON.stringify({
          name: "From Saved Pool",
          config: { setNames: [], customCardIds: loaded, packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 },
        }),
      }) as NextRequest,
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: number };

    const verifyDb = new Database(dbPath);
    const { createDraftService } = await import("@yugidraft/shared/services");
    const drafts = createDraftService(verifyDb);
    const draft = drafts.findById(id);
    expect([...(draft.config.cubeCardIds ?? [])].sort()).toEqual([...expected].sort());

    seedFixtureUsers(verifyDb, ["a", "b"]);
    const insPlayer = verifyDb.prepare("insert into players (guild_id, user_id, discord_user_id, display_name) values ('guild-1', ?, ?, ?)");
    for (const n of ["a", "b"]) {
      const pid = Number(insPlayer.run(fixtureUserId(n), fixtureDiscordId(n), n).lastInsertRowid);
      drafts.join(id, pid);
    }
    drafts.start(id);
    const dealt = verifyDb.prepare("select catalog_card_id from draft_deal where draft_id = ?").all(id) as Array<{
      catalog_card_id: number;
    }>;
    // The creator is seated automatically, so two joiners make three players.
    expect(drafts.players(id)).toHaveLength(3);
    expect(dealt).toHaveLength(3 * 4 * 2);
    expect(dealt.every((r) => mainIds.includes(r.catalog_card_id))).toBe(true);
    verifyDb.close();
  });
});

const FIXTURE_KEYS = ["creator-user", "u"] as const;

// Session resolution is mocked; authorization still runs through the real web boundary.
