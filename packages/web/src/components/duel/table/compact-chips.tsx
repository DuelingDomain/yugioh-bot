"use client";

import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { DuelCard, DuelEngineView } from "@yugidraft/shared/duels";
import { Check, Hand } from "lucide-react";
import { CardFace } from "../card-face";
import {
  cardArtUrl,
  formatStat,
  isDefenseAt,
  isFacedown,
  LOCATION_DECK,
  LOCATION_EXTRA,
  LOCATION_GRAVE,
  LOCATION_REMOVED,
  TYPE_LINK,
  TYPE_MONSTER,
  zoneKey,
} from "../constants";
import { duelFontClasses } from "../fonts";
import type { DuelActivateHandler, DuelHoverHandler } from "../field";
import type { InspectTarget } from "../inspector";
import { hexToRgbTriplet } from "./seat-angle";
import { SEAT_TONE_HEX, type SeatTone } from "./types";
import styles from "./compact-chips.module.css";

type CssVars = CSSProperties & Record<`--${string}`, string | number>;

export interface CompactChipsProps {
  engine: Pick<DuelEngineView, "seats" | "chain">;
  seat: number;
  tone: SeatTone;
  name: string;
  /** Turn of the seat box on the stage; the panel turns back by this much so it reads upright on screen. */
  rotateDeg: number;
  /** Drawn scale of the seat box; the lens and text read it so small panels keep a readable size. */
  scale: number;
  usable: boolean;
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  onActivate: DuelActivateHandler;
  onInspect: (target: InspectTarget) => void;
  onHoverCard?: DuelHoverHandler;
}

interface Lens {
  card: DuelCard;
  x: number;
  y: number;
}

const cardKey = (card: DuelCard) => zoneKey(card.controller, card.location, card.sequence);

/** A monster's value under its chip: ATK, or DEF in defense. Face-down and non-monster cards show none. */
function chipValue(card: DuelCard): string | null {
  if (card.code == null || isFacedown(card.position) || card.type == null || (card.type & TYPE_MONSTER) === 0) return null;
  if ((card.type & TYPE_LINK) !== 0) return formatStat(card.attack);
  return isDefenseAt(card.location, card.position) ? `DEF ${formatStat(card.defense)}` : formatStat(card.attack);
}

/**
 * A rival field that is too small to read, as chips: one card per monster and Spell/Trap, a hand count, and the
 * pile counts. Hover a chip for a larger card (the lens). Chips are real controls: they use the same card keys as
 * the zones, so a legal one glows, a click opens its actions, and a pick selects it. The full field stays mounted,
 * hidden, so the effects can still measure its zones.
 */
export function CompactChips({ engine, seat, tone, name, rotateDeg, scale, usable, legalKeys, selectedKeys, onActivate, onInspect, onHoverCard }: CompactChipsProps) {
  const view = engine.seats.find((entry) => entry.seat === seat);
  const [lens, setLens] = useState<Lens | null>(null);
  if (!view) return null;
  const hex = SEAT_TONE_HEX[tone];
  const vars: CssVars = {
    "--t": hexToRgbTriplet(hex.main),
    "--tink": hex.ink,
    "--crot": `${-rotateDeg}deg`,
    // Text grows as the field shrinks, as in a small seat field.
    "--ts": Math.min(2.3, Math.max(1, 0.9 / scale)).toFixed(2),
  };
  // A field turned a quarter leaves less room across the screen, so its panel is narrower.
  const sideways = Math.abs(Math.round(rotateDeg)) % 180 === 90;
  const monsters = view.monsters.filter((card): card is DuelCard => card != null);
  const spells = view.spells.filter((card): card is DuelCard => card != null);

  const showLens = (card: DuelCard, node: HTMLElement) => {
    const box = node.getBoundingClientRect();
    setLens({ card, x: box.right + 12, y: box.top + box.height / 2 });
  };
  const chain = (card: DuelCard) => engine.chain.find((link) => link.seat === seat && link.code != null && link.code === card.code)?.index;

  const chip = (card: DuelCard) => {
    const key = cardKey(card);
    const legal = legalKeys.has(key);
    const selected = selectedKeys.has(key);
    const value = chipValue(card);
    const link = chain(card);
    const label = card.code != null && !isFacedown(card.position) ? (card.name ?? `Card ${card.code}`) : "Set card";
    return (
      <button
        key={key}
        type="button"
        className={styles.chip}
        data-chip=""
        data-chip-seat={seat}
        data-zones={key}
        data-legal={legal ? "true" : "false"}
        data-selected={selected ? "true" : "false"}
        data-defense={isDefenseAt(card.location, card.position) ? "true" : "false"}
        aria-label={`${name} ${label}`}
        aria-pressed={selected}
        onClick={(event) => onActivate([key], card, event.currentTarget)}
        onMouseEnter={(event) => {
          onHoverCard?.(card, event.currentTarget);
          showLens(card, event.currentTarget);
        }}
        onMouseLeave={() => {
          onHoverCard?.(null, null);
          setLens(null);
        }}
        onFocus={(event) => onHoverCard?.(card, event.currentTarget)}
        onBlur={() => onHoverCard?.(null, null)}
      >
        <span className={styles.face}>
          <CardFace card={card} />
        </span>
        {value ? <span className={styles.value}>{value}</span> : null}
        {(legal || selected) && (usable || selected) ? (
          <>
            <span className={styles.glow} data-state={selected ? "picked" : "usable"} aria-hidden="true" />
            <span className={styles.tag} aria-hidden="true">{selected ? <Check strokeWidth={2.6} /> : <Hand strokeWidth={2.2} />}</span>
          </>
        ) : null}
        {link != null ? <span className={styles.link}>{link}</span> : null}
      </button>
    );
  };

  const pile = (label: string, count: number, location: number, cards: DuelCard[], inspect: boolean) => {
    const keys = cards.length > 0 ? cards.map(cardKey) : [zoneKey(seat, location, 0)];
    const legal = keys.some((key) => legalKeys.has(key));
    return (
      <button
        type="button"
        className={styles.pile}
        data-pile={label}
        data-zones={keys.join(" ")}
        data-legal={legal ? "true" : "false"}
        aria-label={`${name} ${label}`}
        onClick={(event) => {
          if (inspect) onInspect({ type: "pile", title: `${name} ${label}`, cards });
          if (!inspect || legal) onActivate(keys, cards.length === 1 ? cards[0] : null, event.currentTarget);
        }}
      >
        {label} <b>{count}</b>
      </button>
    );
  };

  return (
    <div className={`${duelFontClasses} ${styles.chips}`} data-compact-chips={seat} data-sideways={sideways ? "true" : undefined} style={vars}>
      <div className={styles.head}>
        <i />
        <span>{name}</span>
        <small>
          <Hand aria-hidden="true" /> {view.hand.length}
        </small>
      </div>
      <div className={styles.row}>
        <span className={styles.lab}>Mon</span>
        {monsters.length > 0 ? monsters.map(chip) : <span className={styles.empty}>No monsters</span>}
      </div>
      <div className={styles.row}>
        <span className={styles.lab}>S/T</span>
        {spells.length > 0 ? spells.map(chip) : <span className={styles.empty}>None set</span>}
      </div>
      <div className={styles.piles}>
        {pile("GY", view.graveyard.length, LOCATION_GRAVE, view.graveyard, true)}
        {pile("Ban", view.banished.length, LOCATION_REMOVED, view.banished, true)}
        {pile("Ex", view.extraCount ?? view.extra.length, LOCATION_EXTRA, view.extra, false)}
        {pile("Deck", view.deckCount, LOCATION_DECK, [], false)}
      </div>
      {lens && typeof document !== "undefined" ? createPortal(<ChipLens lens={lens} tone={tone} owner={name} />, document.body) : null}
    </div>
  );
}

/** The larger card that follows a hovered chip. A card the viewer cannot see shows only "Set card". */
function ChipLens({ lens, tone, owner }: { lens: Lens; tone: SeatTone; owner: string }) {
  const { card } = lens;
  const hidden = card.code == null || isFacedown(card.position);
  const width = 176;
  const left = lens.x + width + 12 > window.innerWidth ? lens.x - width - 36 : lens.x;
  const vars: CssVars = { "--t": hexToRgbTriplet(SEAT_TONE_HEX[tone].main), "--tink": SEAT_TONE_HEX[tone].ink };
  const stats = hidden ? null : chipValue(card);
  const style: CSSProperties = { left, top: Math.max(8, Math.min(window.innerHeight - 300, lens.y - 150)) };
  return (
    <div className={`${duelFontClasses} ${styles.lens}`} style={{ ...vars, ...style }} data-chip-lens role="presentation">
      {hidden || card.code == null ? <span className={styles.lensBack} /> : <img src={cardArtUrl(card.code, "full")} alt="" />}
      <b>{hidden ? "Set card" : (card.name ?? `Card ${card.code}`)}</b>
      {stats ? <span>{stats}</span> : null}
      <em>{owner}</em>
    </div>
  );
}
