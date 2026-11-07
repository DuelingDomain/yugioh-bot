import { tournamentRemoteResultRequest, type TournamentRemoteResultContext } from "@/lib/tournament-remote-results";

export const runtime = "nodejs";

export function POST(request:Request, context:TournamentRemoteResultContext) {
  return tournamentRemoteResultRequest(request,context,"confirm");
}
