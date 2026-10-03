import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createDraftAccessReader } from "../../src/services/draft-access.js";

describe("the ws draft access reader", () => {
  let dir: string;
  let db: Database.Database;
  let reader: ReturnType<typeof createDraftAccessReader>;
  const claims = { slug: "draft", guildId: "guild", userId: "outsider" };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "draft-room-access-"));
    db = new Database(join(dir, "drafts.sqlite"));
    migrate(db);
    db.prepare("insert into drafts (guild_id, channel_id, name, status, created_by_user_id, web_slug) values ('guild', 'channel', 'Draft', 'pending', 'creator', 'draft')").run();
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
    expect(reader.canReadDraft({ ...claims, userId: "creator" })).toBe(true);
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
