"use client";

import { useRef, useState, type ButtonHTMLAttributes } from "react";
import { AlertTriangle, ChevronRight, Flag, Minus, Plus } from "lucide-react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import { CardArt } from "@/components/decks/card-art";
import { cn } from "@/lib/utils";
import { reportBridge, type ShownBridge } from "./bridges-api";
import { PathThumbs, pathSteps } from "./bridge-path";
import { cardsState, errorText } from "./use-bridges";
import { reportedBridges, rememberReported } from "./bridges-model";
import styles from "./bridges.module.css";

export type CardPropsFor = (card: DeckCardInfo) => ButtonHTMLAttributes<HTMLButtonElement>;

/** The word for how a bridge goes: one way, or both ways. */
export function directionText(bridge: ShownBridge): string {
  return bridge.two_way ? "Two-way" : "One-way";
}

/** The grade as a small badge. The text carries the meaning, the color only helps. */
export function GradeBadge({ bridge }: { bridge: ShownBridge }) {
  return <GradeTag grade={bridge.tier === "niche" ? "niche" : bridge.review.grade} text={bridge.tier === "niche" ? "Niche" : bridge.grade} />;
}

/** A grade word as a badge. `grade` is the lower-case grade that sets the color; `text` is the word. */
export function GradeTag({ grade, text, testId = "bridge-grade" }: { grade: string; text: string; testId?: string }) {
  return <span className={styles.grade} data-grade={grade} data-testid={testId}>{text}</span>;
}

/** Small card images for a list of passcodes. */
export function CodeThumbs({ codes, label, cards, cardProps, limit = 4 }: { codes: readonly number[]; label: string; cards: ReadonlyMap<number, DeckCardInfo>; cardProps: CardPropsFor; limit?: number }) {
  const shown = codes.slice(0, limit);
  const more = codes.length - shown.length;
  return (
    <ul className={styles.thumbs} aria-label={label}>
      {shown.map((code) => {
        const card = cards.get(code);
        return (
          <li key={code}>
            {card ? (
              <button type="button" className={styles.thumb} aria-label={card.name} title={card.name} {...cardProps(card)}>
                <CardArt code={code} name={card.name} />
              </button>
            ) : (
              <span className={styles.thumb} role="img" aria-label="Card"><CardArt code={code} name="" /></span>
            )}
          </li>
        );
      })}
      {more > 0 ? <li className={styles.thumbMore} aria-label={`${more} more cards`}>+{more}</li> : null}
    </ul>
  );
}

/** Warnings of a bridge: format, lock and points. */
export function Warnings({ bridge, genesys, clamp }: { bridge: ShownBridge; genesys: boolean; clamp?: number }) {
  const all = [...bridge.warnings];
  // The point cost leads: it decides a Genesys deck, so a list never hides it.
  if (genesys && bridge.genesys_points != null) all.unshift(`Needs about ${bridge.genesys_points} Genesys points for its cards.`);
  // A list shows the first warning only; the details show them all.
  const lines = clamp ? all.slice(0, clamp) : all;
  if (lines.length === 0) return null;
  return (
    <ul className={styles.warnings} aria-label="Warnings">
      {lines.map((line, index) => <li key={`${index}-${line}`} title={line}><AlertTriangle size={13} strokeWidth={1.8} aria-hidden /><span>{line}</span></li>)}
    </ul>
  );
}

export function ProsCons({ bridge, clamp }: { bridge: ShownBridge; clamp?: number }) {
  return <Points pros={bridge.review.pros} cons={bridge.review.cons} clamp={clamp} />;
}

/** The good and bad points, as two short lists. */
export function Points({ pros: allPros, cons: allCons, clamp }: { pros: readonly string[]; cons: readonly string[]; clamp?: number }) {
  const pros = clamp ? allPros.slice(0, clamp) : allPros;
  const cons = clamp ? allCons.slice(0, clamp) : allCons;
  return (
    <div className={styles.points} data-clamped={clamp ? "" : undefined}>
      <ul className={styles.pros} aria-label="Good">
        {pros.map((text) => <li key={text} title={text}><Plus size={12} strokeWidth={2.2} aria-hidden /><span>{text}</span></li>)}
      </ul>
      <ul className={styles.cons} aria-label="Bad">
        {cons.map((text) => <li key={text} title={text}><Minus size={12} strokeWidth={2.2} aria-hidden /><span>{text}</span></li>)}
      </ul>
    </div>
  );
}

type ReportState = "idle" | "form" | "sending" | "thanks";

/**
 * "Report": a small flag action (a bridge that is wrong), an optional reason, then a thank-you. A bridge is reported once per
 * user (the host keeps that rule too); this browser remembers it, so the form does not come back after a reload.
 */
export function ReportBridge({ bridge }: { bridge: ShownBridge }) {
  const [state, setState] = useState<ReportState>(() => (reportedBridges().has(bridge.evidence_hash) ? "thanks" : "idle"));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const sending = useRef(false);

  async function send() {
    if (sending.current) return;
    sending.current = true;
    setState("sending");
    setError(null);
    try {
      const answer = await reportBridge(bridge.evidence_hash, reason);
      rememberReported(bridge.evidence_hash);
      setHidden(answer.hidden);
      setState("thanks");
    } catch (failure) {
      setError(errorText(failure));
      setState("form");
    } finally {
      sending.current = false;
    }
  }

  if (state === "thanks") {
    return <p className={styles.thanks} role="status" data-testid="bridge-thanks">{hidden ? "Thank you. This bridge is hidden until we check it." : "Thank you. We will check this bridge."}</p>;
  }
  if (state === "idle") {
    return (
      <button type="button" className={styles.report} data-testid="bridge-report" aria-label="Report a wrong bridge" title="Report a wrong bridge" onClick={() => setState("form")}>
        <Flag size={12} strokeWidth={1.8} aria-hidden />Report
      </button>
    );
  }
  const busy = state === "sending";
  return (
    <form className={styles.reportForm} data-testid="bridge-report-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <label className={styles.reportLabel}>
        <span>What went wrong? (optional)</span>
        <textarea className={cn("input", styles.reportText)} rows={2} maxLength={512} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} />
      </label>
      {error ? <p className={styles.reportError} role="alert">{error}</p> : null}
      <div className={styles.reportActions}>
        <button type="submit" className="btn btn-secondary btn-sm" disabled={busy} aria-busy={busy || undefined}>{busy ? "Sending…" : "Send"}</button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => { setState("idle"); setError(null); }}>Cancel</button>
      </div>
    </form>
  );
}

/** One bridge in a list: the target, grade, direction, the path as card images, two good and two bad points, and a warning. */
export function BridgeCard({ bridge, mode, cards, cardProps, genesys, showSource, onOpen }: {
  bridge: ShownBridge;
  mode: DuelMode;
  cards: ReadonlyMap<number, DeckCardInfo>;
  cardProps: CardPropsFor;
  genesys: boolean;
  /** Two-archetype search: name both ends, since the list holds both directions. */
  showSource?: boolean;
  onOpen: (bridge: ShownBridge) => void;
}) {
  const title = showSource ? `${bridge.source} to ${bridge.target}` : bridge.target;
  return (
    <li className={styles.item} data-grade={bridge.review.grade} data-testid="bridge-item">
      <button type="button" className={styles.open} data-bridge={bridge.evidence_hash} aria-label={`${title}. ${bridge.grade}, ${directionText(bridge).toLowerCase()}. Open details`} onClick={() => onOpen(bridge)}>
        <strong className={styles.target}>{showSource ? <>{bridge.source}<span className={styles.arrow} aria-hidden> → </span></> : null}{bridge.target}</strong>
        <span className={styles.openHint}>Details<ChevronRight size={15} strokeWidth={1.8} aria-hidden className={styles.chevron} /></span>
      </button>
      <div className={styles.meta}>
        <GradeBadge bridge={bridge} />
        <span className={styles.way} data-way={bridge.two_way ? "two" : "one"} title={bridge.two_way ? `${bridge.target} also leads back to ${bridge.source}` : `${bridge.source} leads to ${bridge.target}, not back`}>{directionText(bridge)}</span>
        <ReportBridge bridge={bridge} />
      </div>
      <PathThumbs steps={pathSteps(bridge, cards, cardsState(bridge.cards, mode))} cardProps={cardProps} />
      <ProsCons bridge={bridge} clamp={2} />
      <Warnings bridge={bridge} genesys={genesys} clamp={1} />
    </li>
  );
}
