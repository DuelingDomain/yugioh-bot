import { useRecordingObservability } from "../../shared/tests/helpers/recording-observability.mjs";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDraftService, createPlayerService } from "@yugidraft/shared/services";

let db: Database.Database;
const databases: Database.Database[] = [];
const directories: string[] = [];
const broadcast = vi.fn();
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g" } }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: async () => ({
  ok: true, userId: 1, userName: "Host", discordUserId: null,
}) }));
vi.mock("@/lib/notify", () => ({ broadcaster: { draft: broadcast }, announcer: { announce: vi.fn() } }));
vi.mock("@yugidraft/shared/services", async importOriginal => {
  const actual = await importOriginal<typeof import("@yugidraft/shared/services")>();
  return { ...actual, createDraftService: vi.fn(actual.createDraftService) };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(createDraftService).mockClear();
  broadcast.mockReset();
  for (const connection of databases.splice(0)) connection.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it("stops the pick route's bot loop when cancellation commits after it reads options", async () => {
  const directory = mkdtempSync(join(tmpdir(), "draft-pick-terminal-race-"));
  directories.push(directory);
  const path = join(directory, "test.sqlite");
  db = new Database(path); databases.push(db);
  db.pragma("journal_mode = WAL"); migrate(db);
  db.exec(`insert into users(id, username, display_name) values (1, 'host', 'Host'), (2, 'bot', 'Bot');
    insert into players(id, guild_id, user_id, discord_user_id, display_name)
      values (1, 'g', 1, '100000000000000001', 'Host'), (2, 'g', 2, 'bot_player_dev_1', 'Bot');
    insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (1,'A','Normal Monster','normal','i','i','[]','t'), (2,'B','Normal Monster','normal','i','i','[]','t'),
        (3,'C','Normal Monster','normal','i','i','[]','t'), (4,'D','Normal Monster','normal','i','i','[]','t');`);
  const drafts = createDraftService(db);
  const draft = drafts.create("g", null, "Bot race", {
    customCardIds: [1, 2, 3, 4], packSize: 2, packsPerPlayer: 1, cardsPerPlayer: 2,
  }, 1, createPlayerService(db).findOrCreate("g", 1, "Host").id);
  drafts.join(draft.id, 2); drafts.start(draft.id);
  const card = drafts.pickOptions(draft.id, 1)[0];
  const otherDb = new Database(path); databases.push(otherDb);
  otherDb.pragma("foreign_keys = ON");
  const otherDrafts = createDraftService(otherDb);
  const rankPickOptions = drafts.rankPickOptions;
  let terminalCommitted = false;
  vi.spyOn(drafts, "rankPickOptions").mockImplementation((draftId, playerId) => {
    const options = rankPickOptions(draftId, playerId);
    if (playerId === 2 && options.length > 0 && !terminalCommitted) {
      // Force the race between the bot's option snapshot and its actual write transaction.
      otherDrafts.cancel(draftId);
      terminalCommitted = true;
    }
    return options;
  });
  vi.mocked(createDraftService).mockReturnValueOnce(drafts);
  const errors: unknown[] = [];
  recording.report.mockImplementation(error => { errors.push(error); });
  const { POST } = await import("../app/api/drafts/[slug]/pick/route");
  const response = await POST(new NextRequest(`http://localhost/api/drafts/${draft.webSlug}/pick`, {
    method: "POST", body: JSON.stringify({ cardId: card.id }),
  }), { params: Promise.resolve({ slug: draft.webSlug! }) });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "cancelled" });
  expect(terminalCommitted).toBe(true);
  expect(errors).toEqual([]);
  expect(drafts.findById(draft.id).pickDeadlineAt).toBeNull();
  expect(drafts.picks(draft.id).map(pick => pick.playerId)).toEqual([]);
  expect(db.pragma("foreign_key_check")).toEqual([]);
});

const recording = useRecordingObservability();

it("returns a safe 400 without reporting malformed pick JSON", async () => {
  const errors: unknown[] = [];
  recording.report.mockImplementation(error => { errors.push(error); });
  db = new Database(":memory:"); databases.push(db);
  migrate(db);
  db.exec("insert into users(id, username, display_name) values (1, 'host', 'Host')");
  const player = createPlayerService(db).findOrCreate("g", 1, "Host");
  const draft = createDraftService(db).create("g", null, "Malformed pick", {}, 1, player.id);
  const { POST } = await import("../app/api/drafts/[slug]/pick/route");
  const response = await POST(new NextRequest(`http://localhost/api/drafts/${draft.webSlug}/pick`, {
    method: "POST", body: '{"cardId":private-input',
  }), { params: Promise.resolve({ slug: draft.webSlug! }) });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid JSON body" });
  expect(errors).toEqual([]);
});

it("returns a generic 500 when the pick route cannot read storage", async () => {
  db = new Database(":memory:");
  db.close();
  const { POST } = await import("../app/api/drafts/[slug]/pick/route");
  const response = await POST(new NextRequest("http://localhost/api/drafts/fixture/pick", {
    method: "POST", body: JSON.stringify({ cardId: 1 }),
  }), { params: Promise.resolve({ slug: "fixture" }) });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Something went wrong" });
});
