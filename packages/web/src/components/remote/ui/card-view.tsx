"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { ZoneKey } from "./model";
import { cardArt, hasBattleStats, isLinkInfo, useCardStatus, type CardInfo } from "./catalog";
import { Icon } from "./icons";
import { BigArt, CardText, PopupFrame, TierChip, type PopAt, type Tier } from "./popup";
import s from "./remote-ui.module.css";
import z from "./zone-rules.module.css";
import { cardTypeLine } from "@/lib/remote/field-legality";

/** Where the person opened this card. A camera click only looks at the card; the board, a pile and the hand keep their controls. */
export type CardSource = "camera" | "board" | "pile" | "hand";

/** One card the table is looking at: from a feed click, the field, or the tray. */
export type Subject = {
  from: CardSource;
  cardId: number; seat: number; ref?: string; name?: string;
  /** null = no decklist to compare with. */
  notInDecklist: boolean | null; addErrors: string[]; via: string;
  /** How sure the reader was when it named this card (feed reads only). */
  tier?: Tier; covered?: boolean; bestMatch?:boolean; revealed?:boolean;
  /** From this browser's Tap to identify memory: only this player sees it, and it offers only "Wrong card?". */
  remembered?: boolean; rememberedAt?: number;
};

function Art({ id }: { id: number }) {
  const [broken, setBroken] = useState(false);
  return <div className={s.dart}>
    {broken ? <div className={`${s.cd} ${s.tEffect}`} style={{ "--h": (id * 47) % 360 } as CSSProperties}><div className={s.art} /></div>
      : <img className={s.artImg} style={{ width: "100%", height: "100%", borderRadius: 6, objectFit: "cover" }} src={cardArt(id, "full")} alt="" onError={() => setBroken(true)} />}
  </div>;
}

function Stats({ info }: { info: CardInfo | undefined }) {
  if (!hasBattleStats(info)) return null;
  return <div className={`${s.dstat} ${s.num}`}><span><small>ATK</small>{info?.atk ?? "?"}</span>{isLinkInfo(info) ? null : <span><small>DEF</small>{info?.def ?? "?"}</span>}</div>;
}
/** Full type from the shared card-facts resolver ("Field Spell", "Link-2 Monster"); Level only for non-Link monsters. */
const meta = (info: CardInfo | undefined) => info ? [cardTypeLine(info), info.attribute, info.level && !/spell|trap/i.test(info.type) && info.frameType !== "link" && !/link/i.test(info.type) ? `Level ${info.level}` : ""].filter(Boolean).join(" · ") : "Loading card…";

export function DeckBadges({ subject, warning }: { subject: Subject; warning?: string }) {
  return <div className={s.cbadges}>
    {subject.revealed ? <span className={s.cb}>Revealed</span> : null}
    {subject.bestMatch ? <span className={`${s.cb} ${s.w}`}>Best match</span> : null}
    {subject.notInDecklist === true ? <span className={`${s.cb} ${s.w}`}><Icon name="warn" />NOT IN DECKLIST</span>
      : subject.notInDecklist === false ? <span className={`${s.cb} ${s.ok}`}><Icon name="check" />IN DECKLIST</span>
      : <span className={s.cb}>NO DECKLIST</span>}
    {warning ? <span className={`${s.cb} ${s.w}`}><Icon name="warn" />{warning}</span> : null}
  </div>;
}

export type CardEdit = {
  faceUp: boolean; zone: string; extraZones?: boolean;
  /** The slot in its zone and a move to another cell of the same row, for when the board is hidden. */ slot?: number; onCell: (key: ZoneKey) => void;
  onMove: (zone: string) => void; onFlip: () => void; onRemove: () => void; onNotACard?: () => void;
  /** Battle position of a face-up card in a Monster Zone (any card there, a Trap Monster too). Absent elsewhere. */
  position?: { defense: boolean; onTurn: () => void };
  /** "Equipped to": link a face-up Spell/Trap Zone card to the monster it equips. Keys are `seat:ref`. */
  equip?: { current?: string; options: { key: string; label: string }[]; onEquip: (key: string | null) => void };
};

/** One Xyz material under the open card. `onDetach` is set for the owner only. */
export type CardMaterial = { ref: string; cardId?: number; name: string; onDetach?: () => void };

export type CardActions = {
  /** Xyz materials under this card, bottom first. */
  materials?: CardMaterial[];
  canAdd: boolean; adding: boolean; onAdd: () => void;
  canAttack: boolean; attackHint: string; onAttack: () => void;
  onActivate?: () => void; onReveal?: () => void;
  /** Take control of an opponent's card, or return a taken card to its owner. */
  control?: { label: string; onClick: () => void };
  onWrong?: () => void; onPin?: () => void;
  /** A remembered card: read the camera again. */
  onReadAgain?: () => void;
  /** Opens the card search; the chosen card goes to the hand (hand.add). */
  onAddToHand?: () => void;
  /** Opens the deck warning layer. Set only when this card's seat has a live warning. */
  onFlag?: (button: HTMLElement) => void;
  /** Twin edits for a card that is on a field the person may change. */
  edit?: CardEdit;
  /** Why the board marks this card "Check zone?" (docs/remote-duels/zone-rules.md). The card is never moved for it. */
  zoneCheck?: string;
  /**
   * "Undo last change to this card": a targeted undo of the newest own action on this card. `reason` is why the server
   * would refuse it now (shown under the button).
   */
  undo?: { label: string; reason?: string; onUndo: () => void };
};

function MaterialList({ items }: { items: CardMaterial[] }) {
  return <div className={s.mats} role="group" aria-label="Xyz materials" data-testid="card-materials">
    <p>{items.length} MATERIAL{items.length === 1 ? "" : "S"}</p>
    {items.map(item => <div key={item.ref} className={s.mat} data-testid="card-material">
      {item.cardId ? <img src={cardArt(item.cardId, "small")} alt="" loading="lazy" draggable={false} /> : <i className={s.matBack} />}
      <span title={item.name}>{item.name}</span>
      {item.onDetach ? <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={item.onDetach} data-testid="detach-material" title="Send this material to the Graveyard">Detach</button> : null}
    </div>)}
  </div>;
}

const BTN = `${s.btn} ${s.sm} ${s.q}`;
const readAge = (at = Date.now()) => { const minutes = Math.floor((Date.now() - at) / 60_000); return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`; };

/** One titled group of controls. The small label gives the context, so the buttons can stay short. */
function Group({ label, testid, children }: { label: string; testid?: string; children: ReactNode }) {
  return <div className={s.dgrp} role="group" aria-label={label} data-testid={testid}>
    <span className={s.dglab} aria-hidden="true">{label}</span>
    <div className={s.dgrow}>{children}</div>
  </div>;
}

function ZoneCheck({ reason }: { reason: string }) {
  return <p className={z.reason} data-testid="zone-check-reason"><b>Check zone?</b> {reason} The card stays here; move it if the zone is wrong.</p>;
}

function Actions({ a, subject }: { a: CardActions; subject: Subject }) {
  const addToDeck = subject.notInDecklist === true && a.canAdd;
  const edit = a.edit;
  return <div className={s.dact}>
    {a.materials?.length ? <MaterialList items={a.materials} /> : null}
    {a.zoneCheck ? <ZoneCheck reason={a.zoneCheck} /> : null}
    <Group label="Actions">
      {addToDeck ? <button type="button" className={BTN} disabled={a.adding} onClick={a.onAdd}>Add to decklist</button> : null}
      {a.onActivate ? <button type="button" className={BTN} onClick={a.onActivate}>Activate</button> : null}
      {a.onAddToHand ? <button type="button" className={BTN} onClick={a.onAddToHand} data-testid="add-to-hand">Add card to hand{"\u2026"}</button> : null}
      {a.onReveal ? <button type="button" className={BTN} onClick={a.onReveal}>Reveal card</button> : null}
      {a.control ? <button type="button" className={BTN} onClick={a.control.onClick} data-testid="card-control">{a.control.label}</button> : null}
      <button type="button" className={BTN} onClick={a.onAttack} disabled={!a.canAttack} title={a.attackHint}>Attack from here</button>
    </Group>
    {edit ? <MoveGroup edit={edit} /> : null}
    <Group label="Card">
      {edit ? <button type="button" className={BTN} onClick={edit.onFlip}>{edit.faceUp ? "Turn face down" : "Turn face up"}</button> : null}
      {edit?.position ? <button type="button" className={BTN} onClick={edit.position.onTurn} data-testid="card-position">{edit.position.defense ? "Change to Attack" : "Change to Defense"}</button> : null}
      {a.undo ? <button type="button" className={`${BTN} ${a.undo.reason ? s.cblocked : ""}`} aria-disabled={!!a.undo.reason} aria-describedby={a.undo.reason ? "card-undo-reason" : undefined}
        onClick={a.undo.onUndo} data-testid="card-undo" title={a.undo.label}>Undo last change</button> : null}
      {a.onWrong ? <button type="button" className={BTN} onClick={a.onWrong}>Wrong card?</button> : null}
      {a.onPin ? <button type="button" className={BTN} onClick={a.onPin} data-testid="pin-inspector">Pin to inspector</button> : null}
      {a.onFlag ? <button type="button" className={BTN} data-layer-opener onClick={event => a.onFlag?.(event.currentTarget)} data-testid="review-flag"><Icon name="warn" />Deck warning</button> : null}
      {a.undo?.reason ? <small className={s.cureason} id="card-undo-reason" data-testid="card-undo-reason">{a.undo.reason}</small> : null}
      {edit?.equip ? <label className={z.equipPick}>Equipped to
        <select value={edit.equip.current ?? ""} onChange={event => edit.equip!.onEquip(event.target.value || null)} data-testid="card-equip">
          <option value="">No monster</option>
          {edit.equip.options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select></label> : null}
    </Group>
  </div>;
}

const MOVES: { zone: string; label: string; mr5?: boolean }[] = [{ zone: "monster", label: "Monster" }, { zone: "extra-monster", label: "Extra Monster", mr5: true }, { zone: "spell-trap", label: "Spell/Trap" },
  { zone: "pendulum", label: "Pendulum", mr5: true }, { zone: "hand", label: "Hand" }, { zone: "graveyard", label: "Graveyard" }, { zone: "banished", label: "Banish" }];
/** Corrections to the virtual field: the camera is the truth, this only fixes what the table believes. */
function MoveGroup({ edit }: { edit: CardEdit }) {
  return <Group label="Move to" testid="card-edit">
    {MOVES.filter(move => move.zone !== edit.zone && (!move.mr5 || edit.extraZones)).map(move => <button type="button" key={move.zone} className={BTN} onClick={() => edit.onMove(move.zone)}>{move.label}</button>)}
    <i className={s.dgbreak} />
    {edit.zone === "monster" || edit.zone === "spell-trap" ? [1, 2, 3, 4, 5].map(n => { const label = `${edit.zone === "monster" ? "M" : "S"}${n}`;
      return <button type="button" key={label} className={BTN} disabled={edit.slot === n} data-testid={`card-cell-${label}`} aria-label={`Move to ${label}`} onClick={() => edit.onCell(`${edit.zone === "monster" ? "m" : "s"}${n}` as ZoneKey)}>{label}</button>; }) : null}
    <button type="button" className={`${BTN} ${s.dremove}`} onClick={edit.onRemove} data-testid="card-remove">Remove</button>
    {edit.onNotACard?<button type="button" className={`${BTN} ${s.dremove}`} onClick={edit.onNotACard} data-testid="card-not-a-card">Not a card</button>:null}
  </Group>;
}

/** The identified card, large, beside the card that was clicked on a feed. Same layout as the tray, so the two swap without a jump. */
export function CardPopover({ subject, info, at, warning, actions, onClose }: {
  subject: Subject; info: CardInfo | undefined; at: PopAt; warning?: string; actions: CardActions; onClose: () => void;
}) {
  const name = info?.name ?? subject.name ?? `Card ${subject.cardId}`;
  const viewOnly = subject.from === "camera";
  return <PopupFrame at={at} layer="card" label={`${name}, card details`} testid="card-popover" className={`${s.bigCard} ${subject.from === "pile" ? s.fromPile : ""}`}>
    <button type="button" className={`${s.ibtn} ${s.bclose}`} aria-label="Close card" onClick={onClose}><Icon name="x" /></button>
    <BigArt id={subject.cardId} label={name} />
    <div className={s.bmain}>
      <CardText id={subject.cardId} info={info} name={subject.name} fallbackName={`Card ${subject.cardId}`}>
        <div className={s.bchips}>
          <TierChip tier={subject.tier} />
          {subject.remembered ? <span className={s.tier} data-testid="card-last-read">Last read here, may have changed · {readAge(subject.rememberedAt)}</span> : null}
          {subject.covered ? <span className={`${s.tier} ${s.tierLow}`}>Covered</span> : null}
          <DeckBadges subject={subject} warning={warning} />
          {viewOnly && actions.materials?.length ? <span className={s.tier} data-testid="card-material-count">{actions.materials.length} material{actions.materials.length === 1 ? "" : "s"}</span> : null}
        </div>
      </CardText>
      {subject.addErrors.length && subject.notInDecklist ? <p className={s.bnote}>{subject.addErrors[0]}</p> : null}
      {viewOnly && actions.zoneCheck ? <ZoneCheck reason={actions.zoneCheck} /> : null}
    </div>
    <div className={s.bbar} data-testid="card-popover-footer">
      {viewOnly ? <>
        {actions.onReadAgain ? <button type="button" className={BTN} onClick={actions.onReadAgain} data-testid="card-read-again">Read again</button> : null}
        {actions.onWrong ? <button type="button" className={BTN} onClick={actions.onWrong}>Wrong card?</button> : null}
        {actions.onPin ? <button type="button" className={BTN} onClick={actions.onPin} data-testid="pin-inspector">Pin to inspector</button> : null}
      </> : <Actions a={actions} subject={subject} />}
    </div>
  </PopupFrame>;
}

/** The same card in the left inspector drawer, with bigger art. */
export function InspectorBody({ subject, info, warning, actions, sourceLine }: {
  subject: Subject | null; info: CardInfo | undefined; warning?: string; actions: CardActions; sourceLine: string;
}) {
  const status = useCardStatus(subject?.cardId || undefined);
  if (!subject) return <p className={s.dempty}>No card selected.<br />Click a card on a camera feed, or press <kbd>F</kbd> over a feed to outline every card.</p>;
  // cardId 0: your own card the table cannot name. Its actions (move, flip, Graveyard, Wrong card?) still work.
  if (!subject.cardId) return <div data-testid="inspector-body">
    <h3 className={s.dname} style={{ margin: 0 }}>{subject.name ?? "Face-down card"}</h3>
    <p className={s.dmeta}>Not identified.</p>
    <Actions a={{ ...actions, onPin: undefined }} subject={subject} />
  </div>;
  const name = info?.name ?? subject.name ?? `Card ${subject.cardId}`;
  return <div data-testid="inspector-body">
    <div className={s.dhead}>
      <Art id={subject.cardId} />
      <div>
        <h3 className={s.dname} style={{ margin: 0 }}>{name}</h3>
        <p className={s.dmeta}>{info || !status.failed ? meta(info) : "Could not load this card."}{!info && status.failed ? <> <button type="button" className={`${s.btn} ${s.sm}`} onClick={status.retry}>Try again</button></> : null}</p>
        <Stats info={info} />
      </div>
    </div>
    {info?.effectText ? <p className={s.dtxt}>{info.effectText}</p> : null}
    <div className={s.dsrc}>{sourceLine}</div>
    <div className={`${s.dchk} ${subject.notInDecklist ? s.bad : s.ok}`}>
      <DeckBadges subject={subject} warning={warning} />
    </div>
    <Actions a={{ ...actions, onPin: undefined }} subject={subject} />
  </div>;
}
