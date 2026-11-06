import React from "react";
import { createRoot } from "react-dom/client";
import { BugReportFab } from "../src/components/bug-report/bug-report-fab";
import { BugFabLift } from "../src/components/bug-report/fab-lift";
import { releases } from "./updates-board-fixtures";

// Test-only page: the real chip and panels in the real dock, with the releases API answered from a fixture.
// Query: seen=<version> (the last version this person saw), api=fail, modal=1 (another dialog is open), bar=1 (a sticky bottom bar).
const query = new URLSearchParams(location.search);
const seen = query.get("seen");
const posts: string[] = [];
declare global { interface Window { __seenPosts: string[] } }
window.__seenPosts = posts;

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith("/api/releases")) {
    if (query.get("api") === "fail") return new Response("{}", { status: 500 });
    return Response.json({ releases, lastSeenVersion: seen });
  }
  if (url.endsWith("/api/releases/seen")) {
    posts.push((JSON.parse(String(init?.body ?? "{}")) as { version: string }).version);
    return Response.json({ lastSeenVersion: posts[posts.length - 1] });
  }
  return realFetch(input, init);
};

const filler = Array.from({ length: 18 }, (_, i) => <p key={i} style={{ margin: "0 0 14px", color: "#958f81" }}>Page content line {i + 1}</p>);

function Page() {
  return (
    <>
      <header style={{ position: "sticky", top: 0, zIndex: 5, height: 68, display: "flex", alignItems: "center", padding: "0 24px", background: "#050811", borderBottom: "1px solid #3a3426" }}>
        <b style={{ font: "600 22px Arial" }}>Dashboard</b>
        <span style={{ marginLeft: "auto" }}><button type="button" style={{ height: 36, padding: "0 14px", background: "#5733d1", color: "#fff", border: 0, borderRadius: 8 }}>Create game</button></span>
      </header>
      <main style={{ padding: 24 }}>{filler}</main>
      {query.get("bar") === "1" ? <BugFabLift style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: 64, background: "#0a1120", borderTop: "1px solid #3a3426", zIndex: 30 }} /> : null}
      {query.get("modal") === "1" ? <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgb(0 0 0 / .6)" }}>Another dialog</div> : null}
      <BugReportFab />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);
