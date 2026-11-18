// Tournament bridge: refresh stored identities, including deletion detection.
import { z } from "zod";
import { createTournamentBridgeUsers } from "@yugidraft/shared/tournament-bridge";
import { getDb } from "@/lib/db";
import { authenticateTournamentRequest, tournamentJson, tournamentJsonBody } from "@/lib/tournament-bridge";

const lookupSchema = z.strictObject({ ids: z.array(z.number().int().positive().safe()).max(500) });
export const runtime = "nodejs";
export async function POST(request: Request) {
  const auth = await authenticateTournamentRequest(request);
  if (auth instanceof Response) return auth;
  const parsed = lookupSchema.safeParse(tournamentJsonBody(auth.rawBody));
  if (!parsed.success) return tournamentJson({ error: "invalid_body" }, 400);
  return tournamentJson(createTournamentBridgeUsers(getDb()).lookup(parsed.data.ids));
}
