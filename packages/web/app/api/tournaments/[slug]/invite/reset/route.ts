import { tournamentInviteResponse, runTournamentCreatorRoute } from "@/lib/tournament-visibility";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return runTournamentCreatorRoute(params, ({ slug, guildId, userId, privacy }) =>
    tournamentInviteResponse(slug, privacy.resetInvite(slug, guildId, userId)));
}
