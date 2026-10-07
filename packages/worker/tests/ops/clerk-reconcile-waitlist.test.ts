import { afterEach, expect, it } from "vitest";
import { reconcileWaitlist } from "../../src/ops/clerk-reconcile-waitlist.js";
import { fakeClerk, fixture, remoteUser } from "./fixtures.js";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.close());
function setup() { f = fixture(); f.db.exec("insert into waitlist_signups(email,created_at,source) values('one@example.test','now','web')"); return fakeClerk(); }
it("plain dry-run stays offline and check-remote only reads", async () => {
  const fake = setup(); const before = f.checksum();
  await reconcileWaitlist({ db: f.db, apply: false, backend: fake.backend });
  expect(fake.calls).toEqual([]);
  await reconcileWaitlist({ db: f.db, apply: false, checkRemote: true, backend: fake.backend });
  expect(fake.calls.map(c => c.method)).toEqual(["listUsers", "listWaitlistEntries"]);
  expect(f.checksum()).toBe(before);
});
it("skips an existing Clerk user", async () => {
  const fake = setup(); fake.users.push(remoteUser("user", "1", "one@example.test"));
  expect((await reconcileWaitlist({ db: f.db, apply: true, backend: fake.backend })).counts.existing_user).toBe(1);
  expect(fake.entries).toEqual([]);
});
it.each(["revoked", "rejected", "pending", "invited"])("never re-invites a %s entry", async status => {
  const fake = setup(); fake.entries.push({ id: "entry", email_address: "one@example.test", status });
  const report = await reconcileWaitlist({ db: f.db, apply: true, backend: fake.backend });
  expect(report.counts[status === "revoked" || status === "rejected" ? "blocked" : "existing_entry"]).toBe(1);
  expect(fake.calls.some(c => c.method === "createWaitlistEntry")).toBe(false);
});
it("creates missing entries and honors notification preference", async () => {
  const fake = setup();
  await reconcileWaitlist({ db: f.db, apply: true, backend: fake.backend, notify: false });
  expect(fake.calls.at(-1)).toEqual({ method: "createWaitlistEntry", input: { emailAddress: "one@example.test", notify: false } });
});
it("checks all pages, ignores fuzzy email matches, and honors a revoked exact match", async () => {
  const fake = setup();
  const offsets: number[] = [];
  fake.backend.listWaitlistEntries = async query => {
    offsets.push(query.offset!);
    return query.offset === 0
      ? { data: [{ id: "fuzzy", email_address: "someone@example.test", status: "pending" }], totalCount: 2 }
      : { data: [{ id: "blocked", email_address: "one@example.test", status: "revoked" }], totalCount: 2 };
  };
  expect((await reconcileWaitlist({ db: f.db, apply: true, backend: fake.backend })).counts.blocked).toBe(1);
  expect(offsets).toEqual([0, 1]); expect(fake.entries).toEqual([]);
});
it("notifies by default and redacts remote failures", async () => {
  const fake = setup();
  await reconcileWaitlist({ db: f.db, apply: true, backend: fake.backend });
  expect(fake.calls.at(-1)).toEqual({ method: "createWaitlistEntry", input: { emailAddress: "one@example.test", notify: true } });
  fake.backend.listUsers = async () => { throw new Error("one@example.test sk_test_secret"); };
  const report = await reconcileWaitlist({ db: f.db, apply: true, backend: fake.backend });
  expect(report.counts.error).toBe(1); expect(report.status).toBe("failed");
  expect(JSON.stringify(report)).not.toMatch(/@|sk_test_secret/);
});
