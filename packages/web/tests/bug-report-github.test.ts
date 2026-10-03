import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCommentBody, buildIssueBody } from "@/lib/bug-report";
import { commentOnIssue, getOpenFromAppIssue, listOpenFromAppIssues, resetGithubIssueCache } from "@/lib/bug-report-github";

const TOKEN = "ghp_secretTOKENvalue123";
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const rawIssue = (number: number, extra: Record<string, unknown> = {}) => ({
  number, html_url: `https://github.com/imran443/yugioh-bot/issues/${number}`, title: `[Bug] [FFA3] Issue ${number}`, state: "open",
  labels: [{ name: "bug" }, { name: "from-app" }], body: "## Description\n\n```\nThe chain froze\n```\n\n## Expected\n\nx", ...extra,
});

beforeEach(() => {
  resetGithubIssueCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.BUG_REPORT_GITHUB_TOKEN = TOKEN;
  delete process.env.BUG_REPORT_GITHUB_REPO;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BUG_REPORT_GITHUB_TOKEN;
});

describe("listOpenFromAppIssues", () => {
  it("asks for open from-app issues and keeps only issues, not pull requests or closed ones", async () => {
    fetchMock.mockResolvedValue(json([rawIssue(1), rawIssue(2, { pull_request: {} }), rawIssue(3, { state: "closed" }), rawIssue(4, { labels: [{ name: "bug" }] }), rawIssue(5)]));
    const result = await listOpenFromAppIssues();
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.github.com/repos/imran443/yugioh-bot/issues?state=open&labels=from-app&per_page=100");
    expect((fetchMock.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.issues.map((i) => i.number)).toEqual([1, 5]);
    expect(result.ok && result.issues[0]!.text).toContain("The chain froze");
  });

  it("shares one GitHub call between callers that arrive during a refresh", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementation(async () => { await gate; return json([rawIssue(1)]); });
    const calls = [listOpenFromAppIssues(), listOpenFromAppIssues(), listOpenFromAppIssues()];
    release();
    const results = await Promise.all(calls);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result.ok && result.issues.map((i) => i.number)).toEqual([1]);
  });

  it("does not cache a failure, and the next call asks again", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "boom" }, 500)).mockResolvedValueOnce(json([rawIssue(2)]));
    expect((await listOpenFromAppIssues()).ok).toBe(false);
    const second = await listOpenFromAppIssues();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.ok && second.issues.map((i) => i.number)).toEqual([2]);
  });

  it("after a reset, a refresh that began before it does not fill the cache with its older list", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementationOnce(async () => { await gate; return json([rawIssue(1)]); }).mockImplementation(async () => json([rawIssue(1), rawIssue(2)]));
    const stale = listOpenFromAppIssues();
    resetGithubIssueCache();
    const fresh = await listOpenFromAppIssues();
    release();
    await stale;
    expect(fresh.ok && fresh.issues.map((i) => i.number)).toEqual([1, 2]);
    const again = await listOpenFromAppIssues();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(again.ok && again.issues.map((i) => i.number)).toEqual([1, 2]);
  });

  it("caches the list for 60 seconds", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(async () => json([rawIssue(1)]));
      await listOpenFromAppIssues();
      await listOpenFromAppIssues();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(61_000);
      await listOpenFromAppIssues();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers not ok without a token, without calling GitHub", async () => {
    delete process.env.BUG_REPORT_GITHUB_TOKEN;
    expect(await listOpenFromAppIssues()).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers not ok on a GitHub error or a network error, and the error has no token", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "Bad credentials" }, 401));
    expect(await listOpenFromAppIssues()).toEqual({ ok: false, error: "GitHub answered 401: Bad credentials" });
    fetchMock.mockRejectedValueOnce(new Error(`socket closed for ${TOKEN}`));
    const result = await listOpenFromAppIssues();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

describe("getOpenFromAppIssue", () => {
  it("accepts an open from-app issue", async () => {
    fetchMock.mockResolvedValue(json(rawIssue(9)));
    expect(await getOpenFromAppIssue(9)).toMatchObject({ ok: true, issue: { number: 9 } });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.github.com/repos/imran443/yugioh-bot/issues/9");
  });

  it.each([
    ["a closed issue", rawIssue(9, { state: "closed" })],
    ["an issue without from-app", rawIssue(9, { labels: [{ name: "bug" }] })],
    ["a pull request", rawIssue(9, { pull_request: {} })],
  ])("refuses %s", async (_name, data) => {
    fetchMock.mockResolvedValue(json(data));
    expect(await getOpenFromAppIssue(9)).toMatchObject({ ok: false, reason: "not_eligible" });
  });

  it("refuses an issue that does not exist, and says unavailable for other GitHub failures", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "Not Found" }, 404));
    expect(await getOpenFromAppIssue(9)).toMatchObject({ ok: false, reason: "not_eligible" });
    fetchMock.mockResolvedValueOnce(json({ message: "boom" }, 500));
    expect(await getOpenFromAppIssue(9)).toMatchObject({ ok: false, reason: "unavailable" });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await getOpenFromAppIssue(9)).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("says unavailable without a token", async () => {
    delete process.env.BUG_REPORT_GITHUB_TOKEN;
    expect(await getOpenFromAppIssue(9)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("commentOnIssue and buildCommentBody", () => {
  const input = {
    reportId: 42,
    description: "Seraphina Quill (123456789012345678) says the chain froze, cc @octocat #9",
    expected: "It resolves",
    path: "/duels/abc",
    duelSlug: "abc",
    context: { format: "ffa3" as const, turn: 4, phase: "main1", log: ["Turn 4", "Player 1 draws 1 card"] },
    baseUrl: "https://duel.example.com",
  };
  const redact = ["123456789012345678", "Seraphina Quill", "guild-xyz"];

  it("names the report and holds the same safe sections as the issue", () => {
    const body = buildCommentBody(input, redact);
    expect(body.startsWith("**+1** from `Report #42`")).toBe(true);
    for (const part of ["## Description", "## Expected", "## Context", "## Recent log", "## Replay", "https://duel.example.com/duels/abc/replay"]) expect(body).toContain(part);
    expect(body).toContain("Player 1 draws 1 card");
  });

  it("has no Discord id, no name and no live mention or issue link", () => {
    const body = buildCommentBody(input, redact);
    expect(body).not.toContain("123456789012345678");
    expect(body).not.toContain("Seraphina");
    expect(body).not.toMatch(/@octocat/);
    expect(body).not.toMatch(/#9\b/);
    expect(buildIssueBody(input, redact)).not.toContain("123456789012345678");
  });

  it("posts the comment to the issue and returns ok", async () => {
    fetchMock.mockResolvedValue(json({ id: 1 }, 201));
    expect(await commentOnIssue(9, input, redact)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/imran443/yugioh-bot/issues/9/comments");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string).body).toContain("**+1**");
  });

  it("returns the error instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "Forbidden" }, 403));
    expect(await commentOnIssue(9, input, redact)).toEqual({ ok: false, error: "GitHub answered 403: Forbidden" });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect((await commentOnIssue(9, input, redact)).ok).toBe(false);
    delete process.env.BUG_REPORT_GITHUB_TOKEN;
    expect((await commentOnIssue(9, input, redact)).ok).toBe(false);
  });
});
