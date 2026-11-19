import { ClerkBackendError, createClerkBackend } from "@yugidraft/shared/clerk";
import { recordModAction } from "@yugidraft/shared/discord-admin";
import { report } from "@yugidraft/shared/observability";
import { normalizeJoinEmail } from "@yugidraft/shared/util/join-email";
import { busyResponse, ownerJson, requireOwnerMutation } from "@/lib/admin-console/creators";
import { TOURNAMENT_BRIDGE_START } from "@/lib/auth-return";
import { reserveOwnerSends } from "@/lib/creator-send-limit";
import { getDb } from "@/lib/db";
import { webOrigin } from "@/lib/existing-player";
import { tournamentBridgeConfig } from "@/lib/tournament-bridge";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const owner = await requireOwnerMutation(request, { body: true });
  if (!owner.ok) return owner.response;
  const bridge = tournamentBridgeConfig();
  if (bridge instanceof Response) return bridge;
  const email = normalizeJoinEmail(owner.body.email);
  if (!email) return ownerJson({ error: "invalid_email" }, 400);
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return ownerJson({ error: "clerk_not_configured" }, 503);

  const db = getDb();
  const redirectUrl = new URL("/sign-up", webOrigin());
  redirectUrl.searchParams.set("redirect_url", TOURNAMENT_BRIDGE_START);
  const wait = reserveOwnerSends(1);
  if (wait !== null) return busyResponse(wait);
  const audit = (result: "success" | "denied" | "failure", params: Record<string, unknown>) =>
    recordModAction(db, {
      guildId: process.env.DISCORD_GUILD_ID ?? "", actorSiteUserId: owner.userId,
      action: "tournament.invite", result, params, notifyDiscord: false,
    });

  let invitation;
  try {
    invitation = await createClerkBackend({ secretKey }).createInvitation({
      emailAddress: email, redirectUrl: redirectUrl.toString(), notify: true, expiresInDays: 30,
    });
  } catch (error) {
    if (error instanceof ClerkBackendError) {
      if (error.code === "duplicate_record") {
        audit("denied", { code: "invitation_pending" });
        return ownerJson({ error: "invitation_pending" }, 409);
      }
      if (error.code === "form_identifier_exists" || error.code === "email_address_exists") {
        audit("denied", { code: "existing_account" });
        return ownerJson({ error: "existing_account" }, 409);
      }
      if (error.status === 429) {
        audit("denied", { code: "busy" });
        return busyResponse(Math.max(1, Math.ceil((error.retryAfterMs ?? 60_000) / 1000)));
      }
    }
    audit("failure", { code: "clerk_unavailable" });
    // Clerk error messages can contain the recipient's address.
    report(new Error("Clerk tournament invitation failed"), {
      userId: owner.userId, tags: { route: "tournament-invites" },
      extra: { status: error instanceof ClerkBackendError ? error.status : undefined },
    });
    return ownerJson({ error: "clerk_unavailable" }, 503);
  }
  audit("success", { invitationId: invitation.id });
  return ownerJson({ sent: true }, 201);
}
