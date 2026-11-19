// Tournament bridge: the member ID is owned here and unique across application users.
import { z } from "zod";
import { createTournamentBridgeUsers, normalizeMemberId } from "@yugidraft/shared/tournament-bridge";
import { getDb } from "@/lib/db";
import { authenticateTournamentRequest, tournamentJson, tournamentJsonBody } from "@/lib/tournament-bridge";

const memberSchema = z.strictObject({ memberId: z.string().nullable() });
export const runtime = "nodejs";
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateTournamentRequest(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const userId = Number(id);
  const parsed = memberSchema.safeParse(tournamentJsonBody(auth.rawBody));
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(userId) || !parsed.success) return tournamentJson({ error: "invalid_body" }, 400);
  const memberId = parsed.data.memberId === null ? null : normalizeMemberId(parsed.data.memberId);
  if (parsed.data.memberId !== null && memberId === null) return tournamentJson({ error: "invalid_member_id" }, 400);
  const result = createTournamentBridgeUsers(getDb()).setMemberId(userId, memberId);
  if (result === "not_found") return tournamentJson({ error: "not_found" }, 404);
  if (result === "taken") return tournamentJson({ error: "member_id_taken" }, 409);
  return tournamentJson(result);
}
