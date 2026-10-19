import { AppShell } from "@/components/layout/app-shell";
import { ActiveGameGuard } from "@/components/duel/active-game-guard";
import { EffectSearchProvider } from "@/components/effect-search/capability-context";
import { effectSearchEnabled, deckSuggestionsEnabled } from "@yugidraft/shared/cards/effects/capability";
import { PresenceHeartbeat } from "@/components/account/presence-heartbeat";
import type { ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <>{process.env.PRESENCE_ENABLED !== "0" ? <PresenceHeartbeat /> : null}<ActiveGameGuard /><EffectSearchProvider enabled={effectSearchEnabled()} suggestionsEnabled={deckSuggestionsEnabled()}><AppShell>{children}</AppShell></EffectSearchProvider></>;
}
