"use client";

import { useState, type CSSProperties } from "react";
import { cardArt, isMonsterInfo, type CardInfo } from "./catalog";
import { Icon } from "./icons";
import { BigArt, CardText, PopupFrame, TierChip, type PopAt, type Tier } from "./popup";
import s from "./remote-ui.module.css";

/** One card the table is looking at: from a feed click, the field, or the tray. */
export type Subject = {
  cardId: number; seat: number; ref?: string; name?: string;
  /** null = no decklist to compare with. */
  notInDecklist: boolean | null; addErrors: string[]; via: string;
  /** How sure the reader was when it named this card (feed reads only). */
  tier?: Tier; covered?: boolean; bestMatch?:boolean;
};

function Art({ id }: { id: number }) {
  const [broken, setBroken] = useState(false);
  return <div className={s.dart}>
    {broken ? <div className={`${s.cd} ${s.tEffect}`} style={{ "--h": (id * 47) % 360 } as CSSProperties}><div className={s.art} /></div>
      : <img className={s.artImg} style={{ width: "100%", height: "100%", borderRadius: 6, objectFit: "cover" }} src={cardArt(id, "full")} alt="" onError={() => setBroken(true)} />}
  </div>;
}

function Stats({ info }: { info: CardInfo | undefined }) {
  if (!isMonsterInfo(info)) return null;
  return <div className={`${s.dstat} ${s.num}`}><span><small>ATK</small>{info?.atk ?? "?"}</span><span><small>DEF</small>{info?.def ?? "?"}</span></div>;
}
const meta = (info: CardInfo | undefined) => info ? [info.type, info.attribute, info.level ? `Level ${info.level}` : ""].filter(Boolean).join(" · ") : "Loading card…";

export function DeckBadges({ subject, warning }: { subject: Subject; warning?: string }) {
  return <div className={s.cbadges}>
    {subject.bestMatch ? <span className={`${s.cb} ${s.w}`}>Best match</span> : null}
    {subject.notInDecklist === true ? <span className={`${s.cb} ${s.w}`}><Icon name="warn" />NOT IN DECKLIST</span>
      : subject.notInDecklist === false ? <span className={`${s.cb} ${s.ok}`}><Icon name="check" />IN DECKLIST</span>
      : <span className={s.cb}>NO DECKLIST</span>}
    {warning ? <span className={`${s.cb} ${s.w}`}><Icon name="warn" />{warning}</span> : null}
  </div>;
}

export type CardEdit = {
  faceUp: boolean; zone: string;
  onMove: (zone: string) => void; onFlip: () => void; onRemove: () => void;
};

export type CardActions = {
  canAdd: boolean; adding: boolean; onAdd: () => void;
  canAttack: boolean; attackHint: string; onAttack: () => void;
  onWrong?: () => void; onPin?: () => void;
  /** Opens the deck warning layer. Set only when this card's seat has a live warning. */
  onFlag?: (button: HTMLElement) => void;
  /** Twin edits for a card that is on a field the person may change. */
  edit?: CardEdit;
};

function Actions({ a, subject }: { a: CardActions; subject: Subject }) {
  return <div className={s.dact}>
    {subject.notInDecklist === true && a.canAdd ? <button type="button" className={`${s.btn} ${s.go}`} disabled={a.adding} onClick={a.onAdd}><Icon name="plus" />Add to decklist</button> : null}
    <button type="button" className={s.btn} onClick={a.onAttack} disabled={!a.canAttack} title={a.attackHint}><Icon name="sword" />Attack from here</button>
    {a.onFlag ? <button type="button" className={`${s.btn} ${s.q}`} data-layer-opener onClick={event => a.onFlag?.(event.currentTarget)} data-testid="review-flag"><Icon name="warn" />Deck warning</button> : null}
    {a.edit ? <CardEditRow edit={a.edit} /> : null}
    {a.onWrong ? <button type="button" className={`${s.btn} ${s.q}`} onClick={a.onWrong}>Wrong card?</button> : null}
    {a.onPin ? <button type="button" className={`${s.btn} ${s.q}`} onClick={a.onPin} data-testid="pin-inspector"><Icon name="card" />Pin to inspector</button> : null}
  </div>;
}

const MOVES: { zone: string; label: string }[] = [{ zone: "graveyard", label: "To graveyard" }, { zone: "banished", label: "Banish" }, { zone: "hand", label: "To hand" }];
/** Corrections to the virtual field: the camera is the truth, this only fixes what the table believes. */
function CardEditRow({ edit }: { edit: CardEdit }) {
  return <div className={s.dedit} role="group" aria-label="Fix this card on the virtual field" data-testid="card-edit">
    {MOVES.filter(move => move.zone !== edit.zone).map(move => <button type="button" key={move.zone} className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => edit.onMove(move.zone)}>{move.label}</button>)}
    <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={edit.onFlip}>{edit.faceUp ? "Turn face down" : "Turn face up"}</button>
    <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={edit.onRemove} data-testid="card-remove">Remove</button>
  </div>;
}

/** The identified card, large, beside the card that was clicked on a feed. Same layout as the tray, so the two swap without a jump. */
export function CardPopover({ subject, info, at, warning, actions, onClose }: {
  subject: Subject; info: CardInfo | undefined; at: PopAt; warning?: string; actions: CardActions; onClose: () => void;
}) {
  const name = info?.name ?? subject.name ?? `Card ${subject.cardId}`;
  return <PopupFrame at={at} layer="card" label={`${name}, card details`} testid="card-popover" className={s.bigCard}>
    <button type="button" className={`${s.ibtn} ${s.bclose}`} aria-label="Close card" onClick={onClose}><Icon name="x" /></button>
    <BigArt id={subject.cardId} label={name} />
    <div className={s.bmain}>
      <CardText info={info} name={subject.name} fallbackName={`Card ${subject.cardId}`}>
        <div className={s.bchips}>
          <TierChip tier={subject.tier} />
          {subject.covered ? <span className={`${s.tier} ${s.tierLow}`}>Covered</span> : null}
          <DeckBadges subject={subject} warning={warning} />
        </div>
      </CardText>
      {subject.addErrors.length && subject.notInDecklist ? <p className={s.bnote}>{subject.addErrors[0]}</p> : null}
    </div>
    <div className={s.bbar}><Actions a={actions} subject={subject} /></div>
  </PopupFrame>;
}

/** The same card in the left inspector drawer, with bigger art. */
export function InspectorBody({ subject, info, warning, actions, sourceLine }: {
  subject: Subject | null; info: CardInfo | undefined; warning?: string; actions: CardActions; sourceLine: string;
}) {
  if (!subject) return <p className={s.dempty}>No card selected.<br />Click a card on a camera feed, or press <kbd>F</kbd> over a feed to outline every card.</p>;
  const name = info?.name ?? subject.name ?? `Card ${subject.cardId}`;
  return <div data-testid="inspector-body">
    <Art id={subject.cardId} />
    <h3 className={s.dname} style={{ margin: 0 }}>{name}</h3>
    <p className={s.dmeta}>{meta(info)}</p>
    <Stats info={info} />
    {info?.effectText ? <p className={s.dtxt}>{info.effectText}</p> : null}
    <div className={s.dsrc}>{sourceLine}</div>
    <div className={`${s.dchk} ${subject.notInDecklist ? s.bad : s.ok}`}>
      <DeckBadges subject={subject} warning={warning} />
    </div>
    <Actions a={{ ...actions, onPin: undefined }} subject={subject} />
  </div>;
}
