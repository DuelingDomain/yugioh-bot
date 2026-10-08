import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { findDraftReadAccess } from "../../src/services/draft-access.js";

describe("draft visibility access matrix", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:"); migrate(db);
    db.exec(`insert into users(id,username,display_name) values(101,'creator','Creator'),(102,'seated','Seated'),(103,'grant','Grant'),(104,'stranger','Stranger');
      insert into players(id,guild_id,user_id,display_name) values(1,'g',102,'Seated');
      insert into drafts(id,guild_id,name,status,created_by_user_id,web_slug) values(1,'g','Draft','pending',101,'draft');
      insert into draft_players(draft_id,player_id) values(1,1);
      insert into draft_invite_grants(draft_id,user_id) values(1,103);`);
  });
  afterEach(() => db.close());
  for (const visibility of ["open", "private"] as const) {
    for (const status of ["pending", "active"] as const) {
      for (const [role, userId] of [["creator",101],["seated",102],["grant",103],["stranger",104]] as const) {
        it(`${visibility} ${status}: ${role}`, () => {
          db.prepare("update drafts set visibility=?,status=?").run(visibility,status);
          expect(findDraftReadAccess(db,"draft","g",userId)).toMatchObject({
            visibility,
            canRead: role !== "stranger" || (visibility === "open" && status === "pending"),
            canJoin: status === "pending" && role !== "seated" && (visibility === "open" || role === "grant"),
          });
        });
      }
    }
  }
  it("scopes grants to their draft and all access to the configured guild", () => {
    db.exec("insert into drafts(id,guild_id,name,status,created_by_user_id,web_slug) values(2,'g','Other','pending',101,'other')");
    expect(findDraftReadAccess(db,"other","g",103)?.canRead).toBe(false);
    expect(findDraftReadAccess(db,"draft","other",103)).toBeNull();
    expect(findDraftReadAccess(db,"missing","g",101)).toBeNull();
  });
});
