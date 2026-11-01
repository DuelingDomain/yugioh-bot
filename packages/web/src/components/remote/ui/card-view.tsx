"use client";

import { useState, type CSSProperties } from "react";
import { cardArt, isMonsterInfo, type CardInfo } from "./catalog";
import { Icon } from "./icons";
import s from "./remote-ui.module.css";

/** One card the table is looking at: from a feed click, the field, or the tray. */
export type Subject = {
  cardId: number; seat: number; ref?: string; name?: string;
  /** null = no decklist to compare with. */
  notInDecklist: boolean | null; addErrors: string[]; via: string;
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
    {subject.notInDecklist === true ? <span className={`${s.cb} ${s.w}`}><Icon name="warn" />NOT IN DECKLIST</span>
      : subject.notInDecklist === false ? <span className={`${s.cb} ${s.ok}`}><Icon name="check" />IN DECKLIST</span>
      : <span className={s.cb}>NO DECKLIST</span>}
    {warning ? <span className={`${s.cb} ${s.w}`}><Icon name="warn" />{warning}</span> : null}
  </div>;
}

export type CardActions = {
  canAdd: boolean; adding: boolean; onAdd: () => void;
  canAttack: boolean; attackHint: string; onAttack: () => void;
  onWrong?: () => void; onFull?: () => void;
};

function Actions({ a, subject }: { a: CardActions; subject: Subject }) {
  return <div className={s.dact}>
    {subject.notInDecklist === true && a.canAdd ? <button type="button" className={`${s.btn} ${s.go}`} disabled={a.adding} onClick={a.onAdd}><Icon name="plus" />Add to decklist</button> : null}
    <button type="button" className={s.btn} onClick={a.onAttack} disabled={!a.canAttack} title={a.attackHint}><Icon name="sword" />Attack from here</button>
    {a.onWrong ? <button type="button" className={`${s.btn} ${s.q}`} onClick={a.onWrong}>Wrong card?</button> : null}
    {a.onFull ? <button type="button" className={`${s.btn} ${s.q}`} onClick={a.onFull}><Icon name="card" />Full card</button> : null}
  </div>;
}

/** Small card panel that opens next to a card on a feed. */
export function CardPopover({ subject, info, style, warning, actions, onClose }: {
  subject: Subject; info: CardInfo | undefined; style: CSSProperties; warning?: string; actions: CardActions; onClose: () => void;
}) {
  const name = info?.name ?? subject.name ?? `Card ${subject.cardId}`;
  return <div className={`${s.pop} ${s.cpop} ${s.show}`} data-layer="card" role="dialog" aria-label={`${name}, card details`} style={style} data-testid="card-popover">
    <button type="button" className={`${s.ibtn} ${s.cpclose}`} aria-label="Close card" onClick={onClose}><Icon name="x" /></button>
    <Art id={subject.cardId} />
    <div className={s.cpm}>
      <h2 className={s.dname} style={{ margin: 0 }} data-testid="popover-name">{name}</h2>
      <p className={s.dmeta}>{meta(info)}</p>
      <Stats info={info} />
      <DeckBadges subject={subject} warning={warning} />
    </div>
    <div className={s.cpx}>
      {info?.effectText ? <p className={s.dtxt} style={{ margin: 0 }}>{info.effectText}</p> : null}
      {subject.addErrors.length && subject.notInDecklist ? <p className={s.statline}>{subject.addErrors[0]}</p> : null}
      <Actions a={actions} subject={subject} />
    </div>
  </div>;
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
    <Actions a={{ ...actions, onFull: undefined }} subject={subject} />
  </div>;
}
