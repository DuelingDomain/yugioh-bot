"use server";
import { auth as clerkAuth, clerkClient } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { E2E_SESSION_COOKIE, isE2EAuthEnabled } from "./e2e-auth";
export async function handleSignOut() {
  if (isE2EAuthEnabled()) (await cookies()).delete(E2E_SESSION_COOKIE);
  else {
    const { sessionId } = await clerkAuth();
    if (sessionId) await (await clerkClient()).sessions.revokeSession(sessionId);
  }
  redirect("/sign-in");
}
