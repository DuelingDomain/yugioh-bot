"use client";

import { useRef, useState, type ButtonHTMLAttributes } from "react";
import { AlertTriangle, ChevronRight, Flag, Minus, Plus } from "lucide-react";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import { CardArt } from "@/components/decks/card-art";
import { cn } from "@/lib/utils";
import { reportBridge, type ShownBridge } from "./bridges-api";
import { errorText } from "./use-bridges";
import { reportedBridges, rememberReported } from "./bridges-model";
import styles from "./bridges.module.css";

export type CardPropsFor = (card: DeckCardInfo) => ButtonHTMLAttributes<HTMLButtonElement>;

/** The word for how a bridge goes: one way, or both ways. */
export function directionText(bridge: ShownBridge): string {
  return bridge.two_way ? "Two-way" : "One-way";
}

/** The grade as a small badge. The text carries the meaning, the color only helps. */
export function GradeBadge({ bridge }: { bridge: ShownBridge }) {
  return <span className={styles.grade} data-grade={bridge.review.grade} data-testid="bridge-grade">{bridge.grade}</span>;
}

/** The bridge cards as small card images. A card opens the card inspector on hover, like a tile in Suggestions. */
export function Thumbs({ bridge, cards, cardProps, limit = 4 }: { bridge: ShownBridge; cards: ReadonlyMap<number, DeckCardInfo>; cardProps: CardPropsFor; limit?: number }) {
  const shown = bridge.cards.slice(0, limit);
  const more = bridge.cards.length - shown.length;
  return (
    <ul className={styles.thumbs} aria-label="Bridge cards">
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
export function Warnings({ bridge, genesys }: { bridge: ShownBridge; genesys: boolean }) {
  const lines = [...bridge.warnings];
  if (genesys && bridge.genesys_points != null) lines.push(`Needs about ${bridge.genesys_points} Genesys points for its cards.`);
  if (lines.length === 0) return null;
  return (
    <ul className={styles.warnings} aria-label="Warnings">
      {lines.map((line, index) => <li key={`${index}-${line}`}><AlertTriangle size={13} strokeWidth={1.8} aria-hidden /><span>{line}</span></li>)}
    </ul>
  );
}

export function ProsCons({ bridge, clamp }: { bridge: ShownBridge; clamp?: number }) {
  const pros = clamp ? bridge.review.pros.slice(0, clamp) : bridge.review.pros;
  const cons = clamp ? bridge.review.cons.slice(0, clamp) : bridge.review.cons;
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
 * "This bridge doesn't work": a small action, an optional reason, then a thank-you. A bridge is reported once per
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
      <button type="button" className={styles.report} data-testid="bridge-report" onClick={() => setState("form")}>
        <Flag size={12} strokeWidth={1.8} aria-hidden />This bridge doesn&apos;t work
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

/** One bridge in a list: the target, grade, direction, the cards, two good and two bad points, and warnings. */
export function BridgeCard({ bridge, cards, cardProps, genesys, showSource, onOpen }: {
  bridge: ShownBridge;
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
        <span className={styles.titleLine}>
          <strong className={styles.target}>{showSource ? <>{bridge.source}<span className={styles.arrow} aria-hidden> → </span></> : null}{bridge.target}</strong>
          <ChevronRight size={15} strokeWidth={1.8} aria-hidden className={styles.chevron} />
        </span>
        <span className={styles.badges}>
          <GradeBadge bridge={bridge} />
          <span className={styles.way} data-way={bridge.two_way ? "two" : "one"} title={bridge.two_way ? `${bridge.target} also leads back to ${bridge.source}` : `${bridge.source} leads to ${bridge.target}, not back`}>{directionText(bridge)}</span>
        </span>
      </button>
      <Thumbs bridge={bridge} cards={cards} cardProps={cardProps} />
      <ProsCons bridge={bridge} clamp={2} />
      <Warnings bridge={bridge} genesys={genesys} />
      <ReportBridge bridge={bridge} />
    </li>
  );
}
