import type { CardDataStatus, EngineDataSource, EngineDataStatus, EngineUpdateWorkflowStatus, UpstreamSourceStatus } from "@yugidraft/shared/types";
import { ENGINE_SOURCE_REPOSITORIES } from "./card-data-status.js";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const date = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const string = (value: unknown): string | null => typeof value === "string" && value ? value : null;
function commit(value: unknown) {
  const row = object(value), metadata = object(row?.commit);
  const sha = string(row?.sha), committedAt = date(object(metadata?.committer)?.date);
  return sha && committedAt ? { sha, date: committedAt, tree: string(object(metadata?.tree)?.sha) } : null;
}
interface CachedResource { value: unknown; checkedAt: number; expiresAt: number }
type GithubStatus = Pick<CardDataStatus, "engine" | "upstream" | "updateWorkflow">;

/** Process-local, per-URL cache. Failures also expire after an hour to avoid rate-limit storms. */
export function createGithubCardDataStatus(options: {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number; ttlMs?: number; timeoutMs?: number; token?: string;
} = {}): (engine: EngineDataStatus) => Promise<GithubStatus> {
  const fetch = options.fetch ?? globalThis.fetch, now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? 60 * 60 * 1000, timeoutMs = options.timeoutMs ?? 5000;
  const token = options.token ?? process.env.GITHUB_TOKEN;
  const cache = new Map<string, CachedResource>();
  const pending = new Map<string, Promise<CachedResource>>();
  function request(path: string): Promise<CachedResource> {
    const cached = cache.get(path);
    if (cached && cached.expiresAt > now()) return Promise.resolve(cached);
    const flight = pending.get(path);
    if (flight) return flight;
    const work = (async () => {
      const checkedAt = now();
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let value: unknown = null;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("GitHub timeout")); }, timeoutMs);
        });
        const response = (async () => {
          const res = await fetch(`https://api.github.com/repos/${path}`, {
            signal: controller.signal, redirect: "error",
            headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "DuelingDomain-card-data-status", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          });
          if (!res.ok) throw new Error("GitHub unavailable");
          return res.json() as Promise<unknown>;
        })();
        value = await Promise.race([response, deadline]);
      } catch { /* Unknown is an operator-visible result; upstream failures never break the host. */ }
      finally { clearTimeout(timer); controller.abort(); }
      const result = { value, checkedAt, expiresAt: checkedAt + ttl };
      cache.set(path, result);
      // Bound old pinned-commit/compare entries after repeated bundle updates.
      if (cache.size > 128) for (const [key, entry] of cache) if (entry.expiresAt <= now()) cache.delete(key);
      return result;
    })();
    pending.set(path, work);
    void work.finally(() => pending.delete(path));
    return work;
  }
  return async (engine) => {
    const seen: CachedResource[] = [];
    const get = async (path: string) => { const result = await request(path); seen.push(result); return result.value; };
    const readSource = async (source: EngineDataSource) => {
      const repository = ENGINE_SOURCE_REPOSITORIES[source];
      const pinnedSha = engine.sources[source].pinnedSha;
      const [repo, heads, pin] = await Promise.all([
        get(repository), get(`${repository}/commits?per_page=1`),
        pinnedSha ? get(`${repository}/commits/${encodeURIComponent(pinnedSha)}`) : Promise.resolve(null),
      ]);
      // Omitting sha on the commits endpoint means the repository's default branch.
      const latest = Array.isArray(heads) ? commit(heads[0]) : null;
      const pinned = commit(pin);
      let behindCommits: number | null = null;
      let comparison: UpstreamSourceStatus["comparison"] = "unknown";
      if (latest && pinnedSha) {
        if (pinnedSha === latest.sha) { behindCommits = 0; comparison = "identical"; }
        else {
          const compare = object(await get(`${repository}/compare/${encodeURIComponent(pinnedSha)}...${encodeURIComponent(latest.sha)}?per_page=1`));
          if (compare && ["ahead", "behind", "diverged", "identical"].includes(String(compare.status))
            && Number.isSafeInteger(compare.ahead_by) && Number(compare.ahead_by) >= 0) {
            // HEAD is the compare head: ahead_by counts commits missing from our pin.
            behindCommits = Number(compare.ahead_by);
            comparison = compare.status as UpstreamSourceStatus["comparison"];
          }
        }
      }
      const pinnedCommitDate = pinned?.date ?? (latest?.sha === pinnedSha ? latest.date : null);
      const value: UpstreamSourceStatus = {
        status: latest ? "ok" : "unknown", repository, defaultBranch: string(object(repo)?.default_branch),
        latestSha: latest?.sha ?? null, latestCommitDate: latest?.date ?? null, behindCommits,
        behindDays: latest && pinnedCommitDate ? Math.max(0, Math.floor((Date.parse(latest.date) - Date.parse(pinnedCommitDate)) / 86_400_000)) : null,
        comparison,
      };
      return { source, value, pinnedCommitDate, tree: latest?.tree ?? null };
    };
    const readWorkflow = async (): Promise<EngineUpdateWorkflowStatus> => {
      const repository = "DuelingDomain/yugioh-bot";
      const [runsPayload, pullsPayload] = await Promise.all([
        get(`${repository}/actions/workflows/engine-data-update.yml/runs?per_page=1`),
        get(`${repository}/pulls?state=open&head=DuelingDomain%3Achore%2Fengine-data-update&per_page=1`),
      ]);
      const runs = object(runsPayload)?.workflow_runs;
      const run = Array.isArray(runs) ? object(runs[0]) : null;
      const runDate = date(run?.run_started_at) ?? date(run?.created_at), runUrl = string(run?.html_url), runStatus = string(run?.status);
      const validRun = !!run && !!runDate && !!runUrl && !!runStatus && (run.conclusion === null || typeof run.conclusion === "string");
      const pull = Array.isArray(pullsPayload) ? object(pullsPayload[0]) : null;
      const pullUrl = string(pull?.html_url), pullDate = date(pull?.updated_at), title = string(pull?.title);
      const validPull = !!pull && !!pullUrl && !!pullDate && !!title && Number.isSafeInteger(pull.number)
        && object(pull.head)?.ref === "chore/engine-data-update";
      return {
        lastRunStatus: validRun || Array.isArray(runs) && !runs.length ? "ok" : "unknown",
        lastRun: validRun ? { conclusion: run!.conclusion as string | null, status: runStatus!, date: runDate!, url: runUrl! } : null,
        pullRequestStatus: validPull || Array.isArray(pullsPayload) && !pullsPayload.length ? "ok" : "unknown",
        openPullRequest: validPull ? { number: pull!.number as number, title: title!, url: pullUrl!, updatedAt: pullDate! } : null,
      };
    };
    const [sources, updateWorkflow] = await Promise.all([
      Promise.all((Object.keys(ENGINE_SOURCE_REPOSITORIES) as EngineDataSource[]).map(readSource)), readWorkflow(),
    ]);
    const treeSha = sources.find(source => source.source === "database")?.tree;
    const tree = treeSha ? object(await get(`ProjectIgnis/BabelCDB/git/trees/${encodeURIComponent(treeSha)}?recursive=1`)) : null;
    const entries = tree?.tree;
    const validTree = tree?.truncated === false && Array.isArray(entries)
      && entries.every(entry => !!object(entry) && typeof entry.path === "string" && typeof entry.type === "string");
    return {
      engine: { ...engine, sources: Object.fromEntries(sources.map(source => [source.source, { ...engine.sources[source.source], pinnedCommitDate: source.pinnedCommitDate }])) as EngineDataStatus["sources"] },
      upstream: {
        checkedAt: new Date(Math.min(...seen.map(entry => entry.checkedAt))).toISOString(),
        expiresAt: new Date(Math.min(...seen.map(entry => entry.expiresAt))).toISOString(),
        sources: Object.fromEntries(sources.map(source => [source.source, source.value])) as CardDataStatus["upstream"]["sources"],
        babelCdbFiles: { status: validTree ? "ok" : "unknown", files: validTree ? entries.filter(entry => entry.type === "blob" && /\.cdb$/i.test(entry.path)).map(entry => entry.path as string).sort() : [] },
      }, updateWorkflow,
    };
  };
}
