"use server";

import { AuthError } from "next-auth";
import { redirect, unstable_rethrow } from "next/navigation";
import { signIn } from "@/lib/auth";

/** The sign-in form's server action. */
export async function signInWithDiscord(): Promise<void> {
  try {
    await signIn("discord", { redirectTo: "/dashboard" });
  } catch (error) {
    // Next's own redirect (and notFound and friends) must get through.
    unstable_rethrow(error);
    if (error instanceof AuthError) redirect("/login?error=Configuration");
    throw error;
  }
}
