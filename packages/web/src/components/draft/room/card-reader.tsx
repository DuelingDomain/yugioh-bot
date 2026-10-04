"use client";

import { memo } from "react";
import { CardImg } from "./card-img";
import { cardText, joinNames, statParts, tint, typeLine, type RoomCard } from "./room-model";

/** What the dock's small label says about the card it shows. */
export const TAG_POINTING = "Pointing at";
export const TAG_CHOSEN = "Chosen";
export const TAG_PICKED = "Your pick";

export interface ReaderProps {
  /** The card on show: the one under the pointer, else the chosen one, else your last pick. */
  card: RoomCard | null;
  tag: string;
  pickNote?: string | null;
  /** The pick button is hidden once the draft is done. */
  buttonHidden: boolean;
  /** A card is chosen and can be picked. The button always follows the chosen card, never the one under the pointer. */
  pickable: boolean;
  /** The chosen card, whose name the button carries. */
  chosen: RoomCard | null;
  /** Set when the chosen card cannot be picked: the reason, e.g. "You have 3". */
  blockedNote?: string | null;
  /** It is your turn but nothing is chosen. */
  myTurn: boolean;
  waitingOn: string[];
  /** Show the "waiting on" note under the last pick. */
  showWaiting: boolean;
  phone: boolean;
  onPick: () => void;
  onClose: () => void;
}

/**
 * Name, type line and the stats row. The stats row is always there, empty for a Spell or Trap,
 * so the dock below it keeps its place when the pointer moves from a monster to a spell.
 */
function Head({ card }: { card: RoomCard | null }) {
  const stats = card ? statParts(card) : null;
  return (
    <div className="insp-main" aria-hidden={card ? undefined : true}>
      {card ? <h2 className="insp-name">{card.name}</h2> : <p className="insp-name" />}
      <p className="insp-type">{card ? typeLine(card) : ""}</p>
      <div className="insp-stats" data-empty={stats ? undefined : ""}>
        {stats?.map(([k, v]) => (
          <span key={k}>
            {k}
            <b>{v}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export const CardReader = memo(function CardReader(p: ReaderProps) {
  const { card } = p;
  const t = card ? tint(card) : null;
  const label =
    p.pickable && p.chosen ? `Pick ${p.chosen.name}` : p.blockedNote ? p.blockedNote : p.myTurn ? "Choose a card" : "Picked";
  return (
    <aside className="insp" aria-live="polite" aria-label="Card reader">
      <button className="sheet-x" type="button" onClick={p.onClose}>
        Close
      </button>
      <div className="insp-head" data-tag={p.tag === TAG_CHOSEN ? "chosen" : undefined}>
        <span>{p.tag}</span>
      </div>
      <div className="insp-art" data-empty={card ? "false" : "true"}>
        {card ? <CardImg key={card.id} card={card} large eager /> : <img alt="" />}
      </div>
      <div className="insp-mini">
        <div
          className="portrait"
          style={t ? ({ "--h-hi": t.hi, "--h-main": t.main } as React.CSSProperties) : undefined}
        >
          <div className="pf">
            {card ? <CardImg key={card.id} card={card} large crop /> : <img alt="" />}
            <i className="tint" />
            <i className="scan" />
            <i className="sweep" />
            <i className="rim" />
          </div>
        </div>
        <div>{card ? <Head card={card} /> : null}</div>
      </div>
      <div className="insp-info">
        {p.phone ? null : <Head card={card} />}
        {p.pickNote ? <p className="insp-note">{p.pickNote}</p> : null}
        {p.showWaiting && p.waitingOn.length ? (
          <p className="insp-note">
            Waiting on <em>{joinNames(p.waitingOn)}</em>.
          </p>
        ) : null}
      </div>
      <p className="insp-text" data-hint={card ? undefined : ""}>
        {card
          ? cardText(card)
          : p.myTurn
            ? "Point at a card to read it. Click it to choose it, then press Enter or use the Pick button."
            : "Waiting for the table."}
      </p>
      <div className="insp-act">
        <button className="pick-btn" type="button" hidden={p.buttonHidden} disabled={!p.pickable} onClick={p.onPick}>
          <span>{label}</span>
          <kbd>Enter</kbd>
        </button>
        <div className="keys">
          <span>
            <kbd>1</kbd> to <kbd>9</kbd> or arrows choose
          </span>
          <span>
            <kbd>/</kbd> search
          </span>
        </div>
      </div>
    </aside>
  );
});
