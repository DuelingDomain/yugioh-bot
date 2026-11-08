import { tournamentRemoteResultRequest, type TournamentRemoteResultContext } from "@/lib/tournament-remote-results";

export const runtime = "nodejs";

export function GET(request:Request, context:TournamentRemoteResultContext) {
  return tournamentRemoteResultRequest(request,context,"get");
}
