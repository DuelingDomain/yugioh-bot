import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createUserService } from "@yugidraft/shared/services";
import { SignInShell } from "@/components/auth/sign-in-shell";
import { SignInFootLinks, SignInStep } from "@/components/auth/sign-in-step";
import { marketingUrlFromEnv } from "@/lib/auth-page-params";
import { getDb } from "@/lib/db";
import { IDENTITY_COOKIE, readIdentity } from "@/lib/existing-player";
import { WelcomeBackForm } from "./welcome-back-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Welcome back | Dueling Domain", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function WelcomeBackPage() {
  const proof = readIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  if (!proof) redirect("/sign-in");
  const user = createUserService(getDb()).findById(proof.userId);
  if (!user || user.discordUserId !== proof.discordId || user.clerkUserId !== null) redirect("/sign-in");
  return <SignInShell marketingUrl={marketingUrlFromEnv() ?? undefined}>
    <SignInStep eyebrow="Your profile" title={`Welcome back, ${user.displayName}.`} lede="Your Dueling Domain profile is ready." screen="welcome-back" foot={<SignInFootLinks waitlist={false} />}>
      <WelcomeBackForm />
    </SignInStep>
  </SignInShell>;
}
