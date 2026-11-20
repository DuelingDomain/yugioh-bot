import type { NextRequest } from "next/server";
import { safeReturnPath } from "@/lib/auth-return";
import { clearRecoveryCookies, clearTicketCookie, discordAuthorizeUrl, newOAuthProof, recoveryRateLimit, recoveryRedirect, setRecoveryCookie } from "@/lib/existing-player";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const limited = recoveryRateLimit(request, "start"); if (limited) return limited;
  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId || !process.env.DISCORD_CLIENT_SECRET) return recoveryRedirect("/sign-in?error=discord_recovery_unavailable");
    const proof = newOAuthProof();
    const requested = request.nextUrl.searchParams.get("redirect_url");
    // Leave room for the rest of the encrypted recovery claims within cookie limits.
    if (requested !== null && Buffer.byteLength(JSON.stringify(requested)) <= 1024) proof.returnTo = safeReturnPath(requested);
    const response = recoveryRedirect(discordAuthorizeUrl(clientId, proof).href);
    clearRecoveryCookies(response); clearTicketCookie(response);
    setRecoveryCookie(response, "oauth", proof);
    return response;
  } catch { return recoveryRedirect("/sign-in?error=discord_recovery_unavailable"); }
}
