"use client";

import { AccountView } from "@/components/auth/auth-views";
import { useSsoCallback } from "@/hooks/use-sso-callback";

export function SsoCallbackCard({ marketingUrl }: { marketingUrl: string | null }) {
  const { state, actions, passwordRequired } = useSsoCallback();
  return <AccountView flow={{ state, actions, passwordRequired }} marketingUrl={marketingUrl} callback />;
}
