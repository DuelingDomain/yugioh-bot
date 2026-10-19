import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/web-access", () => ({ requireWebAccess: async () => ({
  ok: true, userId: "37", userName: "Private Author", userEmail: null,
}) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notify", () => ({ announcer: {}, broadcaster: {} }));

let directory: string;
let database: Database.Database | undefined;
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  database?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function setup() {
  vi.resetModules();
  directory = mkdtempSync(join(tmpdir(), "report-host-integration-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "test.sqlite"));
  vi.stubEnv("DISCORD_GUILD_ID", "integration-guild");
  vi.stubEnv("DUEL_INTERNAL_URL", "http://host.example.test:4003");
  vi.stubEnv("DUEL_INTERNAL_SECRET", "integration-secret");
  vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", "integration-token");
  database = new Database(join(directory, "test.sqlite"));
  migrate(database);
  database.prepare("insert into players(id,guild_id,discord_user_id,display_name) values(1,'integration-guild','37','Private Author')").run();
  database.prepare("insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,format) values('integration-guild','host-duel','Test',1,'normal','active','1v1')").run();
}

it.each(["headers", "body"])("limits stalled host %s to five seconds per attempt and still saves the report", async stalled => {
  await setup();
  const signals: AbortSignal[] = [];
  const issues: unknown[] = [];
  const started = vi.fn();
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("http://host.example.test:")) {
      if (init?.signal) signals.push(init.signal);
      started();
      if (stalled === "body") return { ok: true, status: 200, text: () => new Promise(() => {}) };
      return new Promise(() => {});
    }
    if (String(url).startsWith("https://api.github.com/") && init?.method === "POST") {
      issues.push(JSON.parse(String(init.body)));
      return Response.json({ number: 77, html_url: "https://github.com/DuelingDomain/yugioh-bot/issues/77", labels: [{ name: "from-app" }] }, { status: 201 });
    }
    throw new Error("Unexpected external request");
  });
  const { POST } = await import("../app/api/bug-reports/route");
  vi.useFakeTimers();
  const work = POST(new Request("https://duel.example.test/api/bug-reports", { method: "POST", body: JSON.stringify({
    description: "The card selection stays open after I make a choice", expected: "The selection should close after my choice",
    path: "/duels/host-duel", context: {},
  }) }));
  await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(5000);
  expect(started).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5000);
  expect((await work).status).toBe(200);
  expect(signals).toHaveLength(2);
  expect(signals.every(signal => signal.aborted)).toBe(true);
  expect(issues).toHaveLength(1);
  const row = database!.prepare("select diagnostics_json from bug_reports").get() as { diagnostics_json: string };
  expect(JSON.parse(row.diagnostics_json)).toMatchObject({ attempts: 2, board: null });
});


it.each([
  ["HTTP 400", 400, 1], ["HTTP 401", 401, 1], ["HTTP 403", 403, 1],
  ["HTTP 404", 404, 1], ["HTTP 409", 409, 1], ["HTTP 429", 429, 1],
  ["HTTP 503", 503, 2], ["invalid JSON", 200, 2], ["network error", 0, 1],
])("uses the original host failure for %s retry decisions", async (_label, status, attempts) => {
  await setup();
  const host = vi.fn();
  const issues: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("http://host.example.test:")) {
      host();
      if (status === 0) throw new Error("private connection failure");
      return new Response("private unparseable host body", { status: Number(status) });
    }
    if (String(url).startsWith("https://api.github.com/") && init?.method === "POST") {
      issues.push(JSON.parse(String(init.body)));
      return Response.json({ number: 77, html_url: "https://github.com/DuelingDomain/yugioh-bot/issues/77", labels: [{ name: "from-app" }] }, { status: 201 });
    }
    throw new Error("Unexpected external request");
  });
  const { POST } = await import("../app/api/bug-reports/route");
  const response = await POST(new Request("https://duel.example.test/api/bug-reports", { method: "POST", body: JSON.stringify({
    description: "The card selection stays open after I make a choice", expected: "The selection should close after my choice",
    path: "/duels/host-duel", context: {},
  }) }));
  expect(response.status).toBe(200);
  expect(host).toHaveBeenCalledTimes(Number(attempts));
  expect(issues).toHaveLength(1);
  expect(JSON.stringify(issues)).not.toContain("private");
});
