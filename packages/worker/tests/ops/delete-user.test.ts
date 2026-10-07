import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClerkBackendError } from "@yugidraft/shared/clerk";
import { runCli } from "../../src/ops/cli.js";
import { fakeClerk, fixture, remoteUser } from "./fixtures.js";

let f: ReturnType<typeof fixture>;
let reports = 0;
afterEach(() => f?.close());

const EMAIL = "private.person@example.test";
const CLERK_ID = "user_private_clerk_id";

function seed() {
  f = fixture();
  f.user(1, { email: EMAIL, clerk: CLERK_ID, discord: "111", username: "private_person" });
  f.user(2, { email: "other@example.test", clerk: "user_other", discord: "222" });
  f.player(11, 1); f.player(22, 2);
  f.db.exec(`
    insert into matches(id,guild_id,player_one_id,player_two_id,winner_id,reporter_id,status,source)
      values (1,'guild',11,22,11,11,'confirmed','casual');
    insert into saved_decks(guild_id,owner_user_id,name,mode,deck_json) values ('guild',1,'Deck','normal','{}');
    insert into waitlist_signups(email,created_at,source) values ('${EMAIL}','2026-10-01','form');
  `);
}

async function run(args: string[], opts: { backend?: ReturnType<typeof fakeClerk>["backend"]; env?: NodeJS.ProcessEnv } = {}) {
  const report = join(f.dir, `report-${++reports}.json`);
  const out: string[] = []; const err: string[] = [];
  const code = await runCli(["delete-user", ...args, "--report", report], {
    env: { DATABASE_PATH: f.path, ...opts.env }, backend: opts.backend, out: s => out.push(s), err: s => err.push(s),
  });
  return { code, report, out: out.join("\n"), err: err.join("\n"), json: () => JSON.parse(readFileSync(report, "utf8")) as Record<string, unknown> };
}

describe("delete-user command", () => {
  it("is listed in help, including after the command name", async () => {
    const output: string[] = [];
    await runCli(["--help"], { env: {}, out: s => output.push(s), err: () => {} });
    expect(output.join("\n")).toContain("delete-user --user-id");
    const after: string[] = [];
    expect(await runCli(["delete-user", "--help"], { env: {}, out: s => after.push(s), err: () => {} })).toBe(0);
    expect(after.join("\n")).toContain("--skip-clerk");
  });

  it.each([
    [[]],
    [["--user-id"]],
    [["--user-id", "0"]],
    [["--user-id", "-3"]],
    [["--user-id", "1.5"]],
    [["--user-id", "abc"]],
    [["--user-id", "1", "--user-id", "2"]],
    [["--user-id", "1", "--typo"]],
    [["--user-id", "1", "stray"]],
    [["--user-id", "1", "--check-remote"]],
  ])("rejects bad arguments %j", async args => {
    seed();
    const result = await run(args as string[]);
    expect(result.code).toBe(1);
    expect(f.db.prepare("select count(*) n from users").get()).toEqual({ n: 2 });
  });

  it("dry-runs by default: previews the mode, writes nothing and calls nothing", async () => {
    seed(); const fake = fakeClerk(); fake.users.push(remoteUser(CLERK_ID, "1", EMAIL)); const before = f.checksum();
    const result = await run(["--user-id", "1"], { backend: fake.backend });
    expect(result.code).toBe(0);
    expect(f.checksum()).toBe(before);
    expect(fake.calls).toEqual([]);
    expect(result.json()).toMatchObject({ status: "dry-run", userId: 1, mode: "anonymised", clerk: "would_delete" });
  });

  it("with --apply deletes the Clerk user first, then anonymises the rows", async () => {
    seed(); const fake = fakeClerk(); fake.users.push(remoteUser(CLERK_ID, "1", EMAIL));
    const original = fake.backend.deleteUser;
    fake.backend.deleteUser = async id => {
      expect(f.db.prepare("select email, clerk_user_id from users where id=1").get()).toEqual({ email: EMAIL, clerk_user_id: CLERK_ID });
      return original(id);
    };
    const result = await run(["--user-id", "1", "--apply"], { backend: fake.backend, env: { CLERK_SECRET_KEY: "sk_test_private" } });
    expect(result.code).toBe(0);
    expect(fake.calls.filter(c => c.method === "deleteUser")).toEqual([{ method: "deleteUser", input: CLERK_ID }]);
    expect(f.db.prepare("select * from users where id=1").get()).toMatchObject({ clerk_user_id: null, email: null, discord_user_id: null, username: "deleted-1", display_name: "Deleted player" });
    expect(f.db.prepare("select display_name from players where id=11").get()).toEqual({ display_name: "Deleted player" });
    expect(f.db.prepare("select player_one_id, winner_id from matches").get()).toEqual({ player_one_id: 11, winner_id: 11 });
    expect(f.db.prepare("select count(*) n from saved_decks").get()).toEqual({ n: 0 });
    expect(f.db.prepare("select count(*) n from waitlist_signups").get()).toEqual({ n: 0 });
    expect(result.json()).toMatchObject({ status: "applied", userId: 1, mode: "anonymised", clerk: "deleted" });
  });

  it("leaves the database untouched when Clerk fails, and says so in the report", async () => {
    seed(); const fake = fakeClerk(); fake.failures.deleteUser = new ClerkBackendError("Clerk is down", 503, null, null);
    const result = await run(["--user-id", "1", "--apply"], { backend: fake.backend });
    expect(result.code).toBe(1);
    expect(f.db.prepare("select email, clerk_user_id from users where id=1").get()).toEqual({ email: EMAIL, clerk_user_id: CLERK_ID });
    expect(f.db.prepare("select count(*) n from saved_decks").get()).toEqual({ n: 1 });
    expect(result.json()).toMatchObject({ status: "failed", clerk: "failed" });
  });

  it("can finish a half-done deletion: Clerk already gone, rows still there", async () => {
    seed(); const fake = fakeClerk(); // the fake treats an unknown Clerk ID like Clerk's 404
    const result = await run(["--user-id", "1", "--apply"], { backend: fake.backend });
    expect(result.code).toBe(0);
    expect(f.db.prepare("select username from users where id=1").get()).toEqual({ username: "deleted-1" });
  });

  it("requires the Clerk secret only when the row still has a Clerk user", async () => {
    seed();
    const missing = await run(["--user-id", "1", "--apply"]);
    expect(missing.code).toBe(1);
    expect(f.db.prepare("select clerk_user_id from users where id=1").get()).toEqual({ clerk_user_id: CLERK_ID });
    f.db.exec("update users set clerk_user_id=null where id=1");
    const ok = await run(["--user-id", "1", "--apply"]);
    expect(ok.code).toBe(0);
    expect(ok.json()).toMatchObject({ clerk: "none" });
  });

  it("--skip-clerk never calls Clerk", async () => {
    seed(); const fake = fakeClerk();
    const result = await run(["--user-id", "1", "--apply", "--skip-clerk"], { backend: fake.backend });
    expect(result.code).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(result.json()).toMatchObject({ clerk: "skipped" });
    expect(f.db.prepare("select username from users where id=1").get()).toEqual({ username: "deleted-1" });
  });

  it("removes a user with no history and says so", async () => {
    f = fixture(); f.user(5, { email: "solo@example.test", clerk: "user_solo" }); f.player(55, 5);
    const fake = fakeClerk();
    const result = await run(["--user-id", "5", "--apply"], { backend: fake.backend });
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({ status: "applied", mode: "removed" });
    expect(f.db.prepare("select count(*) n from users").get()).toEqual({ n: 0 });
  });

  it("is idempotent: a second run changes nothing and makes no Clerk call", async () => {
    seed(); const fake = fakeClerk();
    await run(["--user-id", "1", "--apply"], { backend: fake.backend });
    const callsAfterFirst = fake.calls.length;
    f.db.pragma("wal_checkpoint(TRUNCATE)");
    const second = await run(["--user-id", "1", "--apply"], { backend: fake.backend });
    expect(second.code).toBe(0);
    expect(fake.calls.length).toBe(callsAfterFirst);
    expect(second.json()).toMatchObject({ status: "noop", mode: "anonymised", clerk: "none" });
  });

  it("reports an unknown user ID as not found, not as a deletion", async () => {
    seed();
    const result = await run(["--user-id", "99", "--apply"], { backend: fakeClerk().backend });
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({ status: "not_found", userId: 99 });
    expect(result.out).toMatch(/no user/i);
    expect(f.db.prepare("select count(*) n from users").get()).toEqual({ n: 2 });
  });

  it("writes a private report with no email, Clerk ID, Discord ID or secret", async () => {
    seed(); const fake = fakeClerk(); fake.users.push(remoteUser(CLERK_ID, "1", EMAIL));
    for (const args of [["--user-id", "1"], ["--user-id", "1", "--apply"]]) {
      const result = await run(args, { backend: fake.backend, env: { CLERK_SECRET_KEY: "sk_test_private" } });
      const text = readFileSync(result.report, "utf8") + result.out + result.err;
      expect(statSync(result.report).mode & 0o777).toBe(0o600);
      for (const secret of [EMAIL, "private.person", CLERK_ID, "111", "sk_test_private", "private_person"]) expect(text).not.toContain(secret);
    }
  });
});
