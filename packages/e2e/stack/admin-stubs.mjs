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
    entry.updated_at = Date.now();
    return json(wire(entry));
  }
  // Creator fast-track: Clerk invitations. Calls are kept in memory only (this web process); the spec reads the DB.
  if (pathname === "/v1/invitations" && method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const invitation = { id: `inv_e2e_${invitations.length + 1}`, email_address: body.email_address, status: "pending", body };
    invitations.push(invitation);
    return json({ object: "invitation", id: invitation.id, email_address: invitation.email_address, status: "pending", url: "https://clerk.example.test/v1/tickets/accept?ticket=e2e" });
  }
  const revoke = /^\/v1\/invitations\/([^/]+)\/revoke$/.exec(pathname);
  if (revoke && method === "POST") {
    const invitation = invitations.find((candidate) => candidate.id === decodeURIComponent(revoke[1]));
    if (!invitation) return json({ errors: [{ code: "resource_not_found", message: "Not found" }] }, 404);
    invitation.status = "revoked";
    return json({ object: "invitation", id: invitation.id, email_address: invitation.email_address, status: "revoked" });
  }
  // A waitlist join (for example from a closed /join page) never reaches the real Clerk. It is not added to the
  // pending list, so the admin console counts stay the same for the other specs.
  if (pathname === "/v1/waitlist_entries" && method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return json(wire({ id: `wle_e2e_join_${Date.now()}`, email_address: body.email_address, status: "pending", created_at: Date.now() }));
  }
  return null;
}
/** Clerk invitations made by this web process, oldest first. */
const invitations = [];
const wire = (entry) => ({ object: "waitlist_entry", id: entry.id, email_address: entry.email_address, status: entry.status, created_at: entry.created_at, updated_at: entry.updated_at ?? entry.created_at });

const now = Date.now();
const hour = 3600_000;
/** Sentry's 24 h stats: [unix seconds, events] per hour, oldest first. */
const buckets = (counts) => counts.map((n, i) => [Math.floor((now - (23 - i) * hour) / 1000), n]);
const issues = [
  { id: "9001", shortId: "WEB-1A", title: "TypeError: cannot read properties of undefined (reading 'seat')", culprit: "app/(app)/duels/[slug]/page", level: "error", count: "14", userCount: 3, firstSeen: new Date(now - 5 * hour).toISOString(), lastSeen: new Date(now - 12 * 60_000).toISOString(), permalink: "https://sentry.io/organizations/e2e/issues/9001/", status: "unresolved", project: { slug: "web" },
    stats: { "24h": buckets([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 3, 4, 4]) } },
  { id: "9002", shortId: "WEB-1B", title: "Error: websocket closed before ready", culprit: "lib/duel-socket", level: "warning", count: "4", userCount: 2, firstSeen: new Date(now - 6 * 24 * hour).toISOString(), lastSeen: new Date(now - 3 * hour).toISOString(), permalink: "https://sentry.io/organizations/e2e/issues/9002/", status: "unresolved", project: { slug: "web" },
    stats: { "24h": buckets([0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]) } },
  { id: "9003", shortId: "WEB-1C", title: "SqliteError: database is locked", culprit: "draft-timer", level: "error", count: "6", userCount: 0, firstSeen: new Date(now - 9 * 24 * hour).toISOString(), lastSeen: new Date(now - 5 * hour).toISOString(), permalink: "https://sentry.io/organizations/e2e/issues/9003/", status: "unresolved", project: { slug: "web" },
    stats: { "24h": buckets([0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1, 0, 0]) } },
];
function sentry(url) {
  if (!/\/api\/0\//.test(url.pathname)) return null;
  if (/\/issues\/?$/.test(url.pathname)) return json(issues);
  if (/\/stats_v2\/?$/.test(url.pathname)) return json({ groups: [{ by: {}, totals: { "sum(quantity)": 27 } }] });
  if (/^\/api\/0\/projects\/[^/]+\/[^/]+\/?$/.test(url.pathname)) return json({ id: "4501" });
  return json([]);
}

// HogQL answers by query shape: daily visitors and views, weekly visitors, top pages.
async function posthog(url, init) {
  if (!/^\/api\//.test(url.pathname)) return null;
  if (!/\/query\/?$/.test(url.pathname)) return json({ results: [] });
  const query = String(JSON.parse(String(init?.body ?? "{}"))?.query?.query ?? "");
  if (query.includes("GROUP BY ago")) return json({ results: [[0, 58, 980], [1, 61, 1120], [2, 57, 1040], [3, 52, 930], [4, 39, 610], [5, 48, 860], [6, 41, 720]] });
  if (query.includes("$pathname")) return json({ results: [["/duels/[slug]", 1840], ["/decks/[id]", 1210], ["/draft/[slug]", 760], ["/cubes", 540], ["/dashboard", 480], ["/leaderboard", 395]] });
  return json({ results: [[132]] });
}

/** Returns a Response for a stubbed host, or null so the caller uses the real fetch. */
export async function adminStub(rawUrl, init) {
  const url = new URL(rawUrl);
  if (url.hostname === "api.clerk.com") return clerk(url, init);
  if (url.hostname === "sentry.io" || url.hostname.endsWith(".sentry.io")) return sentry(url, init);
  if (url.hostname.endsWith("posthog.com")) return posthog(url, init);
  return null;
}
