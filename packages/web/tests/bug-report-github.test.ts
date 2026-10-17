import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCommentBody, buildIssueBody } from "@/lib/bug-report";
import { bugReportRepo, commentOnIssue, createGithubIssue, getOpenFromAppIssue, listOpenFromAppIssues, resetGithubIssueCache } from "@/lib/bug-report-github";

const TOKEN = "ghp_secretTOKENvalue123";
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const rawIssue = (number: number, extra: Record<string, unknown> = {}) => ({
  number, html_url: `https://github.com/DuelingDomain/yugioh-bot/issues/${number}`, title: `[Bug] [FFA3] Issue ${number}`, state: "open",
  labels: [{ name: "bug" }, { name: "from-app" }], body: "## Description\n\n```\nThe chain froze\n```\n\n## Expected\n\nx", ...extra,
});

beforeEach(() => {
  resetGithubIssueCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", TOKEN);
  vi.stubEnv("BUG_REPORT_GITHUB_REPO", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("createGithubIssue", () => {
  const input = { reportId: 42, description: "The chain froze after resolving the effect", path: "/duels/abc", context: {} };

  it.each([undefined, "", "not-a-repo", "https://github.com/someone/else"])("uses the org repo when the configured repo is %s", async (repo) => {
    vi.stubEnv("BUG_REPORT_GITHUB_REPO", repo);
    fetchMock.mockResolvedValue(json(rawIssue(42), 201));
    expect(bugReportRepo()).toBe("DuelingDomain/yugioh-bot");
    expect(await createGithubIssue(input, [])).toMatchObject({ ok: true, number: 42 });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.github.com/repos/DuelingDomain/yugioh-bot/issues");
  });

  it("uses a trimmed env override for create, list, get and comment calls", async () => {
    vi.stubEnv("BUG_REPORT_GITHUB_REPO", "  someone/else  ");
    fetchMock.mockResolvedValueOnce(json(rawIssue(42), 201)).mockResolvedValueOnce(json([rawIssue(42)]))
      .mockResolvedValueOnce(json(rawIssue(42))).mockResolvedValueOnce(json({ id: 1 }, 201));
    expect(bugReportRepo()).toBe("someone/else");
    expect((await createGithubIssue(input, [])).ok).toBe(true);
    expect((await listOpenFromAppIssues()).ok).toBe(true);
    expect((await getOpenFromAppIssue(42)).ok).toBe(true);
    expect((await commentOnIssue(42, input, [])).ok).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/someone/else/issues",
      "https://api.github.com/repos/someone/else/issues?state=open&labels=from-app&per_page=100",
      "https://api.github.com/repos/someone/else/issues/42",
      "https://api.github.com/repos/someone/else/issues/42/comments",
    ]);
  });

  it.each([301, 307])("preserves the POST body and auth through a GitHub %i redirect", async (status) => {
    const location = "https://api.github.com/repositories/123/issues";
    fetchMock.mockResolvedValueOnce(new Response(null, { status, headers: { location } })).mockResolvedValueOnce(json(rawIssue(42), 201));
    expect(await createGithubIssue(input, [])).toMatchObject({ ok: true, number: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, first] = fetchMock.mock.calls[0]!;
    const [url, second] = fetchMock.mock.calls[1]!;
    expect(url).toBe(location);
    expect(second).toMatchObject({ method: "POST", body: first!.body, signal: first!.signal, redirect: "manual" });
    expect((second!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("follows relative GitHub redirects for reads and comments", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/repositories/123/issues?state=open&labels=from-app&per_page=100" } }))
      .mockResolvedValueOnce(json([rawIssue(42)]))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "/repositories/123/issues/42" } }))
      .mockResolvedValueOnce(json(rawIssue(42)))
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/repositories/123/issues/42/comments" } }))
      .mockResolvedValueOnce(json({ id: 1 }, 201));
    expect((await listOpenFromAppIssues()).ok).toBe(true);
    expect((await getOpenFromAppIssue(42)).ok).toBe(true);
    expect((await commentOnIssue(42, input, [])).ok).toBe(true);
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.github.com/repositories/123/issues?state=open&labels=from-app&per_page=100");
    expect(fetchMock.mock.calls[3]![0]).toBe("https://api.github.com/repositories/123/issues/42");
    expect(fetchMock.mock.calls[5]![0]).toBe("https://api.github.com/repositories/123/issues/42/comments");
    expect(fetchMock.mock.calls[5]![1]!.method).toBe("POST");
  });

  it.each(["https://evil.example/issues", "http://api.github.com/issues", "https://user:password@api.github.com/issues", "http://[invalid"])("rejects redirect location %s without forwarding credentials", async (location) => {
    fetchMock.mockResolvedValue(new Response(null, { status: 301, headers: { location } }));
    const result = await createGithubIssue(input, []);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("301") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("password");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("reports a redirect without a location", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 307 }));
    expect(await createGithubIssue(input, [])).toMatchObject({ ok: false, error: expect.stringContaining("307") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds redirect loops", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 301, headers: { location: "/repositories/123/issues" } }));
    expect(await createGithubIssue(input, [])).toMatchObject({ ok: false, error: expect.stringContaining("redirect") });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([401, 403, 404, 500])("returns HTTP %i and GitHub's message without the token", async (status) => {
    fetchMock.mockResolvedValue(json({ message: `Resource not accessible ${TOKEN}` }, status));
    expect(await createGithubIssue(input, [])).toEqual({ ok: false, error: `GitHub answered ${status}: Resource not accessible [token]` });
  });

  it("keeps the status when GitHub returns a non-JSON error", async () => {
    fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));
    expect(await createGithubIssue(input, [])).toEqual({ ok: false, error: "GitHub answered 502" });
  });
});

describe("listOpenFromAppIssues", () => {
  it("asks for open from-app issues and keeps only issues, not pull requests or closed ones", async () => {
    fetchMock.mockResolvedValue(json([rawIssue(1), rawIssue(2, { pull_request: {} }), rawIssue(3, { state: "closed" }), rawIssue(4, { labels: [{ name: "bug" }] }), rawIssue(5)]));
    const result = await listOpenFromAppIssues();
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.github.com/repos/DuelingDomain/yugioh-bot/issues?state=open&labels=from-app&per_page=100");
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
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.github.com/repos/DuelingDomain/yugioh-bot/issues/9");
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
    expect(await getOpenFromAppIssue(9)).toEqual({ ok: false, reason: "not_eligible", error: "GitHub answered 404: Not Found" });
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
    expect(url).toBe("https://api.github.com/repos/DuelingDomain/yugioh-bot/issues/9/comments");
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
