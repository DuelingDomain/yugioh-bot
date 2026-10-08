export type RedactedUrl = { host: string; path: string; query: string };
export type NavigationEntry = RedactedUrl & { at: number };

/** Keep destinations and safe markers only. Even error values can contain OAuth secrets. */
export function redactUrl(value: string): RedactedUrl {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported protocol");
    const query = new URLSearchParams();
    if (url.searchParams.get("existing_player") === "1") query.set("existing_player", "1");
    if (url.searchParams.has("error")) query.set("error", "[redacted]");
    return { host: url.host, path: url.pathname, query: query.size ? `?${query}` : "" };
  } catch {
    return { host: "unknown", path: "[invalid URL]", query: "" };
  }
}

/** One hop per trip into discord.com that reaches its authorize page; Discord's own login and consent pages stay in that trip. */
export function countDiscordHops(entries: readonly NavigationEntry[]): number {
  let hops = 0;
  let inTrip = false;
  let counted = false;
  for (const entry of entries) {
    if (entry.host !== "discord.com") { inTrip = false; continue; }
    if (!inTrip) { inTrip = true; counted = false; }
    if (!counted && entry.path === "/oauth2/authorize") { hops += 1; counted = true; }
  }
  return hops;
}

export function formatTimeline(entries: readonly NavigationEntry[], startedAt: number, endedAt: number, baseUrl = "https://app.duelingdomain.com"): string {
  const appHost = new URL(baseUrl).host;
  const label = (host: string) => host === appHost || host === "app.duelingdomain.com" ? "app"
    : host === "clerk.app.duelingdomain.com" ? "clerk" : host === "discord.com" ? "discord" : host;
  const lines = entries.map(entry => `+${((entry.at - startedAt) / 1000).toFixed(2)}s ${label(entry.host)} ${entry.path}${entry.query}`);
  lines.push(`Total: ${((endedAt - startedAt) / 1000).toFixed(2)}s`, `Discord authorize hops: ${countDiscordHops(entries)}`);
  return lines.join("\n");
}
