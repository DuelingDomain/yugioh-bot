/** Reports an effects crash to the web server log (see /api/duels/client-error). */
export function reportDuelClientError(error: unknown, componentStack = ""): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    void fetch("/api/duels/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: window.location.href, message: `${err.name}: ${err.message}`, stack: err.stack ?? "", componentStack }),
    }).catch(() => undefined);
  } catch {
    // reporting must never throw
  }
}

