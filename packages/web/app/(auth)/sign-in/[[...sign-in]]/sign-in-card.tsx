"use client";

import { SignInView } from "@/components/auth/auth-views";
import { useSignInFlow } from "@/hooks/use-sign-in-flow";

export function SignInCard({ returnTo, marketingUrl }: { returnTo: string; marketingUrl: string | null }) {
  const flow = useSignInFlow({ returnTo, marketingUrl });
  return <SignInView flow={flow} marketingUrl={marketingUrl} />;
}
