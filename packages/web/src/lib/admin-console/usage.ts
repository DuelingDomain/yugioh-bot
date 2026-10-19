import { cachedLoader, failed, notConfigured, ok, type SectionLoader } from "./section";
import type { UsageData } from "./types";

const TIMEOUT_MS = 8_000;
const DAYS = 7;
// The app only sends $pageview, with anonymous ids and route templates. Nothing here reads a person.
const DAILY = `SELECT dateDiff('day', toDate(timestamp), today()) AS ago, count(DISTINCT person_id) AS visitors, count() AS views
FROM events WHERE event = '$pageview' AND timestamp >= today() - INTERVAL ${DAYS - 1} DAY GROUP BY ago ORDER BY ago`;
const WEEKLY = `SELECT count(DISTINCT person_id) FROM events WHERE event = '$pageview' AND timestamp >= today() - INTERVAL ${DAYS - 1} DAY`;
const TOP_PAGES = `SELECT properties.$pathname AS path, count() AS views FROM events
WHERE event = '$pageview' AND timestamp >= today() AND properties.$pathname IS NOT NULL GROUP BY path ORDER BY views DESC LIMIT 5`;

interface Config { key: string; projectId: string; host: string; dashboardUrl: string | null }

/** The ingest hosts (eu.i.posthog.com) are not the API hosts (eu.posthog.com). Accept either in POSTHOG_HOST. */
function apiHost(raw: string | undefined): string | null {
  try {
    const url = new URL(raw?.trim() || "https://eu.posthog.com");
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin.replace(/^(https?:\/\/)(eu|us)\.i\.posthog\.com$/, "$1$2.posthog.com");
  } catch { return null; }
}
function webLink(raw: string | undefined): string | null {
  try {
    const url = new URL(raw?.trim() ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

function readConfig(): Config | string {
  const key = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  const projectId = process.env.POSTHOG_PROJECT_ID?.trim();
  const missing = [!key && "POSTHOG_PERSONAL_API_KEY", !projectId && "POSTHOG_PROJECT_ID"].filter(Boolean);
  if (missing.length > 0) return `Add ${missing.join(" and ")} to show usage.`;
  if (!/^\d+$/.test(projectId!)) return "POSTHOG_PROJECT_ID must be a number.";
  const host = apiHost(process.env.POSTHOG_HOST);
  if (!host) return "POSTHOG_HOST must be a web address.";
  return { key: key!, projectId: projectId!, host, dashboardUrl: webLink(process.env.POSTHOG_DASHBOARD_URL) };
}

async function hogql(config: Config, query: string): Promise<unknown[][]> {
  const response = await fetch(`${config.host}/api/projects/${config.projectId}/query/`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.key}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name: "admin-console usage" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`PostHog ${response.status}`);
  const body = await response.json() as { results?: unknown };
  if (!Array.isArray(body.results) || !body.results.every(Array.isArray)) throw new Error("Unexpected PostHog answer");
  return body.results as unknown[][];
}

const num = (value: unknown): number => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

const load = cachedLoader<UsageData>(90_000, async () => {
  const config = readConfig();
  if (typeof config === "string") return notConfigured(config);
  try {
    const [daily, weekly, pages] = await Promise.all([hogql(config, DAILY), hogql(config, WEEKLY), hogql(config, TOP_PAGES)]);
    const dauSeries = new Array<number>(DAYS).fill(0);
    let pageviewsToday = 0;
    for (const [ago, visitors, views] of daily) {
      const a = num(ago);
      if (!Number.isInteger(a) || a < 0 || a >= DAYS) continue;
      dauSeries[DAYS - 1 - a] = num(visitors);
      if (a === 0) pageviewsToday = num(views);
    }
    const topPages = pages
      .map(([path, views]) => ({ path: typeof path === "string" ? path : "", views: num(views) }))
      .filter((page) => page.path.startsWith("/") && page.path.length <= 80 && page.views > 0);
    return ok({
      dau: dauSeries[DAYS - 1],
      wau: num(weekly[0]?.[0]),
      pageviewsToday,
      dashboardUrl: config.dashboardUrl,
      dauSeries,
      topPages,
    });
  } catch {
    return failed("PostHog did not answer");
  }
});

export const loadUsage: SectionLoader<"usage"> = async () => load();
