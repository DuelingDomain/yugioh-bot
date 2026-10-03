import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const announcer = { announce: vi.fn() };
const broadcaster = { draft: vi.fn() };
const tempDirs: string[] = [];
const databases: Database.Database[] = [];

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({ announcer, broadcaster }));

describe("draft config privacy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "participant", name: "Kaiba" } });
  });

  afterEach(() => {
    while (databases.length > 0) databases.pop()!.close();
    vi.unstubAllEnvs();
    while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  async function setupDraft() {
    const dir = mkdtempSync(join(tmpdir(), "yugioh-private-draft-"));
    tempDirs.push(dir);
    vi.stubEnv("DATABASE_PATH", join(dir, "draft.sqlite"));
    vi.stubEnv("DISCORD_GUILD_ID", "guild-1");

    const { getDb } = await import("@/lib/db");
    const db = getDb();
    databases.push(db);
    const { createCardCatalogService, createCubeService, createDraftService, createPlayerService } =
      await import("@yugidraft/shared/services");
    const players = createPlayerService(db);
    const creator = players.findOrCreate("guild-1", "creator", "Yugi");
    const participant = players.findOrCreate("guild-1", "participant", "Kaiba");
    const cubes = createCubeService(db, createCardCatalogService(db));
    const cubeIds: number[] = [];
    for (let theme = 0; theme < 2; theme++) {
      const cube = cubes.createBlank("guild-1", `Theme ${theme}`, "creator");
      for (let index = 1; index <= 8; index++) {
        const cardId = theme * 8 + index;
        db.prepare(
          `insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at)
           values (?, ?, 'Normal Monster', 'normal', 'image', 'image', '[]', '2026-01-01')`,
        ).run(cardId, `Card ${cardId}`);
        cubes.addCard(cube.id, cardId, "main", 1);
      }
      cubeIds.push(cube.id);
    }

    const secretSeed = "ab".repeat(32);
    const drafts = createDraftService(db, { seedSource: () => secretSeed });
    const assignments = { [String(creator.id)]: cubeIds[0], [String(participant.id)]: cubeIds[1] };
    const draft = drafts.create(
      "guild-1", "channel-1", "private themes",
      {
        mode: "theme", themeSelection: "host_assigned", allowedCubeIds: cubeIds,
        themeAssignments: assignments, cardsPerPlayer: 3, themePackSize: 3, extraDeckEnabled: false,
      },
      "creator", creator.id,
    );
    drafts.join(draft.id, participant.id);
    return { db, drafts, draft, creator, participant, assignments, secretSeed };
  }

  it.each(["pending", "active", "completed"])("GET hides assignments and seeds from a non-creator in a %s draft", async (status) => {
    const { db, drafts, draft, creator, participant, assignments, secretSeed } = await setupDraft();
    if (status !== "pending") drafts.start(draft.id);
    if (status === "completed") {
      for (let round = 0; round < 3; round++) {
        for (const playerId of [creator.id, participant.id]) {
          drafts.pickCard(draft.id, playerId, drafts.currentPackOptions(draft.id, playerId)[0].id, "manual");
        }
      }
    }
    const { GET } = await import("../app/api/drafts/[slug]/route");
    const params = { params: Promise.resolve({ slug: draft.webSlug! }) };
    for (const userId of ["participant", "observer"]) {
      auth.mockResolvedValue({ user: { id: userId } });
      const response = await GET(new Request(`http://localhost/api/drafts/${draft.webSlug}`), params);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe(status);
      expect(body.config).not.toHaveProperty("themeAssignments");
      expect(Object.keys(body.config).filter((key) => /seed/i.test(key))).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(secretSeed);
    }

    // The host's editor still gets the map, and filtering never alters stored config.
    auth.mockResolvedValue({ user: { id: "creator" } });
    const hostResponse = await GET(new Request(`http://localhost/api/drafts/${draft.webSlug}`), params);
    expect(hostResponse.status).toBe(200);
    const hostBody = await hostResponse.json();
    expect(hostBody.config.themeAssignments).toEqual(assignments);
    expect(Object.keys(hostBody.config).filter((key) => /seed/i.test(key))).toEqual([]);
    expect(JSON.stringify(hostBody)).not.toContain(secretSeed);
    const stored = db.prepare("select config_json from drafts where id = ?").get(draft.id) as { config_json: string };
    expect(JSON.parse(stored.config_json).themeAssignments).toEqual(assignments);
    expect(stored.config_json).not.toContain(secretSeed);
  });

  it("PUT preserves the creator's theme assignment edit flow without returning a seed", async () => {
    const { drafts, draft, assignments, creator, participant, secretSeed } = await setupDraft();
    auth.mockResolvedValue({ user: { id: "creator" } });
    const swapped = { [String(creator.id)]: assignments[String(participant.id)], [String(participant.id)]: assignments[String(creator.id)] };
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(new Request(`http://localhost/api/drafts/${draft.webSlug}`, {
      method: "PUT", body: JSON.stringify({ config: { themeAssignments: swapped } }),
    }) as NextRequest, { params: Promise.resolve({ slug: draft.webSlug! }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config.themeAssignments).toEqual(swapped);
    expect(Object.keys(body.config).filter((key) => /seed/i.test(key))).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(secretSeed);
    expect(drafts.findById(draft.id).config.themeAssignments).toEqual(swapped);
  });

  it("pick POST hides the assignment map and seed from the participant", async () => {
    const { drafts, draft, participant, secretSeed } = await setupDraft();
    drafts.start(draft.id);
    const option = drafts.currentPackOptions(draft.id, participant.id)[0];
    const { POST } = await import("../app/api/drafts/[slug]/pick/route");
    const response = await POST(new Request(`http://localhost/api/drafts/${draft.webSlug}/pick`, {
      method: "POST", body: JSON.stringify({ cardId: option.id }),
    }) as NextRequest, { params: Promise.resolve({ slug: draft.webSlug! }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.myPool).toHaveLength(1);
    expect(body.config).not.toHaveProperty("themeAssignments");
    expect(Object.keys(body.config).filter((key) => /seed/i.test(key))).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(secretSeed);
  });
});
