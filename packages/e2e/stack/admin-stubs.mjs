// Network-edge stubs for the admin console (E2E_ADMIN_CONSOLE=1). They answer the Clerk waitlist,
// Sentry and PostHog calls of the web process. State lives in this process only, so a restart resets it.

const waitlist = [
  { id: "wle_e2e_1", email_address: "ada@example.test", status: "pending", created_at: Date.now() - 3 * 3600_000 },
  { id: "wle_e2e_2", email_address: "grace@example.test", status: "pending", created_at: Date.now() - 26 * 3600_000 },
  { id: "wle_e2e_3", email_address: "linus@example.test", status: "invited", created_at: Date.now() - 72 * 3600_000 },
];
const json = (body, status = 200) => Response.json(body, { status });

function clerk(url, init) {
  const { pathname, searchParams } = url;
  const method = (init?.method ?? "GET").toUpperCase();
  if (pathname === "/v1/waitlist_entries" && method === "GET") {
    const status = searchParams.get("status");
    const rows = waitlist.filter((entry) => !status || entry.status === status);
    const offset = Number(searchParams.get("offset") ?? 0);
    const limit = Number(searchParams.get("limit") ?? 10);
    return json({ data: rows.slice(offset, offset + limit).map(wire), total_count: rows.length });
  }
  const action = /^\/v1\/waitlist_entries\/([^/]+)\/(invite|reject)$/.exec(pathname);
  if (action && method === "POST") {
    const entry = waitlist.find((candidate) => candidate.id === decodeURIComponent(action[1]));
    if (!entry) return json({ errors: [{ code: "resource_not_found", message: "Not found" }] }, 404);
    entry.status = action[2] === "invite" ? "invited" : "rejected";
    return json(wire(entry));
  }
  return null;
}
const wire = (entry) => ({ object: "waitlist_entry", id: entry.id, email_address: entry.email_address, status: entry.status, created_at: entry.created_at, updated_at: entry.created_at });

const now = Date.now();
const issues = [
  { id: "9001", shortId: "WEB-1A", title: "TypeError: cannot read properties of undefined (reading 'seat')", culprit: "app/(app)/duels/[slug]/page", level: "error", count: "14", userCount: 3, firstSeen: new Date(now - 5 * 3600_000).toISOString(), lastSeen: new Date(now - 12 * 60_000).toISOString(), permalink: "https://sentry.io/organizations/e2e/issues/9001/", status: "unresolved" },
  { id: "9002", shortId: "WEB-1B", title: "Error: websocket closed before ready", culprit: "lib/duel-socket", level: "warning", count: "4", userCount: 2, firstSeen: new Date(now - 20 * 3600_000).toISOString(), lastSeen: new Date(now - 3 * 3600_000).toISOString(), permalink: "https://sentry.io/organizations/e2e/issues/9002/", status: "unresolved" },
];
function sentry(url) {
  if (!/\/api\/0\//.test(url.pathname)) return null;
  if (/\/issues\/?$/.test(url.pathname)) return json(issues);
  if (/\/stats\/?$/.test(url.pathname)) return json([]);
  return json([]);
}

function posthog(url) {
  if (!/^\/api\//.test(url.pathname)) return null;
  if (/\/query\/?$/.test(url.pathname)) return json({ columns: ["name", "count"], results: [["/duels/[slug]", 42], ["/drafts", 17]] });
  return json({ results: [] });
}

/** Returns a Response for a stubbed host, or null so the caller uses the real fetch. */
export async function adminStub(rawUrl, init) {
  const url = new URL(rawUrl);
  if (url.hostname === "api.clerk.com") return clerk(url, init);
  if (url.hostname === "sentry.io" || url.hostname.endsWith(".sentry.io")) return sentry(url, init);
  if (url.hostname.endsWith("posthog.com")) return posthog(url, init);
  return null;
}
