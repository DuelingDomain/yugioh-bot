"use client";

import * as React from "react";
import { useInviteRedeem, waitLine } from "@/lib/hooks/use-invite-redeem";
import { tournamentInviteApi } from "@/lib/invite-link";
import { TournamentGate } from "./sheet/tournament-gate";

/**
 * The `?invite=` landing of /tournament/[slug]. The page is a client page that reads the tournament and opens its
 * live connection as soon as it mounts, so it is mounted only after the link is redeemed (`useInviteRedeem` has the
 * order). Until then nothing protected is requested, and nothing about the tournament is on screen. A 429 stops and
 * offers a manual retry.
 */
export function TournamentInviteGate({ slug, children }: { slug: string; children: React.ReactNode }) {
  const { phase, retry } = useInviteRedeem(tournamentInviteApi, slug);

  if (phase.step === "ready") return <>{children}</>;
  if (phase.step === "failed") {
    return phase.result.kind === "rate-limited"
      ? <TournamentGate kind="invite-limited" wait={waitLine(phase.result)} onRetry={retry} />
      : <TournamentGate kind="invite-error" onRetry={retry} />;
  }
  return <TournamentGate kind={phase.step === "redeeming" ? "opening" : "loading"} />;
}
