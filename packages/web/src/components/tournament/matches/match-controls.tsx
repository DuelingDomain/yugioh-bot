"use client";

import Link from "next/link";
import { AlertCircle, Check, Eye, Swords } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { SECTION_IDS } from "../sheet-contracts";
import type { Match } from "../types";
import type { matchView } from "./match-model";
import type { MatchActions } from "./use-match-actions";
import styles from "./matches.module.css";

type Variant = "primary" | "secondary" | "quiet" | "danger";
export function buttonClass(variant: Variant, small = false) {
  return `btn btn-${variant}${small ? " btn-sm" : ""}`;
}

export function MatchButton({ variant = "secondary", small = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean; children: ReactNode }) {
  return <button type="button" className={buttonClass(variant, small)} {...props}>{children}</button>;
}

/** Report errors show inline under the row, never in alert(). */
export function MatchError({ error }: { error: string | null }) {
  if (!error) return null;
  const parts = error.split("My deck");
  return (
    <div role="alert" className={`banner banner-bad ${styles.error}`}>
      <AlertCircle className="ic" aria-hidden="true" />
      <div>
        {parts.map((part, index) => (
          <span key={index}>{index > 0 && <a className="link" href={`#${SECTION_IDS.myDeck}`}>My deck</a>}{part}</span>
        ))}
      </div>
    </div>
  );
}

export function MatchControls({ match, view, actions, small = true, reportLabel = "Report", reportFirst = false, waitingOn }: {
  match: Match; view: ReturnType<typeof matchView>; actions: MatchActions; small?: boolean; reportLabel?: string; reportFirst?: boolean; waitingOn: string;
}) {
  if (actions.reporting && view.canReport) return <MatchButton variant="quiet" small={small} onClick={actions.cancelReport}>Cancel</MatchButton>;
  if (view.canOpen) {
    return (
      <Link href={`/duels/${match.series!.currentDuelSlug}`} className={buttonClass(view.player ? "primary" : "secondary", small)}>
        {view.player ? <Swords className="ic sm" aria-hidden="true" /> : <Eye className="ic sm" aria-hidden="true" />}
        {view.player ? "Open duel" : "Watch"}
      </Link>
    );
  }
  const disabled = actions.loading !== null;
  const reportButton = view.canReport && <MatchButton small={small} disabled={disabled} onClick={actions.openReport}>{reportLabel}</MatchButton>;
  return (
    <>
      {reportFirst && reportButton}
      {view.canStart && (
        <MatchButton variant={view.player ? "primary" : "quiet"} small={small} disabled={disabled} onClick={actions.start}>
          {view.player && <Swords className="ic sm" aria-hidden="true" />}Start duel
        </MatchButton>
      )}
      {!reportFirst && reportButton}
      {view.canConfirm && (
        <>
          <MatchButton variant="primary" small={small} disabled={disabled} onClick={actions.approve}><Check className="ic sm" aria-hidden="true" />Approve</MatchButton>
          <MatchButton variant="danger" small={small} disabled={disabled} onClick={actions.deny}>Deny</MatchButton>
        </>
      )}
      {(view.state === "pending" || view.state === "reported") && <span className="chip chip-gold">Waiting on {waitingOn}</span>}
    </>
  );
}
