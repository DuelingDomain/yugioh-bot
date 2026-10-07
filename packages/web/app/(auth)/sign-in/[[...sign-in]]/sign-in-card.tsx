"use client";

import { SignInView } from "@/components/auth/auth-views";
import { useRedirectIfSignedIn } from "@/hooks/use-redirect-if-signed-in";
import { useSignInFlow } from "@/hooks/use-sign-in-flow";

export function SignInCard({ returnTo, marketingUrl }: { returnTo: string; marketingUrl: string | null }) {
  const redirecting = useRedirectIfSignedIn(returnTo);
  const flow = useSignInFlow({ returnTo, marketingUrl });
  // Already signed in: show the "Signing you in" card while the redirect runs, never the form.
  return <SignInView flow={redirecting ? { ...flow, state: { ...flow.state, step: "signing", banner: null, fieldErrors: {} } } : flow} marketingUrl={marketingUrl} />;
}
