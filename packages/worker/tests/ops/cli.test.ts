import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../../src/ops/cli.js";
import { writeReport, defaultReportPath } from "../../src/ops/report.js";
import { fixture, fakeClerk } from "./fixtures.js";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.close());
it("lists commands in help without requiring env and rejects unknown commands/flags", async () => {
  const output: string[] = []; const opts = { env: {}, out: (s: string) => output.push(s), err: (s: string) => output.push(s) };
  expect(await runCli(["--help"], opts)).toBe(0);
  for (const command of ["season", "merge-users", "clerk-precreate-users", "clerk-reconcile-waitlist"]) expect(output.join("\n")).toContain(command);
  expect(await runCli(["unknown"], opts)).toBe(1);
  expect(await runCli(["season", "status", "--typo"], opts)).toBe(1);
});
it("parses flags, validates IDs, and writes private reports without identities' emails or secret errors", async () => {
  f = fixture(); f.user(1, { email: "private@example.test" });
  const report = join(f.dir, "report.json");
  const opts = { env: { DATABASE_PATH: f.path, DISCORD_GUILD_ID: "guild", CLERK_SECRET_KEY: "sk_test_private" }, out: () => {}, err: () => {} };
  expect(await runCli(["season", "start", "--actor", "1", "--name", "Autumn", "--apply", "--report", report], opts)).toBe(0);
  expect(f.db.prepare("select name from seasons").get()).toEqual({ name: "Autumn" });
  expect(statSync(report).mode & 0o777).toBe(0o600);
  expect(readFileSync(report, "utf8")).not.toMatch(/@|sk_test_private/);
  expect(await runCli(["merge-users", "--source", "0", "--target", "2"], opts)).toBe(1);
});
it("CLI dry-run opens existing DB without migration writes or Clerk calls", async () => {
  f = fixture(); f.user(1, { email: "one@example.test", discord: "111" }); const fake = fakeClerk(); const before = f.checksum();
  expect(await runCli(["clerk-precreate-users", "--report", join(f.dir, "report.json")], { env: { DATABASE_PATH: f.path }, backend: fake.backend, out: () => {}, err: () => {} })).toBe(0);
  expect(f.checksum()).toBe(before); expect(fake.calls).toEqual([]);
});
it("writes failure reports for merge collisions with conflicting row IDs", async () => {
  f = fixture(); f.user(1); f.user(2); f.player(11, 1); f.player(22, 2);
  f.db.exec("insert into player_ratings(guild_id,player_id) values('guild',11),('guild',22)");
  const report = join(f.dir, "conflict.json");
  expect(await runCli(["merge-users", "--source", "1", "--target", "2", "--apply", "--report", report], { env: { DATABASE_PATH: f.path }, out: () => {}, err: () => {} })).toBe(1);
  expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({ conflicts: [expect.objectContaining({ table: "player_ratings", rowIds: [1, 2] })] });
});
it("uses the local DB directory for default reports and refuses to overwrite a report", () => {
  f = fixture();
  expect(defaultReportPath("season", f.path, new Date("2026-10-06T12:00:00Z"), false)).toBe(join(f.dir, "ops-reports", "season-2026-10-06T12-00-00-000Z.json"));
  const path = join(f.dir, "report.json"); writeFileSync(path, "existing");
  expect(() => writeReport(path, { status: "ok" })).toThrow();
  expect(readFileSync(path, "utf8")).toBe("existing");
});
it("supports help after a command without env or database access", async () => {
  const output: string[] = [];
  expect(await runCli(["merge-users", "--help"], { env: {}, out: s => output.push(s), err: () => {} })).toBe(0);
  expect(output.join("\n")).toContain("--source");
});
it("prints identity and affected-row details even when dry-run finds a merge conflict", async () => {
  f = fixture(); f.user(1, { clerk: "source" }); f.user(2, { clerk: "target" });
  const output: string[] = [];
  expect(await runCli(["merge-users", "--source", "1", "--target", "2", "--report", join(f.dir, "report.json")], { env: { DATABASE_PATH: f.path }, out: s => output.push(s), err: () => {} })).toBe(1);
  expect(output.join("\n")).toContain('"sourceHistory"');
  expect(output.join("\n")).toContain('"hasClerk": true');
});
