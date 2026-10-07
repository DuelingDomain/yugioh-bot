import { seedFixtureUsers, fixtureUserId, fixtureDiscordId } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture((() => ({ auth: vi.fn().mockResolvedValue({ user: { id: String(fixtureUserId("host")), discordUserId: fixtureDiscordId("host"), name: "Host" } }) }))().auth);
});
vi.mock("@/lib/notify", () => ({ announcer: { announce: vi.fn() }, broadcaster: { draft: vi.fn() } }));
let directory: string;
beforeEach(() => {
  vi.resetModules();
  directory = mkdtempSync(join(tmpdir(), "draft-theme-numbers-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "test.sqlite"));
  vi.stubEnv("DISCORD_GUILD_ID", "g");
  vi.stubEnv("DISCORD_DEFAULT_CHANNEL_ID", "c");
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

it("theme preflight does not block picks when the copy limit is off", async () => {
  const { getDb } = await import("../src/lib/db");
  const db = getDb();
  seedFixtureUsers(db, FIXTURE_KEYS);
  const { createDraftService, createPlayerService, createCubeService, createCardCatalogService } = await import("@yugidraft/shared/services");
  const host = createPlayerService(db).findOrCreate("g", fixtureUserId("host"), "Host");
  db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (1, 'A', 'Normal Monster', 'normal', '', '', '[]', 't')").run();
  const cubes = createCubeService(db, createCardCatalogService(db));
  const cube = cubes.createBlank("g", "Copies", fixtureUserId("host"));
  cubes.addCard(cube.id, 1, "main", 20);
  const draft = createDraftService(db).create("g", "c", "Off", { mode: "theme", allowedCubeIds: [cube.id], uniqueThemes: false, themeSelection: "random", cardsPerPlayer: 10, extraDeckEnabled: false, themePackSize: 2, copyLimit: false }, fixtureUserId("host"), host.id);
  const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
  const response = await GET(new Request("http://x"), { params: Promise.resolve({ slug: draft.webSlug! }) });
  expect((await response.json()).errors).toEqual([]);
});

const FIXTURE_KEYS = ["host"] as const;

// Session resolution is mocked; authorization still runs through the real web boundary.
