import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "host", name: "Host" } }) }));
vi.mock("@/lib/notify", () => ({ announcer: { announce: vi.fn() }, broadcaster: { draft: vi.fn() } }));
let directory: string;

beforeEach(() => {
  vi.resetModules();
  directory = mkdtempSync(join(tmpdir(), "yugioh-booster-preflight-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "draft.sqlite"));
  vi.stubEnv("DISCORD_GUILD_ID", "g");
  vi.stubEnv("DISCORD_DEFAULT_CHANNEL_ID", "c");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it.each([
  { distinct: 8, packSize: 4, packsPerPlayer: 10, cardsPerPlayer: 40, impossible: true },
  { distinct: 8, packSize: 4, packsPerPlayer: 10, cardsPerPlayer: 20, impossible: true },
  ...[16, 17, 18, 19].map((distinct) => ({ distinct, packSize: 8, packsPerPlayer: 5, cardsPerPlayer: 60, impossible: true })),
])("surfaces booster reachability for $distinct distinct cards and a $cardsPerPlayer-card deck in create, edit, preflight and start", async ({ distinct, packSize, packsPerPlayer, cardsPerPlayer, impossible }) => {
  const { getDb } = await import("../src/lib/db");
  const db = getDb();
  const ids = Array.from({ length: distinct }, (_, i) => i + 1);
  const insert = db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (?, ?, 'Normal Monster', 'normal', 'i', 'i', '[]', 't')");
  for (const id of ids) insert.run(id, `Card ${id}`);
  const { POST } = await import("../app/api/drafts/route");
  const config = { customCardIds: ids, packSize, packsPerPlayer, cardsPerPlayer };
  const created = await POST(new Request("http://x/api/drafts", {
    method: "POST", body: JSON.stringify({ name: "Narrow", config }),
  }) as NextRequest);
  expect(created.status).toBe(201);
  const draft = await created.json();
  const context = { params: Promise.resolve({ slug: draft.webSlug }) };
  const expectedErrors = impossible ? expect.arrayContaining([expect.stringMatching(/The cube has/)]) : [];
  expect(draft.errors).toEqual(expectedErrors);

  const { PUT } = await import("../app/api/drafts/[slug]/route");
  const edited = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ config }) }) as NextRequest, context);
  expect(edited.status).toBe(packSize < 5 || cardsPerPlayer < 40 ? 400 : 200);
  if (edited.status === 200) expect((await edited.json()).errors).toEqual(expectedErrors);

  const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
  const preflight = await GET(new Request("http://x"), context);
  expect(preflight.status).toBe(200);
  expect((await preflight.json()).errors).toEqual(expectedErrors);

  const { createDraftService, createPlayerService } = await import("@yugidraft/shared/services");
  const players = createPlayerService(db);
  const drafts = createDraftService(db);
  drafts.join(draft.id, players.findOrCreate("g", "other", "Other").id);
  if (impossible) {
    expect(() => drafts.start(draft.id)).toThrow(/The cube has/);
    expect(drafts.findById(draft.id).status).toBe("pending");
  } else {
    expect(drafts.start(draft.id).status).toBe("active");
  }
});
