// Tournament bridge: configuration and signed HTTP boundary, removable with the routes.
import { readTournamentRequest } from "@yugidraft/shared/tournament-bridge";

export function tournamentJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export function tournamentBridgeConfig(): { url: string; secret: string } | Response {
  const configured = process.env.TOURNAMENT_URL?.trim();
  if (!configured) return tournamentJson({ error: "not_found" }, 404);
  const secret = process.env.TOURNAMENT_BRIDGE_SECRET ?? "";
  try {
    const url = new URL(configured);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || secret.length < 32) {
      return tournamentJson({ error: "bridge_unavailable" }, 503);
    }
    return { url: url.origin, secret };
  } catch { return tournamentJson({ error: "bridge_unavailable" }, 503); }
}

export async function authenticateTournamentRequest(request: Request): Promise<{ rawBody: string } | Response> {
  const config = tournamentBridgeConfig();
  if (config instanceof Response) return config;
  const result = await readTournamentRequest(request, config.secret);
  return result.ok ? result : tournamentJson({ error: "unauthorized" }, 401);
}

export function tournamentJsonBody(rawBody: string): unknown {
  try { return JSON.parse(rawBody); } catch { return undefined; }
}
