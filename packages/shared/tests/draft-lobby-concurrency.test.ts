import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./helpers/lobby-identity.js";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { createDraftService } from "../src/services/drafts.js";
import { createDraftLobbyService } from "../src/services/draft-lobby.js";

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach((fn) => fn()); });
const now = new Date("2026-10-07T12:00:00Z");
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "draft-lobby-"));
  cleanup.push(() => rmSync(directory, { recursive: true }));
  const a = new Database(join(directory, "db.sqlite"));
  cleanup.push(() => a.close());
  a.pragma("journal_mode = WAL");
  a.pragma("foreign_keys = ON");
  migrate(a);
  seedFixtureUsers(a, ["host", "guest", "third", "fourth"]);
  const b = new Database(join(directory, "db.sqlite"));
  cleanup.push(() => b.close());
  b.pragma("foreign_keys = ON");
  const ids = ["host", "guest", "third", "fourth"].map((user) => Number(a.prepare(
    "insert into players (guild_id,user_id,discord_user_id,display_name) values ('g',?,?,?)",
  ).run(fixtureUserId(user), fixtureDiscordId(user), user).lastInsertRowid));
  for (let id = 1; id <= 24; id++) a.prepare(`insert into card_catalog
    (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values (?,?,'Normal Monster','normal','i','i','[]','t')`).run(id, `C${id}`);
  const drafts = createDraftService(a);
  const draft = drafts.create("g", "c", "Concurrent", { packSize: 3, packsPerPlayer: 2,
    cardsPerPlayer: 6, lobbySeats: 3, cubeCardIds: Array.from({ length: 24 }, (_, i) => i + 1) }, fixtureUserId("host"), ids[0]);
  drafts.join(draft.id, ids[1]);
  const lobbyA = createDraftLobbyService(a), lobbyB = createDraftLobbyService(b);
  lobbyA.setReady(draft.id, fixtureUserId("host"), true, now);
  lobbyB.setReady(draft.id, fixtureUserId("guest"), true, now);
  const schedule = () => lobbyA.scheduleStart(draft.id, fixtureUserId("host"), { revision: lobbyA.read(draft.id, fixtureUserId("host"), now).lobby.revision }, now);
  return { a, b, ids, draft, drafts, lobbyA, lobbyB, schedule };
}

it.each(["stop", "tick"])("serializes Stop versus expiry when %s commits first", (first) => {
  const app = setup();
  const token = app.schedule().lobby.start!.token;
  const expiry = new Date(now.getTime() + 5000);
  if (first === "stop") {
    app.lobbyB.stopStart(app.draft.id, fixtureUserId("host"), token, expiry);
    expect(app.lobbyA.tick(expiry).started).toEqual([]);
    expect(app.drafts.findById(app.draft.id).status).toBe("pending");
  } else {
    expect(app.lobbyB.tick(expiry).started).toHaveLength(1);
    expect(() => app.lobbyA.stopStart(app.draft.id, fixtureUserId("host"), token, expiry)).toThrowError(expect.objectContaining({ code: "DRAFT_NOT_PENDING" }));
  }
});

it("serializes last-seat joins across connections without exceeding capacity", () => {
  const app = setup();
  const stale = createDraftService(app.b).findById(app.draft.id);
  expect(stale.status).toBe("pending");
  app.drafts.join(app.draft.id, app.ids[2]);
  expect(() => createDraftService(app.b).join(app.draft.id, app.ids[3])).toThrowError(expect.objectContaining({ code: "LOBBY_FULL" }));
  expect(app.lobbyB.read(app.draft.id, fixtureUserId("host"), now).lobby.joined).toBe(3);
});

it("deals once when two sweepers tick the same expired persisted deadline", () => {
  const app = setup();
  app.schedule();
  const expiry = new Date(now.getTime() + 5000);
  expect(app.lobbyB.tick(expiry).started).toHaveLength(1);
  expect(app.lobbyA.tick(expiry).started).toEqual([]);
  expect(app.a.prepare("select count(*) as n from draft_deal where draft_id = ?").get(app.draft.id)).toEqual({ n: 12 });
  expect(app.a.prepare("select count(*) as n from draft_packs where draft_id = ?").get(app.draft.id)).toEqual({ n: 2 });
});

it("cancels a schedule when a seat joins before another connection ticks expiry", () => {
  const app = setup();
  app.schedule();
  createDraftService(app.b).join(app.draft.id, app.ids[2]);
  expect(app.lobbyA.tick(new Date(now.getTime() + 5000)).started).toEqual([]);
  expect(app.lobbyA.read(app.draft.id, fixtureUserId("host"), now).players.map((p) => p.ready)).toEqual([true, true, false]);
});
