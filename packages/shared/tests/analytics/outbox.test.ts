import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { recordProductEvent } from "../../src/analytics/index.js";

let db: Database.Database;
beforeEach(() => { db = new Database(":memory:"); migrate(db); db.prepare("insert into users(id,username,display_name) values(7,'member_7','Member')").run(); });
afterEach(() => db.close());

it("persists a bounded event through repeat migrations and rolls it back with its change", () => {
  db.transaction(() => {
    db.prepare("insert into waitlist_signups(email,created_at,source) values('member@example.test','2026-10-13','form')").run();
    recordProductEvent(db, "waitlist_joined", null);
  })();
  migrate(db);
  expect(db.prepare("select name,user_id,props_json,sent_at,attempts from product_events").all()).toEqual([
    { name: "waitlist_joined", user_id: null, props_json: "{}", sent_at: null, attempts: 0 },
  ]);
  expect(() => db.transaction(() => {
    db.prepare("delete from waitlist_signups").run();
    recordProductEvent(db, "deck_saved", 7, { mode: "normal" });
    throw new Error("cancelled change");
  })()).toThrow("cancelled change");
  expect(db.prepare("select count(*) as n from waitlist_signups").get()).toEqual({ n: 1 });
  expect(db.prepare("select count(*) as n from product_events").get()).toEqual({ n: 1 });
});

it("stores only allowed property keys even when the caller carries extra data", () => {
  const props = { mode: "normal" as const, email: "member@example.test", title: "Private deck" };
  db.transaction(() => recordProductEvent(db, "deck_saved", 7, props))();
  expect(db.prepare("select user_id,props_json from product_events").get()).toEqual({ user_id: 7, props_json: '{"mode":"normal"}' });
});

// Type contracts are checked by the shared typecheck, without writing test events.
function propertyTypes() {
  // @ts-expect-error Email is not an event property.
  recordProductEvent(db, "deck_saved", 7, { email: "member@example.test" });
  // @ts-expect-error Event-specific properties cannot be mixed.
  recordProductEvent(db, "waitlist_joined", null, { mode: "normal" });
  // @ts-expect-error Mode values cannot contain free text.
  recordProductEvent(db, "deck_saved", 7, { mode: "Private deck" });
}

it("does not enqueue activity for an anonymised or removed account while retaining its deletion job", () => {
  db.transaction(() => {
    db.prepare("update users set username='deleted-7',display_name='Deleted player' where id=7").run();
    recordProductEvent(db, "draft_completed", 7, { mode: "booster", seatCount: 2 });
    db.prepare("delete from users where id=7").run();
    recordProductEvent(db, "duel_finished", 7, { endedBy: "completed" });
    recordProductEvent(db, "$delete_person", 7);
  })();
  expect(db.prepare("select name,user_id from product_events").all()).toEqual([{ name: "$delete_person", user_id: 7 }]);
});
