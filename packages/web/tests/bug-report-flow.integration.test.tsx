// @vitest-environment jsdom
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BugReportDialog } from "../src/components/bug-report/bug-report-dialog";
import { collectBugContext } from "../src/components/bug-report/context";

const { host, identity } = vi.hoisted(() => ({ host: vi.fn(), identity: vi.fn() }));
vi.mock("@/lib/duel-host", () => ({ callDuelHost: host }));
vi.mock("@/lib/session-identity", () => ({ resolveSessionIdentity: identity }));
vi.mock("@/lib/notify", () => ({ announcer: {}, broadcaster: {} }));

let directory: string;
let database: Database.Database | undefined;
afterEach(() => {
  cleanup();
  database?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it("sends the dialog through the real report routes and keeps board and identity behind owner access", async () => {
  directory = mkdtempSync(join(tmpdir(), "report-dialog-integration-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "test.sqlite"));
  vi.stubEnv("DISCORD_GUILD_ID", "integration-guild");
  vi.stubEnv("OWNER_USER_IDS", "37");
  vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", "integration-token");
  vi.stubEnv("WEB_URL", "https://duel.example.test");
  database = new Database(join(directory, "test.sqlite"));
  migrate(database);
  database.prepare("insert into users(id,username,display_name,email) values(37,'private-author','Private Author','private@example.test')").run();
  database.prepare("insert into players(id,guild_id,user_id,display_name) values(1,'integration-guild',37,'Private Author')").run();
  database.prepare("insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,format) values('integration-guild','flow-duel','Test',1,'normal','active','1v1')").run();
  identity.mockResolvedValue({ ok: true, identity: { userId: 37, name: "Private Author", email: "private@example.test", discordUserId: null } });
  const board = { revision: 91, seats: [], log: Array.from({ length: 25 }, (_, id) => ({ id, text: `Public log event ${id}` })) };
  host.mockResolvedValue({ ok: true, data: { turn: 3, phase: "main1", turnSeat: 0, livingPlayers: 2, board, log: board.log.slice(-15).map(entry => entry.text) } });
  const { POST } = await import("../app/api/bug-reports/route");
  const { POST: precheck } = await import("../app/api/bug-reports/precheck/route");
  const publicIssues: Array<{ title: string; body: string }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/bug-reports") return POST(new Request("https://duel.example.test/api/bug-reports", init));
    if (url === "/api/bug-reports/precheck") return precheck(new Request("https://duel.example.test/api/bug-reports/precheck", init));
    if (String(url).startsWith("https://api.github.com/") && init?.method === "POST") {
      publicIssues.push(JSON.parse(String(init.body)));
      return Response.json({ number: 77, html_url: "https://github.com/DuelingDomain/yugioh-bot/issues/77", labels: [{ name: "from-app" }] }, { status: 201 });
    }
    if (String(url).startsWith("https://api.github.com/")) return Response.json([]);
    throw new Error("Unexpected external request");
  });
  window.history.replaceState({}, "", "/duels/flow-duel");
  render(<BugReportDialog open onClose={() => {}} collect={() => collectBugContext(null)} />);
  expect(screen.getByText("Describe the problem. We save the board and the duel log with your report. A screenshot is optional.")).toBeTruthy();
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: /What went wrong/ }), "The card selection stays open after I make a choice");
  await user.type(screen.getByRole("textbox", { name: /What did you expect/ }), "The selection should close after my choice");
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(() => expect(screen.getByTestId("bug-report-done")).toBeTruthy());
  const saved = database.prepare("select * from bug_reports").get() as Record<string, string>;
  expect(saved.duel_slug).toBe("flow-duel");
  expect(JSON.parse(saved.submitter_json!)).toEqual({ userId: 37, username: "private-author", email: "private@example.test" });
  expect(JSON.parse(saved.diagnostics_json!).board.log).toHaveLength(25);
  expect(publicIssues).toHaveLength(1);
  expect(publicIssues[0]!.body).toContain("Report #1");
  const publicText = JSON.stringify(publicIssues);
  for (const secret of ["private-author", "Private Author", "private@example.test", "revision", "Public log event 0"]) expect(publicText).not.toContain(secret);
  const { GET } = await import("../app/api/admin/bug-reports/route");
  const ownerList = await (await GET(new Request("https://duel.example.test/api/admin/bug-reports"))).json();
  expect(ownerList.reports[0]).toMatchObject({ submitter: { userId: 37, email: "private@example.test" }, githubIssueNumber: 77 });
  vi.stubEnv("OWNER_USER_IDS", "");
  expect((await GET(new Request("https://duel.example.test/api/admin/bug-reports"))).status).toBe(403);
});
