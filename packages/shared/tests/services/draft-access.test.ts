import { seedUser } from "../helpers/identity.js";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createDraftAccessReader, resolveDraftDatabasePath } from "../../src/services/draft-access.js";

describe("draft access database paths", () => {
  let dir: string;
  let workspaceRoot: string;
  let wsDirectory: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "draft-access-path-"));
    workspaceRoot = join(dir, "repo");
    wsDirectory = join(workspaceRoot, "packages", "ws");
    mkdirSync(wsDirectory, { recursive: true });
    writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    writeFileSync(join(wsDirectory, "package.json"), JSON.stringify({ name: "ws" }));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("resolves the default database from the ws directory against the workspace root", () => {
    expect(resolveDraftDatabasePath(undefined, wsDirectory)).toBe(join(workspaceRoot, "data", "bot.sqlite"));
  });

  it("resolves a relative database path against the workspace root", () => {
    expect(resolveDraftDatabasePath("./data/custom.sqlite", wsDirectory)).toBe(join(workspaceRoot, "data", "custom.sqlite"));
  });

  it("preserves the absolute production database path", () => {
    expect(resolveDraftDatabasePath("/app/data/bot.sqlite", wsDirectory)).toBe("/app/data/bot.sqlite");
  });

  it("falls back to the current directory when no workspace root exists", () => {
    rmSync(join(workspaceRoot, "package.json"));
    expect(resolveDraftDatabasePath(undefined, wsDirectory)).toBe(join(wsDirectory, "data", "bot.sqlite"));
  });
});

describe("the ws draft access reader", () => {
  let dir: string;
  let db: Database.Database;
  let reader: ReturnType<typeof createDraftAccessReader>;
  let claims: { slug: string; guildId: string; userId: number };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "draft-room-access-"));
    db = new Database(join(dir, "drafts.sqlite"));
    migrate(db);
    db.prepare("insert into drafts (guild_id, channel_id, name, status, created_by_user_id, web_slug) values ('guild', 'channel', 'Draft', 'pending', ?, 'draft')").run(seedUser(db, "creator").userId);
    claims = { slug: "draft", guildId: "guild", userId: seedUser(db, "outsider").userId };
    reader = createDraftAccessReader(join(dir, "drafts.sqlite"));
  });

  afterEach(() => {
    reader?.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses current database permissions rather than caching lobby access", () => {
    expect(reader.canReadDraft(claims)).toBe(true);
    db.prepare("update drafts set status = 'active'").run();
    expect(reader.canReadDraft(claims)).toBe(false);
    expect(reader.canReadDraft({ ...claims, userId: seedUser(db, "creator").userId })).toBe(true);
  });

  it("does not expose a draft in another guild", () => {
    expect(reader.canReadDraft({ ...claims, guildId: "other-guild" })).toBe(false);
  });

  it("does not create or migrate a database when the mounted file is missing", () => {
    reader.close();
    const missing = join(dir, "missing.sqlite");
    reader = createDraftAccessReader(missing);
    expect(() => reader.canReadDraft(claims)).toThrow();
    expect(existsSync(missing)).toBe(false);
  });
});
