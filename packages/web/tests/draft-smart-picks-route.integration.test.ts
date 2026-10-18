import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createCardCatalogService, createCardInsightService, createCubeService, createDraftService } from "@yugidraft/shared/services";
import { seedIdentity } from "../../shared/tests/helpers/identity";

const fixture = vi.hoisted(() => ({ db: undefined as unknown as Database.Database, userId: 0 }));
vi.mock("@/lib/db", () => ({ getDb: () => fixture.db }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g" } }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: async () => ({ ok: true, userId: fixture.userId, discordUserId: null }) }));
vi.mock("@/lib/owner-access", () => ({ isOwnerUser: () => false }));
vi.mock("@/lib/notify", () => ({ broadcaster: { draft: vi.fn() }, announcer: {} }));
vi.mock("@/lib/draft-engine-types", () => ({ lookupDraftCardTypes: async () => new Map() }));

afterEach(() => { fixture.db?.close(); vi.unstubAllEnvs(); });

it.each(["booster", "theme"] as const)("returns private flag-controlled pool reasons and ranked bot picks in a %s draft", async mode => {
  fixture.db = new Database(":memory:"); const db = fixture.db; migrate(db);
  const human = seedIdentity(db, { guildId: "g", name: "Human" }); fixture.userId = human.userId;
  const bot = seedIdentity(db, { guildId: "g", name: "Bot", discordUserId: "bot_fixture" });
  for (let id = 1; id <= 32; id++) db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,archetype,image_url,image_url_small,card_sets_json,cached_at)
    VALUES(?,?,'Effect Monster','effect','Draft family','i','i','[]','t')`).run(id, `Family card ${id}`);
  const cubes = createCubeService(db, createCardCatalogService(db));
  const cube = cubes.createBlank("g", "Private cube", human.userId);
  for (let id = 1; id <= 32; id++) cubes.addCard(cube.id, id, "main", 1);
  const drafts = createDraftService(db, { seedSource: () => 183 });
  const draft = drafts.create("g", null, "Private draft", mode === "theme" ? {
    mode: "theme", allowedCubeIds: [cube.id], themeSelection: "random", uniqueThemes: false,
    cardsPerPlayer: 4, themePackSize: 3, extraDeckEnabled: false,
  } : { cubeCardIds: Array.from({ length: 32 }, (_, i) => i + 1), packSize: 4, packsPerPlayer: 1, cardsPerPlayer: 4 }, human.userId, human.playerId);
  drafts.join(draft.id, bot.playerId); drafts.start(draft.id);
  const { buildDraftResponse } = await import("../app/api/drafts/[slug]/helpers");
  const { POST } = await import("../app/api/drafts/[slug]/pick/route");
  vi.stubEnv("EFFECT_SEARCH", "1");
  const empty = await buildDraftResponse(draft.webSlug!, human);
  expect(empty?.effectSearchEnabled).toBe(true);
  expect(empty?.currentPack.every(card => card.fitsYourPool === undefined)).toBe(true);
  const expectedBot = drafts.rankPickOptions(draft.id, bot.playerId)[0];
  const response = await POST(new Request("http://localhost/pick", { method: "POST", body: JSON.stringify({ cardId: drafts.pickOptions(draft.id, human.playerId)[0].id }) }) as NextRequest,
    { params: Promise.resolve({ slug: draft.webSlug! }) });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(drafts.pool(draft.id, bot.playerId)[0].draftCardId).toBe(expectedBot.id);
  expect(body.effectSearchEnabled).toBe(true);
  expect(body.attribution).toBe("Effect search powered by searchygo");
  expect(body.currentPack.length).toBeGreaterThan(0);
  const pool = drafts.pool(draft.id, human.playerId).map(card => card.catalogCardId);
  const insights = createCardInsightService(db);
  for (const card of body.currentPack) {
    expect(card.fitsYourPool).toBe("Shares Draft family");
    expect(insights.pickScore(card.passcode, pool)).toBeGreaterThan(0);
    expect(card).not.toHaveProperty("score");
  }
  const watcher = seedIdentity(db, { guildId: "g", name: "Watcher" });
  const watched = await buildDraftResponse(draft.webSlug!, watcher);
  expect(watched?.currentPack).toEqual([]); expect(watched?.myPool).toEqual([]);
  vi.stubEnv("EFFECT_SEARCH", "0");
  const disabled = await buildDraftResponse(draft.webSlug!, human);
  expect(disabled?.effectSearchEnabled).toBe(false);
  expect(disabled).not.toHaveProperty("attribution");
  expect(disabled?.currentPack.every(card => card.fitsYourPool === undefined)).toBe(true);
});
