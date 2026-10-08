"use client";

import * as React from "react";
import { RotateCw } from "lucide-react";
import { SvButton } from "@/components/sheet";
import { useInviteRedeem, waitLine } from "@/lib/hooks/use-invite-redeem";
import { draftInviteApi } from "@/lib/invite-link";
import { DraftFrame } from "./draft-frame";
import styles from "./draft-state.module.css";

/**
 * The `?invite=` landing of /draft/[slug]. It redeems the link before anything protected loads (see
 * `useInviteRedeem` for the order) and mounts the page once that is done. A too-many-tries answer (429) stops and offers
 * a manual retry.
 */
export function DraftInviteGate({ slug, children }: { slug: string; children: React.ReactNode }) {
  const { phase, retry } = useInviteRedeem(draftInviteApi, slug);

  if (phase.step === "ready") return <>{children}</>;
  if (phase.step === "failed") {
    const limited = phase.result.kind === "rate-limited";
    return (
      <DraftFrame title="Draft">
        <div className={styles.state}>
          <p className={styles.code}>{limited ? "Slow down" : "Error"}</p>
          <h2 className={styles.title}>{limited ? "Try again in a moment" : "This invite didn't open"}</h2>
          <p className={styles.text}>{limited ? waitLine(phase.result) : "Nothing was changed. Check your connection and try again."}</p>
          <div className={styles.acts}>
            <SvButton variant="primary" onClick={retry}>
              <RotateCw size={16} aria-hidden="true" />Try again
            </SvButton>
            <SvButton as="a" href="/drafts" variant="ghost">Drafts</SvButton>
          </div>
        </div>
      </DraftFrame>
    );
  }
  return (
    <DraftFrame title="Draft">
      <p className={styles.loading} role="status" aria-label="Loading draft">
        {phase.step === "redeeming" ? "Opening your invite…" : "Loading draft…"}
      </p>
    </DraftFrame>
  );
}
