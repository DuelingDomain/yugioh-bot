"use client";

import { AccountView } from "@/components/auth/auth-views";
import { useSignUpFlow } from "@/hooks/use-sign-up-flow";

export function SignUpCard({ ticket, returnTo, marketingUrl }: { ticket: string | null; returnTo: string; marketingUrl: string | null }) {
  const flow = useSignUpFlow({ ticket, returnTo });
  return <AccountView flow={flow} marketingUrl={marketingUrl} />;
}
