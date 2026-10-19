// @vitest-environment jsdom
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BugReportDialog } from "../src/components/bug-report/bug-report-dialog";
import { collectBugContext } from "../src/components/bug-report/context";

const { host, identity } = vi.hoisted(() => ({ host: vi.fn(), identity: vi.fn() }));
vi.mock("@/lib/duel-host", () => ({ callDuelHost: host }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: identity }));
vi.mock("@/lib/notify", () => ({ announcer: {}, broadcaster: {} }));

let directory: string;
let database: Database.Database | undefined;
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  database?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function setup() {
  vi.resetModules();
  host.mockReset();
  directory = mkdtempSync(join(tmpdir(), "report-dialog-integration-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "test.sqlite"));
  vi.stubEnv("DISCORD_GUILD_ID", "integration-guild");
  vi.stubEnv("OWNER_USER_IDS", "37");
  vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", "integration-token");
  vi.stubEnv("WEB_URL", "https://duel.example.test");
  database = new Database(join(directory, "test.sqlite"));
  migrate(database);
  database.prepare("insert into players(id,guild_id,discord_user_id,display_name) values(1,'integration-guild','37','private-author')").run();
  database.prepare("insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,format) values('integration-guild','flow-duel','Test',1,'normal','active','1v1')").run();
  identity.mockResolvedValue({ ok: true, userId: "37", userName: "Private Author", userEmail: "private@example.test" });
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
  return { POST, publicIssues, board };
}

it("sends the dialog through the real report routes and keeps board and identity behind owner access", async () => {
  const { publicIssues } = await setup();
  window.history.replaceState({}, "", "/duels/flow-duel");
  render(<BugReportDialog open onClose={() => {}} collect={() => collectBugContext(null)} />);
  expect(screen.getByText("Describe the problem. We save the board and the duel log with your report. A screenshot is optional.")).toBeTruthy();
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: /What went wrong/ }), "The card selection stays open after I make a choice");
  await user.type(screen.getByRole("textbox", { name: /What did you expect/ }), "The selection should close after my choice");
  await user.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(() => expect(screen.getByTestId("bug-report-done")).toBeTruthy());
  const saved = database!.prepare("select * from bug_reports").get() as Record<string, string>;
  expect(saved.duel_slug).toBe("flow-duel");
  expect(JSON.parse(saved.submitter_json!)).toEqual({ userId: "37", username: "private-author", email: "private@example.test" });
  expect(JSON.parse(saved.diagnostics_json!).board.log).toHaveLength(25);
  expect(publicIssues).toHaveLength(1);
  expect(saved.public_id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  expect(publicIssues[0]!.body).toContain(`Report #${saved.public_id}`);
  const publicText = JSON.stringify(publicIssues);
  for (const secret of ["private-author", "Private Author", "private@example.test", "revision", "Public log event 0", "flow-duel", "Reporter seat", "## Replay"]) expect(publicText).not.toContain(secret);
  const { GET } = await import("../app/api/admin/bug-reports/route");
  const ownerList = await (await GET(new Request("https://duel.example.test/api/admin/bug-reports"))).json();
  expect(ownerList.reports[0]).toMatchObject({ submitter: { userId: "37", email: "private@example.test" }, githubIssueNumber: 77, publicId: saved.public_id });
  vi.stubEnv("OWNER_USER_IDS", "");
  expect((await GET(new Request("https://duel.example.test/api/admin/bug-reports"))).status).toBe(403);
});


it("times out the submit and safely retries the same report through the real route", async () => {
  const { POST, publicIssues, board } = await setup();
  let finishCapture!: (value: unknown) => void;
  host.mockImplementation(() => new Promise(resolve => { finishCapture = resolve; }));
  const apiFetch = globalThis.fetch;
  const submissions: Promise<Response>[] = [];
  const signals: AbortSignal[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url !== "/api/bug-reports") return apiFetch(url, init);
    const work = POST(new Request("https://duel.example.test/api/bug-reports", init));
    submissions.push(work);
    const signal = init?.signal;
    if (!signal) return work;
    signals.push(signal);
    return new Promise<Response>((resolve, reject) => {
      const aborted = () => reject(new DOMException("Timed out", "AbortError"));
      signal.addEventListener("abort", aborted, { once: true });
      void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
    });
  });
  window.history.replaceState({}, "", "/duels/flow-duel");
  render(<BugReportDialog open onClose={() => {}} collect={() => collectBugContext(null)} />);
  fireEvent.change(screen.getByRole("textbox", { name: /What went wrong/ }), { target: { value: "The card selection stays open after I make a choice" } });
  fireEvent.change(screen.getByRole("textbox", { name: /What did you expect/ }), { target: { value: "The selection should close after my choice" } });
  vi.useFakeTimers();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send report" })); });
  expect(host).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(34_999); });
  expect(screen.queryByText(/Check your connection/)).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(signals[0]?.aborted).toBe(true);
  expect(screen.getByText(/Check your connection/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send report" })); });
  expect(submissions).toHaveLength(2);
  await act(async () => {
    finishCapture({ ok: true, data: { board, log: ["Last public event"] } });
    await Promise.all(submissions);
  });
  expect(screen.getByTestId("bug-report-done")).toBeTruthy();
  expect(publicIssues).toHaveLength(1);
  expect(database!.prepare("select count(*) as n from bug_reports").get()).toEqual({ n: 1 });
});
