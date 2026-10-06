import { afterEach, expect, it, vi } from "vitest";
import { createGithubCardDataStatus, type CachedGithubResource } from "../src/github-card-data-status.js";
import type { EngineDataStatus } from "@yugidraft/shared/types";
const pin = "a".repeat(40), head = "b".repeat(40);
const engine: EngineDataStatus = {
  bundleVersion: "bundle", preparedAt: null, preparedAtSource: "unknown", cardCount: 1, cdbFiles: ["cards.cdb"],
  sources: { database: { repository: "ProjectIgnis/BabelCDB", pinnedSha: pin, pinnedCommitDate: null },
    scripts: { repository: "ProjectIgnis/CardScripts", pinnedSha: pin, pinnedCommitDate: null },
    strings: { repository: "ProjectIgnis/Distribution", pinnedSha: pin, pinnedCommitDate: null } },
};
const metadata = { sha: pin, commit: { committer: { date: "2026-09-25T00:00:00Z" } } };
function fixture(url: string): unknown {
  if (url.includes("/actions/workflows/")) return { workflow_runs: [{ status: "completed", conclusion: "success", run_started_at: "2026-10-01T00:00:00Z", html_url: "https://github.com/run" }] };
  if (url.includes("/pulls?")) return [{ number: 9, title: "Update engine data", html_url: "https://github.com/pr/9", updated_at: "2026-10-01T00:00:00Z", head: { ref: "chore/engine-data-update" } }];
  if (url.includes("/git/trees/")) return { truncated: false, tree: [
    { path: "cards.cdb", type: "blob" }, { path: "release-new.cdb", type: "blob" }, { path: "nested/release-old.cdb", type: "blob" },
    { path: "other.cdb", type: "blob" }, { path: "prerelease.cdb", type: "blob" }, { path: "skills.cdb", type: "blob" }, { path: "release-not.cdb", type: "tree" },
  ] };
  if (url.includes("/compare/")) return { status: "ahead", ahead_by: 7, behind_by: 0, base_commit: metadata, commits: [{ huge: "unused" }] };
  if (url.includes("/commits?")) return [{ sha: head, commit: { committer: { date: "2026-10-01T00:00:00Z" }, tree: { sha: "tree" } } }];
  throw new Error(`Unexpected redundant request: ${url}`);
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function warm(options: Parameters<typeof createGithubCardDataStatus>[0] = {}, current = engine) {
  const read = createGithubCardDataStatus(options); await read.refresh(current); return { read, result: await read(current) };
}

it("gets default-branch HEAD and compare-base pin dates in nine calls, selecting only released root CDBs", async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer optional-token");
    return Response.json(fixture(url));
  });
  const { result } = await warm({ fetch, token: "optional-token" });
  expect(fetch).toHaveBeenCalledTimes(9);
  expect(result.engine.sources.database.pinnedCommitDate).toBe("2026-09-25T00:00:00Z");
  expect(result.upstream.sources.database).toMatchObject({ status: "ok", defaultBranch: null, latestSha: head, behindCommits: 7, behindDays: 6, comparison: "ahead" });
  expect(result.upstream.babelCdbFiles).toEqual({ status: "ok", files: ["cards.cdb", "release-new.cdb"] });
  expect(result.updateWorkflow).toMatchObject({ lastRunStatus: "ok", lastRun: { conclusion: "success" }, pullRequestStatus: "ok", openPullRequest: { number: 9 } });
  expect(engine.sources.database.pinnedCommitDate).toBeNull();
});

it("returns cold unknown and stale values immediately, deduplicating background refreshes", async () => {
  let now = 0; let hang = false;
  const releases: Array<() => void> = [];
  const fetch = vi.fn(async (url: string) => {
    if (hang) await new Promise<void>(resolve => releases.push(resolve));
    return Response.json(fixture(url));
  });
  const read = createGithubCardDataStatus({ fetch, now: () => now });
  const cold = await read(engine); expect(cold.upstream.sources.database.status).toBe("unknown");
  await read.refresh(engine); expect(fetch).toHaveBeenCalledTimes(9);
  const fresh = await read(engine);
  now = 3_599_999; await read(engine); expect(fetch).toHaveBeenCalledTimes(9);
  now = 3_600_001; hang = true;
  const [stale1, stale2] = await Promise.all([read(engine), read(engine)]);
  expect(stale1).toEqual(fresh); expect(stale2).toEqual(fresh);
  const pending = read.refresh(engine);
  // Requests have dependencies (HEAD -> compare -> tree); release each wave.
  for (let wave = 0; wave < 3; wave++) { for (const release of releases.splice(0)) release(); await new Promise(resolve => setTimeout(resolve, 0)); }
  await pending; expect(fetch).toHaveBeenCalledTimes(18);
});

it("caches only projected fields and prunes expired entries on every insertion", async () => {
  const cache = new Map<string, CachedGithubResource>([["expired", { value: {}, checkedAt: 0, expiresAt: 1 }]]);
  const huge = "discard-me".repeat(100_000);
  const fetch = vi.fn(async (url: string) => {
    const value = fixture(url);
    return Response.json(Array.isArray(value) ? value.map(row => ({ ...row, unused: huge })) : { ...(value as object), unused: huge });
  });
  await warm({ fetch, cache, now: () => 2 });
  expect(cache.has("expired")).toBe(false);
  expect(cache.size).toBe(9);
  expect(JSON.stringify([...cache.values()]).length).toBeLessThan(6000);
  expect(JSON.stringify([...cache.values()])).not.toContain("discard-me");
});

it.each(["request", "body"])("times out a hanging %s, aborts it, and retries unknown after five minutes", async stage => {
  vi.useFakeTimers(); let now = 0;
  const signals: AbortSignal[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    signals.push(init!.signal!);
    if (stage === "request") return new Promise<Response>(() => {});
    return { ok: true, json: () => new Promise(() => {}) } as Response;
  });
  const read = createGithubCardDataStatus({ fetch, timeoutMs: 100, now: () => now });
  const pending = read.refresh(engine); await vi.advanceTimersByTimeAsync(101); await pending;
  const result = await read(engine);
  expect(result.upstream.sources.database.status).toBe("unknown"); expect(signals.every(s => s.aborted)).toBe(true);
  const calls = fetch.mock.calls.length;
  now = 299_999; await read.refresh(engine); expect(fetch).toHaveBeenCalledTimes(calls);
  now = 300_001; const retry = read.refresh(engine); await vi.advanceTimersByTimeAsync(101); await retry;
  expect(fetch).toHaveBeenCalledTimes(calls * 2);
});

it.each([403, 429])("honors x-ratelimit-reset for %i", async status => {
  let now = 0;
  const fetch = vi.fn(async () => new Response("rate limited", { status, headers: { "x-ratelimit-reset": "900" } }));
  const { read, result } = await warm({ fetch, now: () => now });
  expect(result.upstream.expiresAt).toBe("1970-01-01T00:15:00.000Z");
  const calls = fetch.mock.calls.length;
  now = 300_001; await read.refresh(engine); expect(fetch).toHaveBeenCalledTimes(calls);
  now = 900_001; await read.refresh(engine); expect(fetch.mock.calls.length).toBeGreaterThan(calls);
});

it.each(["behind", "diverged"])("uses compare ahead_by for %s", async status => {
  const { result } = await warm({ fetch: async url => Response.json(url.includes("/compare/")
    ? { status, ahead_by: status === "behind" ? 0 : 3, behind_by: 10, base_commit: metadata } : fixture(url)) });
  expect(result.upstream.sources.database).toMatchObject({ comparison: status, behindCommits: status === "behind" ? 0 : 3, behindDays: 6 });
});

it("isolates failed compares and empty workflow/PR lists", async () => {
  const { result } = await warm({ fetch: async url => {
    if (url.includes("CardScripts")) return new Response("unavailable", { status: 503 });
    if (url.includes("/compare/")) return new Response("unavailable", { status: 503 });
    if (url.includes("/actions/workflows/")) return Response.json({ workflow_runs: [] });
    if (url.includes("/pulls?")) return Response.json([]);
    if (url.includes("/git/trees/")) return Response.json({ truncated: true, tree: [] });
    return Response.json(fixture(url));
  } });
  expect(result.upstream.sources.database).toMatchObject({ status: "ok", comparison: "unknown", behindCommits: null, behindDays: null });
  expect(result.upstream.sources.scripts.status).toBe("unknown"); expect(result.upstream.babelCdbFiles.status).toBe("unknown");
  expect(result.updateWorkflow).toEqual({ lastRunStatus: "ok", lastRun: null, pullRequestStatus: "ok", openPullRequest: null });
});

it("reports identical pins without compare or standalone pin requests", async () => {
  const current = { ...engine, sources: Object.fromEntries(Object.entries(engine.sources).map(([key, source]) => [key, { ...source, pinnedSha: head }])) as EngineDataStatus["sources"] };
  const fetch = vi.fn(async (url: string) => Response.json(fixture(url)));
  const { result } = await warm({ fetch }, current);
  expect(result.upstream.sources.database).toMatchObject({ behindCommits: 0, behindDays: 0, comparison: "identical" });
  expect(result.engine.sources.database.pinnedCommitDate).toBe("2026-10-01T00:00:00Z");
  expect(fetch).toHaveBeenCalledTimes(6);
});

it.each(["https://evil.example/", "http://github.com/", "https://github.com.evil.example/", "javascript:alert(1)"])("rejects untrusted html_url %s", async html_url => {
  const { result } = await warm({ fetch: async url => {
    const value = fixture(url);
    if (url.includes("/actions/")) return Response.json({ workflow_runs: [{ ...(value as any).workflow_runs[0], html_url }] });
    if (url.includes("/pulls?")) return Response.json([{ ...(value as any)[0], html_url }]);
    return Response.json(value);
  } });
  expect(result.updateWorkflow).toEqual({ lastRunStatus: "unknown", lastRun: null, pullRequestStatus: "unknown", openPullRequest: null });
});

it("uses no bug-report token and treats malformed or rejected resources as unknown", async () => {
  vi.stubEnv("GITHUB_TOKEN", ""); vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", "must-not-use");
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    if (url.includes("BabelCDB")) throw new Error("network down");
    return Response.json({ unexpected: true });
  });
  const { result } = await warm({ fetch });
  expect(Object.values(result.upstream.sources).every(s => s.status === "unknown")).toBe(true);
});
