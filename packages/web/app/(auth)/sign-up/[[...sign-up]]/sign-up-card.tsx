"use client";

import { AccountView } from "@/components/auth/auth-views";
import { useRedirectIfSignedIn } from "@/hooks/use-redirect-if-signed-in";
import { useSignUpFlow } from "@/hooks/use-sign-up-flow";

export function SignUpCard({ ticket, returnTo, marketingUrl }: { ticket: string | null; returnTo: string; marketingUrl: string | null }) {
  const redirecting = useRedirectIfSignedIn(returnTo);
  const flow = useSignUpFlow({ ticket, returnTo });
  // Already signed in: show the "Signing you in" card while the redirect runs, never the form.
  return <AccountView flow={redirecting ? { ...flow, state: { ...flow.state, step: "signing", banner: null, fieldErrors: {} } } : flow} marketingUrl={marketingUrl} />;
}
