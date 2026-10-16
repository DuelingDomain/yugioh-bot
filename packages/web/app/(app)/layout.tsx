import { AppShell } from "@/components/layout/app-shell";
import { ActiveGameGuard } from "@/components/duel/active-game-guard";
import type { ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <><ActiveGameGuard /><AppShell>{children}</AppShell></>;
}
