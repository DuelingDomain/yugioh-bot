"use client";

import { useEffect } from "react";

/** Duel room crash screen: shows the error and reports it to the server log. */
export default function DuelRoomError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const details = `${error.name}: ${error.message}\n${error.stack ?? ""}`;

  useEffect(() => {
    console.error(error);
    void fetch("/api/duels/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: window.location.href, message: `${error.name}: ${error.message}`, stack: error.stack ?? "", digest: error.digest ?? "" }),
    }).catch(() => undefined);
  }, [error]);

  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "#0a0b0f", color: "#efe7d5" }}>
      <div style={{ maxWidth: 760, width: "100%", display: "grid", gap: 14 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>The duel room crashed</h1>
        <p style={{ margin: 0, opacity: 0.75 }}>The error was sent to the server log. Copy the text below if you report it.</p>
        <pre style={{ margin: 0, maxHeight: "50dvh", overflow: "auto", padding: 12, borderRadius: 8, background: "#14161d", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{details}</pre>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => reset()}>Try again</button>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(details)}>Copy error</button>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    </div>
  );
}
