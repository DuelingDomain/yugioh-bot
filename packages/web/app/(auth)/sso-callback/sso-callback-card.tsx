"use client";

import { AccountView } from "@/components/auth/auth-views";
import { useSsoCallback } from "@/hooks/use-sso-callback";

export function SsoCallbackCard({ marketingUrl }: { marketingUrl: string | null }) {
  const { state, actions } = useSsoCallback();
  return <AccountView flow={{ state, actions }} marketingUrl={marketingUrl} callback />;
}
