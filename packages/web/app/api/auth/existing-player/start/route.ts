import type { NextRequest } from "next/server";
import { clearRecoveryCookies, clearTicketCookie, newOAuthProof, pkceChallenge, recoveryError, recoveryRateLimit, recoveryRedirect, setRecoveryCookie, webOrigin } from "@/lib/existing-player";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const limited = recoveryRateLimit(request, "start"); if (limited) return limited;
  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId || !process.env.DISCORD_CLIENT_SECRET) return recoveryError("Discord sign-in is unavailable. Contact support@duelingdomain.com.", 503);
    const proof = newOAuthProof();
    const url = new URL("https://discord.com/oauth2/authorize");
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: `${webOrigin()}/api/auth/callback/discord`, response_type: "code",
      scope: "identify email", prompt: "none", state: proof.state, code_challenge: pkceChallenge(proof.verifier), code_challenge_method: "S256" }).toString();
    const response = recoveryRedirect(url.href);
    clearRecoveryCookies(response); clearTicketCookie(response);
    setRecoveryCookie(response, "oauth", proof);
    return response;
  } catch { return recoveryError("Discord sign-in is unavailable. Try again in a moment.", 503); }
}
