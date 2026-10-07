import { AppShell } from "@/components/layout/app-shell";
import { resolveSessionIdentity } from "@/lib/session-identity";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
export default async function AppLayout({ children }: { children: ReactNode }) {
  const result = await resolveSessionIdentity();
  if (!result.ok && result.status === 401) redirect("/sign-in");
  return <AppShell>{!result.ok ? <div role="alert">We couldn't load your account. Try again in a moment.</div> : children}</AppShell>;
}
