import "../app/globals.css";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DuelRoomView } from "@/components/duel/room";

// Test-only page for spectator-series.playwright.ts: the real duel room at /duels/<slug>, nothing else.
// The build swaps in small stand-ins for Next's router, Link, Image and fonts, and for the socket
// transport (see the plugin in the Playwright script). Everything the room shows comes from the real
// component fed by the mocked /api/duels/<slug>.

function slugFromPath(): string {
  return decodeURIComponent(window.location.pathname.split("/")[2] ?? "");
}

function App() {
  const [slug, setSlug] = useState(slugFromPath);
  useEffect(() => {
    const follow = () => setSlug(slugFromPath());
    window.addEventListener("harness:navigate", follow);
    window.addEventListener("popstate", follow);
    return () => {
      window.removeEventListener("harness:navigate", follow);
      window.removeEventListener("popstate", follow);
    };
  }, []);
  // A player plays in the duel window (/duels/<slug>?window=1), as the app's page passes `windowed`.
  return <DuelRoomView slug={slug} windowed={new URLSearchParams(window.location.search).get("window") === "1"} />;
}

createRoot(document.getElementById("root")!).render(<App />);
