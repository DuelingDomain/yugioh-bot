import { afterEach, expect, it, vi } from "vitest";
import { ClerkBackendError } from "@yugidraft/shared/clerk";
import { precreateUsers } from "../../src/ops/clerk-precreate-users.js";
import { fakeClerk, fixture, remoteUser } from "./fixtures.js";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.close());
function setup() { f = fixture(); f.user(1, { email: "one@example.test", discord: "111" }); return fakeClerk(); }
it("defaults to offline dry-run with no DB or remote writes", async () => {
  const fake = setup(); const before = f.checksum();
  await precreateUsers({ db: f.db, apply: false, backend: fake.backend });
  expect(f.checksum()).toBe(before); expect(fake.calls).toEqual([]);
});
it("resumes by external ID only when the email matches", async () => {
  const fake = setup(); fake.users.push(remoteUser("existing", "1", "one@example.test"));
  await precreateUsers({ db: f.db, apply: true, backend: fake.backend });
  expect(f.db.prepare("select clerk_user_id,username from users").get()).toEqual({ clerk_user_id: "existing", username: "remote_user" });
  expect(fake.calls).toEqual([{ method: "listUsers", input: { externalId: "1" } }]);
});
it.each(["email", "external"])("reports %s conflict without binding or creating", async kind => {
  const fake = setup(); fake.users.push(remoteUser("existing", kind === "external" ? "1" : "other", kind === "email" ? "one@example.test" : "wrong@example.test"));
  const report = await precreateUsers({ db: f.db, apply: true, backend: fake.backend });
  expect(report.counts.conflict).toBe(1);
  expect(f.db.prepare("select clerk_user_id from users").get()).toEqual({ clerk_user_id: null });
  expect(fake.users).toHaveLength(1);
});
it("skips every local duplicate including an already bound account", async () => {
  const fake = setup(); f.user(2, { email: "one@example.test", clerk: "bound" });
  const report = await precreateUsers({ db: f.db, apply: true, backend: fake.backend });
  expect(report.counts.duplicate_email).toBe(1); expect(fake.calls).toEqual([]);
});
it("sanitizes and deduplicates usernames locally and remotely; legal bypass is opt-in", async () => {
  const fake = setup(); f.db.exec("update users set username='A!BC' where id=1"); f.user(2, { username: "abc_" });
  fake.users.push(remoteUser("taken", "other", "other@example.test", "abc__1"));
  await precreateUsers({ db: f.db, apply: true, backend: fake.backend });
  const created = fake.calls.find(c => c.method === "createUser")!;
  expect(created.input).toEqual({ emailAddress: "one@example.test", externalId: "1", username: "abc__2", skipPasswordRequirement: true });
  expect(f.db.prepare("select username from users where id=1").get()).toEqual({ username: "abc__2" });
});
it("waits for 429 and retries at most three times", async () => {
  const fake = setup(); const original = fake.backend.listUsers;
  fake.backend.listUsers = vi.fn().mockRejectedValueOnce(new ClerkBackendError("limit", 429, null, 12)).mockImplementation(original);
  const sleep = vi.fn(async () => {});
  await precreateUsers({ db: f.db, apply: true, backend: fake.backend, sleep });
  expect(sleep).toHaveBeenCalledWith(12); expect(fake.users).toHaveLength(1);
  f.user(3, { email: "three@example.test", discord: "333" });
  fake.backend.listUsers = vi.fn(async () => { throw new ClerkBackendError("limit", 429, null, null); });
  const report = await precreateUsers({ db: f.db, apply: true, backend: fake.backend, sleep });
  expect(report.counts.error).toBe(1); expect(fake.backend.listUsers).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls.slice(-2)).toEqual([[2000], [2000]]);
});
it("persists each success before a later crash; rerun creates only the remaining user", async () => {
  const fake = setup(); f.user(2, { email: "two@example.test", discord: "222" }); f.user(3, { email: "three@example.test", discord: "333" });
  const original = fake.backend.createUser;
  fake.backend.createUser = async input => {
    if (input.externalId === "3") {
      expect(f.db.prepare("select count(*) n from users where clerk_user_id is not null").get()).toEqual({ n: 2 });
      throw new Error("simulated crash with private@example.test sk_test_secret");
    }
    return original(input);
  };
  const failed = await precreateUsers({ db: f.db, apply: true, backend: fake.backend });
  expect(failed.counts.error).toBe(1); expect(JSON.stringify(failed)).not.toMatch(/@|sk_test_secret/);
  fake.calls.length = 0; fake.backend.createUser = original;
  await precreateUsers({ db: f.db, apply: true, backend: fake.backend, skipLegalChecks: true });
  expect(fake.calls.filter(c => c.method === "createUser").map(c => c.input)).toEqual([{ emailAddress: "three@example.test", externalId: "3", username: "duelist_3", skipPasswordRequirement: true, skipLegalChecks: true }]);
});
it("refuses a resumed username that collides with another local user", async () => {
  const fake = setup(); f.user(2, { username: "remote_user" });
  fake.users.push(remoteUser("existing", "1", "one@example.test"));
  const report = await precreateUsers({ db: f.db, apply: true, backend: fake.backend });
  expect(report.counts.conflict).toBe(1);
  expect(f.db.prepare("select clerk_user_id from users where id=1").get()).toEqual({ clerk_user_id: null });
});
it("resumes a remote creation whose local persistence was interrupted", async () => {
  const fake = setup();
  f.db.exec("create trigger interrupt_binding before update of clerk_user_id on users begin select raise(abort,'interrupted'); end");
  expect((await precreateUsers({ db: f.db, apply: true, backend: fake.backend })).counts.error).toBe(1);
  expect(fake.users).toHaveLength(1);
  expect(f.db.prepare("select clerk_user_id from users").get()).toEqual({ clerk_user_id: null });
  f.db.exec("drop trigger interrupt_binding"); fake.calls.length = 0;
  expect((await precreateUsers({ db: f.db, apply: true, backend: fake.backend })).counts.resumed).toBe(1);
  expect(fake.users).toHaveLength(1);
  expect(fake.calls).toEqual([{ method: "listUsers", input: { externalId: "1" } }]);
  expect(f.db.prepare("select clerk_user_id from users").get()).toEqual({ clerk_user_id: "clerk_1" });
});
it("reports and skips both eligible users sharing an email", async () => {
  const fake = setup(); f.user(2, { email: "one@example.test", discord: "222" });
  const report = await precreateUsers({ db: f.db, apply: true, backend: fake.backend });
  expect(report.outcomes).toEqual([{ userId: 1, outcome: "duplicate_email" }, { userId: 2, outcome: "duplicate_email" }]);
  expect(fake.calls).toEqual([]);
});
it("remote dry-run can identify a resumable account without binding it", async () => {
  const fake = setup(); fake.users.push(remoteUser("existing", "1", "one@example.test"));
  const before = f.checksum();
  expect((await precreateUsers({ db: f.db, apply: false, checkRemote: true, backend: fake.backend })).counts.would_resume).toBe(1);
  expect(f.checksum()).toBe(before);
  expect(fake.calls).toEqual([{ method: "listUsers", input: { externalId: "1" } }]);
});
