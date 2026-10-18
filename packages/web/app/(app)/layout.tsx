import { AppShell } from "@/components/layout/app-shell";
import { ActiveGameGuard } from "@/components/duel/active-game-guard";
import { EffectSearchProvider } from "@/components/effect-search/capability-context";
import { effectSearchEnabled } from "@yugidraft/shared/cards/effects/capability";
import type { ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <><ActiveGameGuard /><EffectSearchProvider enabled={effectSearchEnabled()}><AppShell>{children}</AppShell></EffectSearchProvider></>;
}
