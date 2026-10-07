import { randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { createUserService } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { readJsonBody } from "@/lib/bug-reports/read-body";
import { clearRecoveryCookies, IDENTITY_COOKIE, readIdentity, recoveryError, recoveryRateLimit, sameOrigin, signInRecovery } from "@/lib/existing-player";

export const runtime = "nodejs";
const SUPPORT = "Your account needs help linking. Contact support@duelingdomain.com.";
function clerkError(error: unknown): { code?: string; param?: string } {
  const value = error as { errors?: { code?: string; meta?: { paramName?: string; param_name?: string } }[] } | null;
  const first = value?.errors?.[0]; return { code: first?.code, param: first?.meta?.paramName ?? first?.meta?.param_name };
}
function usernameFor(name: string, fallback: string, id: number): string {
  const sanitize = (value: string) => value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
  const stem = sanitize(name) || sanitize(fallback);
  return stem.length >= 4 ? stem : `duelist_${id}`;
}
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return recoveryError("Invalid request origin.", 403);
    const limited = recoveryRateLimit(request, "complete"); if (limited) return limited;
    const proof = readIdentity(request.cookies.get(IDENTITY_COOKIE)?.value);
    if (!proof) return clearRecoveryCookies(recoveryError("Discord sign-in expired. Return to sign in and try again.", 400));
    const body = await readJsonBody(request, 1024);
    if (!body.ok) return recoveryError("Invalid request.", body.response.status);
    const consent = body.value && typeof body.value === "object" && "consent" in body.value ? body.value.consent : undefined;
    if (consent !== true) return recoveryError("Accept the terms and privacy policy to continue.", 400);
    const users = createUserService(getDb());
    const user = users.findById(proof.userId);
    if (!user || user.discordUserId !== proof.discordId || user.clerkUserId !== null) return clearRecoveryCookies(recoveryError(SUPPORT, 409));
    const client = await clerkClient();
    const byEmail = () => client.users.getUserList({ emailAddress: [proof.email], limit: 1 });
    // Even a verified email match is not authorization to enter that account.
    const matches = await byEmail();
    if (matches.data.length || matches.totalCount) return clearRecoveryCookies(recoveryError(SUPPORT, 409));
    const base = usernameFor(user.username, proof.discordUsername, user.id);
    let createdId: string | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      const username = attempt === 0 ? base : `${base}_${randomBytes(4).toString("hex")}`;
      try {
        const created = await client.users.createUser({ emailAddress: [proof.email], username, skipPasswordRequirement: true,
          legalAcceptedAt: new Date(), externalId: String(user.id), privateMetadata: { existingPlayerDiscordId: proof.discordId } });
        createdId = created.id; break;
      } catch (error) {
        const { code, param } = clerkError(error);
        const collision = code === "form_identifier_exists" || code === "form_username_exists";
        if (!collision) throw error;
        if (param && param !== "username") return clearRecoveryCookies(recoveryError(SUPPORT, 409));
        if (!param) { const matches = await byEmail(); if (matches.data.length || matches.totalCount) return clearRecoveryCookies(recoveryError(SUPPORT, 409)); }
        if (attempt === 3) return clearRecoveryCookies(recoveryError(SUPPORT, 409));
      }
    }
    if (!createdId) throw new Error("Clerk account unavailable");
    let claimed = false;
    try { claimed = users.claimExistingDiscordUser(user.id, proof.discordId, createdId); }
    finally {
      if (!claimed) {
        try { await client.users.deleteUser(createdId); }
        catch { console.warn(`[existing-player] users.id=${user.id} Clerk cleanup failed; owner repair required`); }
      }
    }
    if (!claimed) return clearRecoveryCookies(recoveryError(SUPPORT, 409));
    console.info(`[existing-player] users.id=${user.id} linked clerk user`);
    return await signInRecovery(request, createdId);
  } catch { return clearRecoveryCookies(recoveryError("Sign-in is having trouble. Return to sign in and try again.", 503)); }
}
