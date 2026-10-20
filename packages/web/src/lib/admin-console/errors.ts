import { cachedLoader, failed, notConfigured, ok, type SectionLoader } from "./section";
import type { ErrorIssue, ErrorsData } from "./types";

const SHOWN = 8;
const FETCH_PER_PROJECT = 25;
const TIMEOUT_MS = 5_000;
const SLUG = /^[A-Za-z0-9._-]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Config { token: string; org: string; projects: string[]; base: string; ui: string }

function readConfig(): Config | string {
  const token = process.env.SENTRY_API_TOKEN?.trim();
  const org = process.env.SENTRY_ORG?.trim();
  const projects = (process.env.SENTRY_PROJECT ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const missing = [!token && "SENTRY_API_TOKEN", !org && "SENTRY_ORG", projects.length === 0 && "SENTRY_PROJECT"].filter(Boolean);
  if (missing.length > 0) return `Add ${missing.join(", ")} to show Sentry errors.`;
  if (!SLUG.test(org!) || !projects.every((p) => SLUG.test(p))) return "SENTRY_ORG and SENTRY_PROJECT must be Sentry slugs.";
  let base: string;
  try {
    const url = new URL(process.env.SENTRY_BASE_URL?.trim() || "https://sentry.io");
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
    base = url.origin;
  } catch { return "SENTRY_BASE_URL must be a web address."; }
  // Sentry SaaS (sentry.io, de.sentry.io, us.sentry.io) serves the API on the region host but the web UI on <org>.sentry.io.
  const host = new URL(base).hostname;
  const ui = host === "sentry.io" || host.endsWith(".sentry.io") ? `https://${org}.sentry.io` : `${base}/organizations/${org}`;
  return { token: token!, org: org!, projects, base, ui };
}

async function sentryGet(config: Config, path: string): Promise<unknown> {
  const response = await fetch(`${config.base}/api/0/${path}`, {
    headers: { authorization: `Bearer ${config.token}`, accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Sentry ${response.status}`);
  return response.json();
}

const num = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/** Events in the last 24 hours: the hourly buckets when Sentry sends them, else the issue count. */
function events24h(raw: Record<string, unknown>): number {
  const stats = (raw.stats as Record<string, unknown> | undefined)?.["24h"];
  if (Array.isArray(stats)) {
    return stats.reduce<number>((sum, bucket) => sum + (Array.isArray(bucket) ? num(bucket[1]) ?? 0 : 0), 0);
  }
  return num(raw.count) ?? 0;
}

function toIssue(raw: unknown, config: Config, project: string): ErrorIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" || typeof r.id === "number" ? String(r.id) : null;
  const title = text(r.title, 200);
  if (!id || !/^\d+$/.test(id) || !title) return null;
  const projectSlug = text((r.project as { slug?: unknown } | undefined)?.slug, 80) ?? project;
  return {
    id, title,
    count: events24h(r),
    lastSeen: text(r.lastSeen, 40) ?? "",
    url: `${config.ui}/issues/${id}/`,
    level: text(r.level, 20),
    culprit: text(r.culprit, 120),
    users: num(r.userCount),
    project: projectSlug,
  };
}

async function projectIssues(config: Config, project: string): Promise<ErrorIssue[]> {
  const query = new URLSearchParams({ statsPeriod: "24h", query: "is:unresolved", sort: "freq", limit: String(FETCH_PER_PROJECT) });
  const body = await sentryGet(config, `projects/${config.org}/${project}/issues/?${query}`);
  if (!Array.isArray(body)) throw new Error("Unexpected Sentry answer");
  return body.map((raw) => toIssue(raw, config, project)).filter((issue): issue is ErrorIssue => issue !== null);
}

/** All error events accepted in the last 24 h for the configured projects, or null when this call is not allowed. */
async function totalLast24h(config: Config): Promise<number | null> {
  try {
    const ids = await Promise.all(config.projects.map(async (project) => {
      const body = await sentryGet(config, `projects/${config.org}/${project}/`) as { id?: unknown };
      const id = typeof body.id === "string" || typeof body.id === "number" ? String(body.id) : "";
      if (!/^\d+$/.test(id)) throw new Error("No project id");
      return id;
    }));
    const query = new URLSearchParams({ field: "sum(quantity)", category: "error", outcome: "accepted", statsPeriod: "24h" });
    for (const id of ids) query.append("project", id);
    const body = await sentryGet(config, `organizations/${config.org}/stats_v2/?${query}`) as { groups?: { totals?: Record<string, unknown> }[] };
    if (!Array.isArray(body.groups)) return null;
    return body.groups.reduce((sum, group) => sum + (num(group.totals?.["sum(quantity)"]) ?? 0), 0);
  } catch { return null; }
}

const load = cachedLoader<ErrorsData>(60_000, async () => {
  const config = readConfig();
  if (typeof config === "string") return notConfigured(config);
  try {
    const [lists, total] = await Promise.all([
      Promise.all(config.projects.map((project) => projectIssues(config, project))),
      totalLast24h(config),
    ]);
    const all = lists.flat();
    const cutoff = Date.now() - DAY_MS;
    const recent = all.filter((issue) => issue.count > 0 || Date.parse(issue.lastSeen) >= cutoff);
    const issues = recent.sort((a, b) => b.count - a.count || Date.parse(b.lastSeen) - Date.parse(a.lastSeen)).slice(0, SHOWN);
    return ok({
      issues,
      last24h: total ?? recent.reduce((sum, issue) => sum + issue.count, 0),
      dashboardUrl: `${config.ui}/projects/${config.projects[0]}/`,
    });
  } catch {
    return failed("Sentry did not answer");
  }
});

export const loadErrors: SectionLoader<"errors"> = async () => load();
