import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});

const TOKEN = "sntrys_secret_token_value";
const POSTHOG_KEY = "phx_secret_personal_key";
const fetchStub = vi.fn();

beforeEach(() => {
  vi.resetModules(); auth.mockReset(); fetchStub.mockReset();
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  vi.stubEnv("OWNER_USER_IDS", "1");
  for (const name of ["SENTRY_API_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_BASE_URL", "POSTHOG_PERSONAL_API_KEY", "POSTHOG_PROJECT_ID", "POSTHOG_HOST", "POSTHOG_DASHBOARD_URL"]) vi.stubEnv(name, "");
  vi.stubGlobal("fetch", fetchStub);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function errors() { const { GET } = await import("../app/api/admin/console/errors/route"); return GET(); }
async function usage() { const { GET } = await import("../app/api/admin/console/usage/route"); return GET(); }

function sentryEnv() {
  vi.stubEnv("SENTRY_API_TOKEN", TOKEN); vi.stubEnv("SENTRY_ORG", "dd"); vi.stubEnv("SENTRY_PROJECT", "web,ws");
}
const bucket = (n: number) => Array.from({ length: 24 }, (_, i) => [1_700_000_000 + i * 3600, i === 0 ? n : 0]);
const issue = (id: string, title: string, events: number, extra: Record<string, unknown> = {}) => ({
  id, title, culprit: "app/api/duels/route", level: "error", userCount: 3, count: "900", lastSeen: new Date().toISOString(),
  stats: { "24h": bucket(events) }, project: { slug: "web" }, ...extra,
});

it("errors: not configured names the missing env and never calls Sentry", async () => {
  const body = await (await errors()).json();
  expect(body.state).toBe("not-configured");
  expect(body.message).toContain("SENTRY_API_TOKEN");
  expect(fetchStub).not.toHaveBeenCalled();
});

it("errors: lists the top issues by 24 h events across projects and totals the last 24 h", async () => {
  sentryEnv();
  fetchStub.mockImplementation(async (input: string, init: RequestInit) => {
    const url = new URL(input);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    if (url.pathname === "/api/0/projects/dd/web/issues/") {
      expect(url.searchParams.get("statsPeriod")).toBe("24h");
      expect(url.searchParams.get("query")).toBe("is:unresolved");
      return json([issue("11", "TypeError: a", 5), issue("12", "RangeError: b", 40)]);
    }
    if (url.pathname === "/api/0/projects/dd/ws/issues/") return json([issue("21", "Socket closed", 12, { project: { slug: "ws" }, level: "warning", userCount: 0 })]);
    if (url.pathname === "/api/0/projects/dd/web/") return json({ id: "101" });
    if (url.pathname === "/api/0/projects/dd/ws/") return json({ id: "102" });
    if (url.pathname === "/api/0/organizations/dd/stats_v2/") {
      expect(url.searchParams.getAll("project")).toEqual(["101", "102"]);
      return json({ groups: [{ by: {}, totals: { "sum(quantity)": 321 } }] });
    }
    return json({}, 404);
  });
  const body = await (await errors()).json();
  expect(body.state).toBe("ok");
  expect(body.data.last24h).toBe(321);
  expect(body.data.issues.map((i: { title: string; count: number }) => [i.title, i.count])).toEqual([["RangeError: b", 40], ["Socket closed", 12], ["TypeError: a", 5]]);
  expect(body.data.issues[0]).toMatchObject({ url: "https://sentry.io/organizations/dd/issues/12/", level: "error", users: 3, culprit: "app/api/duels/route", project: "web" });
  expect(body.data.dashboardUrl).toBe("https://sentry.io/organizations/dd/projects/web/");
  expect(JSON.stringify(body)).not.toContain(TOKEN);
});

it("errors: falls back to the listed issue counts when the stats call is refused, and honours SENTRY_BASE_URL", async () => {
  sentryEnv(); vi.stubEnv("SENTRY_PROJECT", "web"); vi.stubEnv("SENTRY_BASE_URL", "https://de.sentry.io/");
  fetchStub.mockImplementation(async (input: string) => {
    const url = new URL(input);
    expect(url.origin).toBe("https://de.sentry.io");
    if (url.pathname.endsWith("/issues/")) return json([issue("11", "TypeError: a", 5), issue("12", "RangeError: b", 7)]);
    return json({ detail: "forbidden" }, 403);
  });
  const body = await (await errors()).json();
  expect(body.state).toBe("ok");
  expect(body.data.last24h).toBe(12);
});

it("errors: a Sentry HTTP error becomes a safe message without the token", async () => {
  sentryEnv();
  fetchStub.mockResolvedValue(json({ detail: `bad ${TOKEN}` }, 500));
  const response = await errors();
  const body = await response.json();
  expect(body).toMatchObject({ state: "error", message: "Sentry did not answer" });
  expect(JSON.stringify(body)).not.toContain(TOKEN);
});

it("errors: a network failure is also a safe message", async () => {
  sentryEnv();
  fetchStub.mockRejectedValue(new TypeError(`fetch failed for ${TOKEN}`));
  const body = await (await errors()).json();
  expect(body).toMatchObject({ state: "error", message: "Sentry did not answer" });
  expect(JSON.stringify(body)).not.toContain(TOKEN);
});

function posthogEnv() {
  vi.stubEnv("POSTHOG_PERSONAL_API_KEY", POSTHOG_KEY); vi.stubEnv("POSTHOG_PROJECT_ID", "42");
  vi.stubEnv("POSTHOG_DASHBOARD_URL", "https://eu.posthog.com/project/42/dashboard/7");
}

it("usage: not configured names the missing env", async () => {
  const body = await (await usage()).json();
  expect(body.state).toBe("not-configured");
  expect(body.message).toContain("POSTHOG_PERSONAL_API_KEY");
  expect(fetchStub).not.toHaveBeenCalled();
});

it("usage: shows visitors, page views, top pages and a 7 day series from HogQL", async () => {
  posthogEnv(); vi.stubEnv("POSTHOG_HOST", "https://eu.i.posthog.com");
  fetchStub.mockImplementation(async (input: string, init: RequestInit) => {
    expect(input).toBe("https://eu.posthog.com/api/projects/42/query/");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${POSTHOG_KEY}`);
    const query = (JSON.parse(String(init.body)) as { query: { kind: string; query: string } }).query;
    expect(query.kind).toBe("HogQLQuery");
    if (query.query.includes("GROUP BY ago")) return json({ results: [[0, 9, 31], [1, 7, 20], [3, 4, 8]] });
    if (query.query.includes("$pathname")) return json({ results: [["/dashboard", 12], ["/duels/[slug]", 7], [null, 3], ["https://x.test/leak", 2]] });
    return json({ results: [[25]] });
  });
  const body = await (await usage()).json();
  expect(body.state).toBe("ok");
  expect(body.data).toEqual({
    dau: 9, wau: 25, pageviewsToday: 31, dashboardUrl: "https://eu.posthog.com/project/42/dashboard/7",
    dauSeries: [0, 0, 0, 4, 0, 7, 9],
    topPages: [{ path: "/dashboard", views: 12 }, { path: "/duels/[slug]", views: 7 }],
  });
  expect(fetchStub).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(body)).not.toContain(POSTHOG_KEY);
});

it("usage: an empty day reads as zeros and a missing dashboard link is null", async () => {
  vi.stubEnv("POSTHOG_PERSONAL_API_KEY", POSTHOG_KEY); vi.stubEnv("POSTHOG_PROJECT_ID", "42");
  fetchStub.mockImplementation(async () => json({ results: [] }));
  const body = await (await usage()).json();
  expect(body.data).toMatchObject({ dau: 0, wau: 0, pageviewsToday: 0, dashboardUrl: null, topPages: [], dauSeries: [0, 0, 0, 0, 0, 0, 0] });
});

it("usage: a PostHog HTTP error becomes a safe message without the key", async () => {
  posthogEnv();
  fetchStub.mockResolvedValue(json({ detail: `bad ${POSTHOG_KEY}` }, 401));
  const body = await (await usage()).json();
  expect(body).toMatchObject({ state: "error", message: "PostHog did not answer" });
  expect(JSON.stringify(body)).not.toContain(POSTHOG_KEY);
});

it("both routes answer 404 to non-owners and 401 without a session, before any outside call", async () => {
  sentryEnv(); posthogEnv();
  auth.mockResolvedValue({ user: { id: "2", name: "Ann" } });
  expect((await errors()).status).toBe(404);
  expect((await usage()).status).toBe(404);
  auth.mockResolvedValue(null);
  expect((await errors()).status).toBe(401);
  expect((await usage()).status).toBe(401);
  expect(fetchStub).not.toHaveBeenCalled();
});
