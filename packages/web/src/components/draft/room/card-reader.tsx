"use client";

import { memo } from "react";
import { CardImg } from "./card-img";
import { cardText, joinNames, statParts, tint, typeParts, type RoomCard } from "./room-model";

export interface ReaderProps {
  card: RoomCard | null;
  tag: string;
  pickNote?: string | null;
  /** The pick button: hidden while reading a pick from the binder, or when the draft is done. */
  buttonHidden: boolean;
  pickable: boolean;
  /** It is your turn but nothing is chosen. */
  myTurn: boolean;
  waitingOn: string[];
  /** Show the "waiting on" note under the last pick. */
  showWaiting: boolean;
  phone: boolean;
  onPick: () => void;
  onClose: () => void;
}

function Head({ card }: { card: RoomCard }) {
  const stats = statParts(card);
  return (
    <>
      <h2 className="insp-name">{card.name}</h2>
      <p className="insp-type">
        {typeParts(card).map((p, i) => (
          <span key={i}>{p}</span>
        ))}
      </p>
      {stats ? (
        <div className="insp-stats">
          {stats.map(([k, v]) => (
            <span key={k}>
              {k}
              <b>{v}</b>
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

export const CardReader = memo(function CardReader(p: ReaderProps) {
  const { card } = p;
  const t = card ? tint(card) : null;
  return (
    <aside className="insp" aria-live="polite" aria-label="Card reader">
      <button className="sheet-x" type="button" onClick={p.onClose}>
        Close
      </button>
      <div className="insp-head">
        <b>Card</b>
        <span>{p.tag}</span>
      </div>
      <div className="insp-art" data-empty={card ? "false" : "true"}>
        {card ? <CardImg key={card.id} card={card} large /> : <img alt="" />}
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
      <div>
        {card ? (
          p.phone ? null : (
            <Head card={card} />
          )
        ) : (
          <p className="insp-note">
            Point at a card to read it. Click it to stand it up, then click it again or press Enter to pick.
          </p>
        )}
        {p.pickNote ? (
          <p className="insp-note" style={{ marginTop: 10 }}>{p.pickNote}</p>
        ) : null}
        {p.showWaiting && p.waitingOn.length ? (
          <p className="insp-note" style={{ marginTop: 10 }}>
            Waiting on <em>{joinNames(p.waitingOn)}</em>.
          </p>
        ) : null}
      </div>
      <p className="insp-text">{card ? cardText(card) : ""}</p>
      <button className="pick-btn" type="button" hidden={p.buttonHidden} disabled={!p.pickable} onClick={p.onPick}>
        <span>{p.pickable && card ? `Pick ${card.name}` : p.myTurn ? "Choose a card" : "Picked"}</span>
        <kbd>Enter</kbd>
      </button>
      <div className="keys">
        <span>
          <kbd>1</kbd> to <kbd>9</kbd> choose
        </span>
        <span>
          <kbd>Enter</kbd> pick
        </span>
        <span>
          <kbd>/</kbd> search
        </span>
      </div>
    </aside>
  );
});
