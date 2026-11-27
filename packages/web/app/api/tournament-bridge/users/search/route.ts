// Tournament bridge: signed service access; no Clerk session or guild restriction.
import { createTournamentBridgeUsers } from "@yugidraft/shared/tournament-bridge";
import { getDb } from "@/lib/db";
import { authenticateTournamentRequest, tournamentJson } from "@/lib/tournament-bridge";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await authenticateTournamentRequest(request);
  if (auth instanceof Response) return auth;
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const exact = searchParams.get("exact") === "1";
  return tournamentJson({ users: createTournamentBridgeUsers(getDb()).search(query, exact) });
}
