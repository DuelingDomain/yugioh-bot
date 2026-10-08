import Database from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createDraftService } from "../../src/services/drafts.js";
import * as services from "../../src/services/index.js";
import { seedIdentity } from "../helpers/identity.js";

describe("shared draft privacy", () => {
  let db: Database.Database;
  let host: ReturnType<typeof seedIdentity>;
  beforeEach(() => { db = new Database(":memory:"); migrate(db); host = seedIdentity(db); });
  afterEach(() => db.close());
  it("defaults shared and bot creation to private and maps explicitly open drafts", () => {
    const drafts = createDraftService(db);
    const first = drafts.create("g",null,"Private",{},host.userId,host.playerId);
    expect(first.visibility).toBe("private");
    const second = drafts.create("g",null,"Open",{},host.userId,host.playerId,"open");
    expect(second.visibility).toBe("open");
    expect(drafts.findById(second.id).visibility).toBe("open");
    expect(second).not.toHaveProperty("inviteCode");
  });
  it("checks invite ownership and reset comparison in the shared service", () => {
    const draft = createDraftService(db).create("g",null,"Private",{},host.userId,host.playerId);
    const guest = seedIdentity(db, { name: "Guest" });
    const privacy = services.createDraftVisibilityService(db);
    expect(() => privacy.invite(draft.webSlug!,"g",guest.userId)).toThrow("Draft not found");
    const old = privacy.invite(draft.webSlug!,"g",host.userId);
    expect(() => privacy.admit(draft.webSlug!,"g",guest.userId,"wrong")).toThrow("Draft not found");
    privacy.admit(draft.webSlug!,"g",guest.userId,old);
    const current = privacy.resetInvite(draft.webSlug!,"g",host.userId);
    expect(current).not.toBe(old);
    expect(() => privacy.admit(draft.webSlug!,"g",guest.userId,old)).toThrow("Draft not found");
    privacy.admit(draft.webSlug!,"g",guest.userId,current);
    expect(db.prepare("select user_id from draft_invite_grants").all()).toEqual([{ user_id: guest.userId }]);
  });
  it("invalidates a pending countdown on a visibility change while retaining seat readiness and grants", () => {
    const draft = createDraftService(db).create("g",null,"Private",{},host.userId,host.playerId);
    db.exec(`update drafts set lobby_start_token='old',lobby_start_at='2099-01-01' where id=${draft.id};
      update draft_players set ready_at='2026-10-01',ready_setup_hash='ready';
      insert into draft_invite_grants(draft_id,user_id) values(${draft.id},${host.userId})`);
    const privacy = services.createDraftVisibilityService(db);
    expect(() => privacy.setVisibility(draft.webSlug!,"g",999,"open")).toThrow("Draft not found");
    privacy.setVisibility(draft.webSlug!,"g",host.userId,"open");
    expect(db.prepare("select visibility,lobby_revision,lobby_start_token,lobby_start_at from drafts").get()).toEqual({ visibility: "open", lobby_revision: 1, lobby_start_token: null, lobby_start_at: null });
    expect(db.prepare("select ready_at from draft_players").get()).toEqual({ ready_at: "2026-10-01" });
    expect(db.prepare("select count(*) as n from draft_invite_grants").get()).toEqual({ n: 1 });
    privacy.setVisibility(draft.webSlug!,"g",host.userId,"open");
    expect(db.prepare("select lobby_revision from drafts").get()).toEqual({ lobby_revision: 1 });
    db.exec("update drafts set status='active'");
    expect(() => privacy.setVisibility(draft.webSlug!,"g",host.userId,"private")).toThrow("Draft must be pending");
  });
});
