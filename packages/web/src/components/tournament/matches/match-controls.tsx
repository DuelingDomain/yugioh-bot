"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { DuelAction, StatusLine, svButtonClass, type SvButtonVariant } from "@/components/sheet";
import { SECTION_IDS } from "../sheet-contracts";
import type { Match } from "../types";
import type { matchView } from "./match-model";
import type { MatchActions } from "./use-match-actions";
import styles from "./matches.module.css";

type Variant = "primary" | "secondary" | "quiet" | "danger";
const VARIANTS: Record<Variant, SvButtonVariant> = { primary: "primary", secondary: "ghost", quiet: "quiet", danger: "danger" };
export function buttonClass(variant: Variant) {
  return svButtonClass(VARIANTS[variant]);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MatchButton({ variant = "secondary", small: _small = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean; children: ReactNode }) {
  return <button type="button" className={buttonClass(variant)} {...props}>{children}</button>;
}

/**
 * Report errors show inline under the row, never in alert(). "My deck" in a message opens the deck
 * panel through `onOpenDeck` when the page has one; otherwise it jumps to the My deck section.
 */
export function MatchError({ error, onOpenDeck }: { error: string | null; onOpenDeck?: () => void }) {
  if (!error) return null;
  const parts = error.split("My deck");
  return (
    <div role="alert" className={styles.error}>
      <StatusLine tone="block">
        {parts.map((part, index) => (
          <span key={index}>{index > 0 && (onOpenDeck
            ? <button type="button" className={`link ${styles.deckLink}`} onClick={onOpenDeck}>My deck</button>
            : <a className="link" href={`#${SECTION_IDS.myDeck}`}>My deck</a>)}{part}</span>
        ))}
      </StatusLine>
    </div>
  );
}

/** The buttons for one match: used by the host drawer's match rows. */
export function MatchControls({ match, view, actions, reportLabel = "Report", reportFirst = false, waitingOn }: {
  match: Match; view: ReturnType<typeof matchView>; actions: MatchActions; small?: boolean; reportLabel?: string; reportFirst?: boolean; waitingOn: string;
}) {
  if (actions.reporting && view.canReport) return <MatchButton variant="quiet" onClick={actions.cancelReport}>Cancel</MatchButton>;
  if (view.canOpen) {
    return <DuelAction kind={view.player ? "open" : "watch"} href={`/duels/${match.series!.currentDuelSlug}`} />;
  }
  const disabled = actions.loading !== null;
  const reportButton = view.canReport && <MatchButton disabled={disabled} onClick={actions.openReport}>{reportLabel}</MatchButton>;
  return (
    <>
      {reportFirst && reportButton}
      {view.canStart && (view.player
        ? <DuelAction kind="start" disabled={disabled} onClick={actions.start} />
        : <MatchButton variant="quiet" disabled={disabled} onClick={actions.start}>Start duel</MatchButton>)}
      {!reportFirst && reportButton}
      {view.canConfirm && (
        <>
          <MatchButton variant="primary" disabled={disabled} onClick={actions.approve}>Confirm</MatchButton>
          <MatchButton variant="danger" disabled={disabled} onClick={actions.deny}>Deny</MatchButton>
        </>
      )}
      {(view.state === "pending" || view.state === "reported") && <span className={styles.waiting}>Waiting on {waitingOn}</span>}
    </>
  );
}
