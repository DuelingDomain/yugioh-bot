import type { CardDataStatus, EngineDataSource, EngineDataStatus, EngineUpdateWorkflowStatus, UpstreamSourceStatus } from "@yugidraft/shared/types";
import { ENGINE_SOURCE_REPOSITORIES } from "./card-data-status.js";
import { isReleasedDatabaseFile, sortDatabaseFiles } from "./released-database-files.js";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const date = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const string = (value: unknown): string | null => typeof value === "string" && value ? value : null;
const githubUrl = (value: unknown): string | null => typeof value === "string" && value.startsWith("https://github.com/") ? value : null;
function commit(value: unknown) {
  const row = object(value), metadata = object(row?.commit);
  const sha = string(row?.sha), committedAt = date(object(metadata?.committer)?.date);
  return sha && committedAt ? { sha, date: committedAt, tree: string(object(metadata?.tree)?.sha) } : null;
}
function comparison(value: unknown) {
  const row = object(value);
  if (!row || !["ahead", "behind", "diverged", "identical"].includes(String(row.status))
    || !Number.isSafeInteger(row.ahead_by) || Number(row.ahead_by) < 0) return null;
  return { status: row.status as UpstreamSourceStatus["comparison"], aheadBy: Number(row.ahead_by), pinnedDate: commit(row.base_commit)?.date ?? null };
}
function releasedFiles(value: unknown): { files: string[] } | null {
  const row = object(value), entries = row?.tree;
  if (row?.truncated !== false || !Array.isArray(entries)
    || entries.some(entry => !object(entry) || typeof entry.path !== "string" || typeof entry.type !== "string")) return null;
  const files = entries.filter(entry => entry.type === "blob" && isReleasedDatabaseFile(entry.path)).map(entry => entry.path as string);
  return files.includes("cards.cdb") ? { files: sortDatabaseFiles(files) } : null;
}
function workflowRun(value: unknown): Pick<EngineUpdateWorkflowStatus, "lastRunStatus" | "lastRun"> | null {
  const runs = object(value)?.workflow_runs;
  if (!Array.isArray(runs)) return null;
  if (!runs.length) return { lastRunStatus: "ok", lastRun: null };
  const run = object(runs[0]), runDate = date(run?.run_started_at) ?? date(run?.created_at);
  const url = githubUrl(run?.html_url), status = string(run?.status);
  if (!run || !runDate || !url || !status || !(run.conclusion === null || typeof run.conclusion === "string")) return null;
  return { lastRunStatus: "ok", lastRun: { conclusion: run.conclusion as string | null, status, date: runDate, url } };
}
function pullRequest(value: unknown): Pick<EngineUpdateWorkflowStatus, "pullRequestStatus" | "openPullRequest"> | null {
  if (!Array.isArray(value)) return null;
  if (!value.length) return { pullRequestStatus: "ok", openPullRequest: null };
  const pull = object(value[0]), url = githubUrl(pull?.html_url), updatedAt = date(pull?.updated_at), title = string(pull?.title);
  if (!pull || !url || !updatedAt || !title || !Number.isSafeInteger(pull.number)
    || object(pull.head)?.ref !== "chore/engine-data-update") return null;
  return { pullRequestStatus: "ok", openPullRequest: { number: pull.number as number, title, url, updatedAt } };
}
export interface CachedGithubResource { value: unknown; checkedAt: number; expiresAt: number }
type GithubStatus = Pick<CardDataStatus, "engine" | "upstream" | "updateWorkflow">;

function unknownStatus(engine: EngineDataStatus, now: number): GithubStatus {
  return { engine, upstream: {
    checkedAt: null, expiresAt: new Date(now).toISOString(),
    sources: Object.fromEntries(Object.entries(ENGINE_SOURCE_REPOSITORIES).map(([source, repository]) => [source, {
      status: "unknown", repository, defaultBranch: null, latestSha: null, latestCommitDate: null,
      behindCommits: null, behindDays: null, comparison: "unknown",
    }])) as GithubStatus["upstream"]["sources"],
    babelCdbFiles: { status: "unknown", files: [] },
  }, updateWorkflow: { lastRunStatus: "unknown", lastRun: null, pullRequestStatus: "unknown", openPullRequest: null } };
}

/** Compact per-resource cache plus a stale snapshot. Cold reads never wait on GitHub. */
export function createGithubCardDataStatus(options: {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number; ttlMs?: number; timeoutMs?: number; token?: string;
  cache?: Map<string, CachedGithubResource>;
} = {}) {
  const fetch = options.fetch ?? globalThis.fetch, now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? 60 * 60 * 1000, timeoutMs = options.timeoutMs ?? 5000;
  // Optional public-read token only. Never borrow BUG_REPORT_GITHUB_TOKEN.
  const token = options.token ?? process.env.GITHUB_TOKEN;
  const cache = options.cache ?? new Map<string, CachedGithubResource>();
  const pending = new Map<string, Promise<CachedGithubResource>>();
  const controllers = new Set<AbortController>();
  let rateLimitedUntil = 0, stopped = false;
  function insert(path: string, result: CachedGithubResource) {
    for (const [key, entry] of cache) if (entry.expiresAt <= now()) cache.delete(key);
    cache.set(path, result);
  }
  function request<T>(path: string, project: (value: unknown) => T | null): Promise<CachedGithubResource> {
    if (stopped) return Promise.resolve({ value: null, checkedAt: now(), expiresAt: now() });
    const cached = cache.get(path);
    if (cached && cached.expiresAt > now()) return Promise.resolve(cached);
    const flight = pending.get(path);
    if (flight) return flight;
    const work = (async () => {
      const checkedAt = now(), controller = new AbortController();
      controllers.add(controller);
      let timer: ReturnType<typeof setTimeout> | undefined, value: T | null = null;
      try {
        if (checkedAt >= rateLimitedUntil) {
          const deadline = new Promise<never>((_, reject) => {
            // Settle even a fetch/body implementation that ignores cancellation.
            controller.signal.addEventListener("abort", () => reject(new Error("GitHub request aborted")), { once: true });
            timer = setTimeout(() => { controller.abort(); reject(new Error("GitHub timeout")); }, timeoutMs);
          });
          const response = (async () => {
            const res = await fetch(`https://api.github.com/repos/${path}`, {
              signal: controller.signal, redirect: "error",
              headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "DuelingDomain-card-data-status", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            });
            controller.signal.throwIfAborted();
            if (!res.ok) {
              if (res.status === 403 || res.status === 429) {
                const clock = now(), exhausted = res.headers.get("x-ratelimit-remaining") === "0";
                const reset = exhausted ? Number(res.headers.get("x-ratelimit-reset")) * 1000 : NaN;
                const retryAfter = res.headers.get("retry-after");
                const retry = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter)
                  ? clock + Number(retryAfter) * 1000 : Date.parse(retryAfter ?? "");
                const until = Number.isFinite(reset) && reset > clock ? reset
                  : Number.isFinite(retry) && retry > clock ? retry : null;
                // A permission 403 only backs off its own resource. Exhausted
                // budgets and secondary limits pause all GitHub requests.
                if (until !== null || exhausted || res.status === 429) {
                  rateLimitedUntil = Math.max(rateLimitedUntil, until ?? clock + 5 * 60_000);
                }
              }
              throw new Error("GitHub unavailable");
            }
            // Never retain compare files/patches, commit arrays, tree blobs, or
            // full workflow/PR payloads. Only the fields used below enter cache.
            const payload = await res.json();
            controller.signal.throwIfAborted();
            return project(payload);
          })();
          value = await Promise.race([response, deadline]);
        }
      } catch { /* Unknown upstream values preserve the local response. */ }
      finally { clearTimeout(timer); controller.abort(); controllers.delete(controller); }
      const result = { value, checkedAt, expiresAt: value !== null ? now() + ttl
        : rateLimitedUntil > now() ? rateLimitedUntil : now() + 5 * 60_000 };
      if (!stopped) insert(path, result);
      return result;
    })();
    pending.set(path, work);
    void work.then(() => pending.delete(path), () => pending.delete(path));
    return work;
  }
  async function build(engine: EngineDataStatus): Promise<GithubStatus> {
    const seen: CachedGithubResource[] = [];
    const get = async <T>(path: string, project: (value: unknown) => T | null): Promise<T | null> => {
      const result = await request(path, project); seen.push(result); return result.value as T | null;
    };
    const readSource = async (source: EngineDataSource) => {
      const repository = ENGINE_SOURCE_REPOSITORIES[source], pinnedSha = engine.sources[source].pinnedSha;
      // Omitting sha resolves the repository's default branch without a repo call.
      const latest = await get(`${repository}/commits?per_page=1`, value => Array.isArray(value) ? commit(value[0]) : null);
      let behindCommits: number | null = null, compare: UpstreamSourceStatus["comparison"] = "unknown", pinnedCommitDate: string | null = null;
      if (latest && pinnedSha) {
        if (pinnedSha === latest.sha) { behindCommits = 0; compare = "identical"; pinnedCommitDate = latest.date; }
        else {
          const result = await get(`${repository}/compare/${encodeURIComponent(pinnedSha)}...${encodeURIComponent(latest.sha)}?per_page=1`, comparison);
          if (result) { behindCommits = result.aheadBy; compare = result.status; pinnedCommitDate = result.pinnedDate; }
        }
      }
      const value: UpstreamSourceStatus = {
        status: latest ? "ok" : "unknown", repository, defaultBranch: null,
        latestSha: latest?.sha ?? null, latestCommitDate: latest?.date ?? null, behindCommits,
        behindDays: latest && pinnedCommitDate ? Math.max(0, Math.floor((Date.parse(latest.date) - Date.parse(pinnedCommitDate)) / 86_400_000)) : null,
        comparison: compare,
      };
      return { source, value, pinnedCommitDate, tree: latest?.tree ?? null };
    };
    const repository = "DuelingDomain/yugioh-bot";
    const [sources, run, pull] = await Promise.all([
      Promise.all((Object.keys(ENGINE_SOURCE_REPOSITORIES) as EngineDataSource[]).map(readSource)),
      get(`${repository}/actions/workflows/engine-data-update.yml/runs?per_page=1`, workflowRun),
      get(`${repository}/pulls?state=open&head=DuelingDomain%3Achore%2Fengine-data-update&per_page=1`, pullRequest),
    ]);
    const treeSha = sources.find(source => source.source === "database")?.tree;
    const tree = treeSha ? await get(`ProjectIgnis/BabelCDB/git/trees/${encodeURIComponent(treeSha)}?recursive=1`, releasedFiles) : null;
    return {
      engine: { ...engine, sources: Object.fromEntries(sources.map(source => [source.source, { ...engine.sources[source.source], pinnedCommitDate: source.pinnedCommitDate }])) as EngineDataStatus["sources"] },
      upstream: {
        checkedAt: new Date(Math.min(...seen.map(entry => entry.checkedAt))).toISOString(),
        expiresAt: new Date(Math.min(...seen.map(entry => entry.expiresAt))).toISOString(),
        sources: Object.fromEntries(sources.map(source => [source.source, source.value])) as CardDataStatus["upstream"]["sources"],
        babelCdbFiles: { status: tree ? "ok" : "unknown", files: tree?.files ?? [] },
      }, updateWorkflow: { ...(run ?? { lastRunStatus: "unknown", lastRun: null }), ...(pull ?? { pullRequestStatus: "unknown", openPullRequest: null }) },
    };
  }
  let snapshot: { key: string; value: GithubStatus } | undefined;
  const refreshing = new Map<string, Promise<void>>();
  const keyFor = (engine: EngineDataStatus) => JSON.stringify([engine.bundleVersion, ...Object.values(engine.sources).map(source => source.pinnedSha)]);
  function refresh(engine: EngineDataStatus): Promise<void> {
    if (stopped) return Promise.resolve();
    const key = keyFor(engine), active = refreshing.get(key);
    if (active) return active;
    const work = build(engine).then(value => { if (!stopped) snapshot = { key, value }; }).finally(() => refreshing.delete(key));
    refreshing.set(key, work);
    return work;
  }
  const read = async (engine: EngineDataStatus): Promise<GithubStatus> => {
    const current = snapshot?.key === keyFor(engine) ? snapshot.value : undefined;
    if (!current || Date.parse(current.upstream.expiresAt) <= now()) void refresh(engine);
    return current ? { ...current, engine: { ...engine, sources: current.engine.sources } } : unknownStatus(engine, now());
  };
  return Object.assign(read, { refresh, async close(): Promise<void> {
    stopped = true;
    for (const controller of controllers) controller.abort();
  } });
}
