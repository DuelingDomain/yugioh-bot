import { AppShell } from "@/components/layout/app-shell";
import { AppRetryPanel } from "@/components/layout/app-retry-panel";
import { ActiveGameGuard } from "@/components/duel/active-game-guard";
import { SignOutProvider } from "@/components/account/sign-out";
import { isE2EAuthEnabled } from "@/lib/e2e-auth";
import { resolveSessionIdentity } from "@/lib/session-identity";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PresenceHeartbeat } from "@/components/account/presence-heartbeat";
export default async function AppLayout({ children }: { children: ReactNode }) {
  const result = await resolveSessionIdentity();
  if (!result.ok && result.status === 401) redirect("/sign-in");
  return (
    <SignOutProvider e2e={isE2EAuthEnabled()}>
      {result.ok && process.env.DISCORD_ONLINE_STATUS_ENABLED === "1" ? <PresenceHeartbeat /> : null}
      <ActiveGameGuard />
      <AppShell>{!result.ok ? <AppRetryPanel /> : children}</AppShell>
    </SignOutProvider>
  );
}
