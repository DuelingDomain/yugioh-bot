import React from "react";
import { createRoot } from "react-dom/client";
import { AdminConsole } from "../src/components/admin-console/admin-console";
import type { AdminRelease, EmailSendState, ReleaseDraftInput } from "../src/lib/updates/types";
import { releases as published } from "./updates-board-fixtures";

// Test-only page: the real admin console on the Updates view, with the release routes answered by a small in-memory server.
// Query: notconf=1 (email is not set up).
const query = new URLSearchParams(location.search);
const configured = query.get("notconf") !== "1";
const none: EmailSendState = { state: "none", queued: 0, sent: 0, failed: 0, total: 0 };

const store: AdminRelease[] = [
  { ...published[1], status: "published", email: { state: "done", queued: 0, sent: 1198, failed: 3, total: 1201, confirmedAt: "2026-10-24T15:10:00Z" } },
  { ...published[0], status: "published", email: none },
  {
    id: "draft-1", version: "0.2.3", title: "Dueling Domain v0.2.3", major: false, publishedAt: null, status: "draft", email: none,
    highlights: ["New **trailer** window.", "Fewer errors in the deck builder."],
    sections: [{ kind: "new", items: ["New **trailer** window."] }, { kind: "fixes", items: ["Deck builder errors are gone."] }],
  },
];
let polls = 0;

function json(body: unknown, status = 200) { return Response.json(body, { status }); }

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://x.test");
  const path = url.pathname;
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  if (!path.startsWith("/api/admin/console/releases")) return path.startsWith("/api/") ? json({}, 500) : realFetch(input, init);
  await new Promise((r) => setTimeout(r, 60));
  const rest = path.slice("/api/admin/console/releases".length).split("/").filter(Boolean);
  const find = (id: string) => store.find((r) => r.id === id);
  if (rest.length === 0 && method === "GET") {
    // A running send moves on at each list request: queued, sending, done.
    const running = store.find((r) => r.email.state === "queued" || r.email.state === "sending");
    if (running) {
      polls += 1;
      running.email = polls <= 1 ? { state: "queued", queued: 1240, sent: 0, failed: 0, total: 1240, confirmedAt: running.email.confirmedAt }
        : polls === 2 ? { state: "sending", queued: 720, sent: 516, failed: 4, total: 1240, confirmedAt: running.email.confirmedAt }
        : { state: "done", queued: 0, sent: 1236, failed: 4, total: 1240, confirmedAt: running.email.confirmedAt };
    }
    return json({ releases: [...store].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true })), emailConfigured: configured, missingConfig: configured ? [] : ["MAIL_HOST", "MAIL_USER", "MAIL_PASSWORD"] });
  }
  if (rest.length === 0 && method === "POST") {
    const input = body as unknown as ReleaseDraftInput;
    if (store.some((r) => r.version === input.version)) return json({ error: "version_exists" }, 409);
    const created: AdminRelease = { ...input, id: `draft-${store.length + 1}`, publishedAt: null, status: "draft", email: none };
    store.push(created);
    return json(created, 201);
  }
  const release = find(rest[0] ?? "");
  if (!release) return json({ error: "not_found" }, 404);
  if (rest.length === 1 && method === "PATCH") { Object.assign(release, body); return json(release); }
  if (rest[1] === "publish") {
    release.status = "published"; release.publishedAt = "2026-11-05T09:00:00Z";
    if (body.autoEmail) release.email = { state: "queued", queued: 1240, sent: 0, failed: 0, total: 1240 };
    return json({ release });
  }
  if (rest[1] === "email" && rest[2] === "preview") {
    return json({ token: "tok", counts: { members: 1020, invited: 140, waitlist: 80, total: 1240, excluded: [{ reason: "Unsubscribed", count: 31 }, { reason: "No verified email", count: 9 }] }, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
  }
  if (rest[1] === "email" && rest[2] === "send") {
    polls = 0;
    release.email = { state: "queued", queued: 1240, sent: 0, failed: 0, total: 1240, confirmedAt: new Date().toISOString() };
    return json(release.email);
  }
  return json({}, 404);
};
if (!location.hash) location.hash = "#updates";

createRoot(document.getElementById("root")!).render(<AdminConsole />);
