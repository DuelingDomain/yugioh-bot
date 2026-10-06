import { afterEach, expect, it, vi } from "vitest";
import { createGithubCardDataStatus } from "../src/github-card-data-status.js";
import type { EngineDataStatus } from "@yugidraft/shared/types";
const pin = "a".repeat(40), head = "b".repeat(40);
const engine: EngineDataStatus = {
  bundleVersion: "bundle", preparedAt: null, preparedAtSource: "unknown", cardCount: 1, cdbFiles: ["cards.cdb"],
  sources: { database: { repository: "ProjectIgnis/BabelCDB", pinnedSha: pin, pinnedCommitDate: null },
    scripts: { repository: "ProjectIgnis/CardScripts", pinnedSha: pin, pinnedCommitDate: null },
    strings: { repository: "ProjectIgnis/Distribution", pinnedSha: pin, pinnedCommitDate: null } },
};
function fixture(url: string): unknown {
  if (url.includes("/actions/workflows/")) return { workflow_runs: [{ status: "completed", conclusion: "success", run_started_at: "2026-10-01T00:00:00Z", html_url: "https://github.com/run" }] };
  if (url.includes("/pulls?")) return [{ number: 9, title: "Update engine data", html_url: "https://github.com/pr/9", updated_at: "2026-10-01T00:00:00Z", head: { ref: "chore/engine-data-update" } }];
  if (url.includes("/git/trees/")) return { truncated: false, tree: [{ path: "cards.cdb", type: "blob" }, { path: "release-new.cdb", type: "blob" }, { path: "nested/release-old.cdb", type: "blob" }, { path: "README.md", type: "blob" }] };
  if (url.includes("/compare/")) return { status: "ahead", ahead_by: 7, behind_by: 0 };
  if (url.includes("/commits?")) return [{ sha: head, commit: { committer: { date: "2026-10-01T00:00:00Z" }, tree: { sha: "tree" } } }];
  if (url.includes("/commits/")) return { sha: pin, commit: { committer: { date: "2026-09-25T00:00:00Z" } } };
  return { default_branch: "unusual-default" };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it("uses REST default branch HEAD, compare ahead_by, CDB tree files, workflow and PR metadata", async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer optional-token");
    return Response.json(fixture(url));
  });
  const read = createGithubCardDataStatus({ fetch, token: "optional-token" });
  const result = await read(engine);
  expect(result.engine.sources.database.pinnedCommitDate).toBe("2026-09-25T00:00:00Z");
  expect(result.upstream.sources.database).toMatchObject({ status: "ok", defaultBranch: "unusual-default", latestSha: head, behindCommits: 7, behindDays: 6, comparison: "ahead" });
  expect(result.upstream.babelCdbFiles).toEqual({ status: "ok", files: ["cards.cdb", "nested/release-old.cdb", "release-new.cdb"] });
  expect(result.updateWorkflow).toMatchObject({ lastRunStatus: "ok", lastRun: { conclusion: "success" }, pullRequestStatus: "ok", openPullRequest: { number: 9 } });
  expect(engine.sources.database.pinnedCommitDate).toBeNull(); // Cached local snapshot remains immutable.
});

it("deduplicates simultaneous reads, caches for an hour, and refreshes after expiry", async () => {
  let now = 0;
  const fetch = vi.fn(async (url: string) => Response.json(fixture(url)));
  const read = createGithubCardDataStatus({ fetch, now: () => now });
  await Promise.all([read(engine), read(engine)]);
  const requests = fetch.mock.calls.length;
  expect(requests).toBeGreaterThan(0);
  now = 3_599_999; await read(engine); expect(fetch).toHaveBeenCalledTimes(requests);
  now = 3_600_001; await read(engine); expect(fetch).toHaveBeenCalledTimes(requests * 2);
});

it.each(["request", "body"])("times out a hanging %s, aborts it, and caches unknown without crashing", async (stage) => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    signals.push(init!.signal!);
    if (stage === "request") return new Promise<Response>(() => {});
    return { ok: true, json: () => new Promise(() => {}) } as Response;
  });
  const read = createGithubCardDataStatus({ fetch, timeoutMs: 100 });
  const pending = read(engine);
  await vi.advanceTimersByTimeAsync(101);
  const result = await pending;
  expect(result.upstream.sources.database.status).toBe("unknown");
  expect(result.upstream.sources.database.behindCommits).toBeNull();
  expect(result.upstream.babelCdbFiles.status).toBe("unknown");
  expect(result.updateWorkflow).toMatchObject({ lastRunStatus: "unknown", pullRequestStatus: "unknown" });
  expect(signals.every(signal => signal.aborted)).toBe(true);
  const requests = fetch.mock.calls.length;
  await read(engine); expect(fetch).toHaveBeenCalledTimes(requests);
});

it("isolates rate limits, malformed payloads, compare failures and empty workflow/PR lists", async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("CardScripts")) return new Response("rate limited", { status: 403 });
    if (url.includes("/compare/")) return new Response("unavailable", { status: 503 });
    if (url.includes("/actions/workflows/")) return Response.json({ workflow_runs: [] });
    if (url.includes("/pulls?")) return Response.json([]);
    if (url.includes("/git/trees/")) return Response.json({ truncated: true, tree: [] });
    return Response.json(fixture(url));
  });
  const result = await createGithubCardDataStatus({ fetch })(engine);
  expect(result.upstream.sources.database).toMatchObject({ status: "ok", comparison: "unknown", behindCommits: null, behindDays: 6 });
  expect(result.upstream.sources.scripts.status).toBe("unknown");
  expect(result.upstream.babelCdbFiles.status).toBe("unknown");
  expect(result.updateWorkflow).toEqual({ lastRunStatus: "ok", lastRun: null, pullRequestStatus: "ok", openPullRequest: null });
});

it("reports zero lag for identical pins without making compare requests", async () => {
  const current = { ...engine, sources: Object.fromEntries(Object.entries(engine.sources).map(([key, source]) => [key, { ...source, pinnedSha: head }])) as EngineDataStatus["sources"] };
  const fetch = vi.fn(async (url: string) => {
    if (url.includes(`/commits/${head}`)) return Response.json({ sha: head, commit: { committer: { date: "2026-10-01T00:00:00Z" } } });
    return Response.json(fixture(url));
  });
  const result = await createGithubCardDataStatus({ fetch })(current);
  expect(result.upstream.sources.database).toMatchObject({ behindCommits: 0, behindDays: 0, comparison: "identical" });
  expect(fetch.mock.calls.some(([url]) => url.includes("/compare/"))).toBe(false);
});

it("turns malformed responses and rejected network requests into independent unknown values", async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("BabelCDB")) throw new Error("network down");
    return Response.json({ unexpected: true });
  });
  const result = await createGithubCardDataStatus({ fetch })(engine);
  expect(Object.values(result.upstream.sources).every(source => source.status === "unknown" && source.latestSha === null)).toBe(true);
  expect(result.updateWorkflow).toEqual({ lastRunStatus: "unknown", lastRun: null, pullRequestStatus: "unknown", openPullRequest: null });
});
