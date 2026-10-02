"use client";

import { useMemo, useRef, type CSSProperties } from "react";
import type { DuelCard, DuelCardInfo, DuelEngineView, DuelMasterRule, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import { Check, LayoutGrid, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardFace, cardFieldStats } from "./card-face";
import { EquipChip, EquipLinksContext, useEquipRole } from "./equip-chip";
import { EquipFx } from "./equip-fx";
import { equipSentence, resolveEquipLinks } from "./equip-links";
import { duelFontClasses } from "./fonts";
import { deriveFieldActivity } from "./field-activity";
import { useFieldPriorityReady } from "./field-priority";
import { LifePoints } from "./life-points";
import { zoneMarkLook } from "./pick-glow";
import { pileSummonTone } from "./summon-circle-model";
import { SummonCircle, SummonGlow } from "./summon-circle";
import {
  attributeLabel,
  cardArtUrl,
  cardDetailsText,
  cardStatsText,
  isBattlePhase,
  isDefenseAt,
  LOCATION_DECK,
  LOCATION_DMZONE,
  LOCATION_EXTRA,
  LOCATION_FZONE,
  LOCATION_GRAVE,
  LOCATION_HAND,
  LOCATION_MZONE,
  LOCATION_PZONE,
  LOCATION_REMOVED,
  LOCATION_SZONE,
  phaseLabel,
  POS_FACEUP_ATTACK,
  ST_COUNT,
  zoneKey,
} from "./constants";
import type { InspectTarget } from "./inspector";
import styles from "./field.module.css";

type CssVars = CSSProperties & Record<`--${string}`, string | number>;

export type ZoneRef = { controller: number; location: number; sequence: number };

export type DuelActivateHandler = (
  keys: string[],
  card: DuelCard | null,
  anchor: HTMLElement,
) => void;

export type DuelHoverHandler = (card: DuelCard | null, anchor: HTMLElement | null) => void;

type FieldCallbacks = {
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  onActivate: DuelActivateHandler;
  onInspect: (target: InspectTarget) => void;
  onHoverCard?: DuelHoverHandler;
};

function slot(cards: Array<DuelCard | null> | undefined, index: number): DuelCard | null {
  if (!cards || index < 0 || index >= cards.length) return null;
  return cards[index] ?? null;
}

function extraMonster(
  bottom: DuelSeatView | undefined,
  top: DuelSeatView | undefined,
  side: "left" | "right",
): DuelCard | null {
  if (side === "left") return slot(bottom?.monsters, 5) ?? slot(top?.monsters, 6);
  return slot(bottom?.monsters, 6) ?? slot(top?.monsters, 5);
}

function extraMonsterKeys(bottomSeat: number, topSeat: number, side: "left" | "right"): string[] {
  if (side === "left") {
    return [zoneKey(bottomSeat, LOCATION_MZONE, 5), zoneKey(topSeat, LOCATION_MZONE, 6)];
  }
  return [zoneKey(bottomSeat, LOCATION_MZONE, 6), zoneKey(topSeat, LOCATION_MZONE, 5)];
}

function anyLegal(keys: string[], legal: Set<string>): boolean {
  for (const key of keys) {
    if (legal.has(key)) return true;
  }
  return false;
}

function anySelected(keys: string[], selected: Set<string>): boolean {
  for (const key of keys) {
    if (selected.has(key)) return true;
  }
  return false;
}

function cardZoneKey(card: DuelCard): string {
  return zoneKey(card.controller, card.location, card.sequence);
}

function withExact(card: DuelCard | null, keys: string[]): string[] {
  if (!card) return keys;
  const exact = cardZoneKey(card);
  if (keys[0] === exact) return keys;
  return [exact, ...keys.filter((key) => key !== exact)];
}

function pileHighlightKeys(seat: number, location: number, cards: DuelCard[]): string[] {
  if (cards.length === 0) return [zoneKey(seat, location, 0)];
  return cards.map(cardZoneKey);
}

function stKeys(seat: number, sequence: number, card: DuelCard | null, masterRule: DuelMasterRule): string[] {
  const keys = [zoneKey(seat, LOCATION_SZONE, sequence)];
  const left = masterRule === 3 ? 6 : 0;
  const right = masterRule === 3 ? 7 : ST_COUNT - 1;
  if (masterRule >= 3 && sequence === left) keys.push(zoneKey(seat, LOCATION_PZONE, 0));
  if (masterRule >= 3 && sequence === right) keys.push(zoneKey(seat, LOCATION_PZONE, 1));
  return withExact(card, keys);
}

function findByCode(view: DuelSeatView, code: number): DuelCard | null {
  const zones: Array<DuelCard | null | undefined> = [
    ...view.monsters,
    ...view.spells,
    ...view.graveyard,
    ...view.banished,
    ...view.hand,
    ...view.extra,
  ];
  for (const card of zones) {
    if (card?.code === code) return card;
  }
  return null;
}

function masterCard(view: DuelSeatView): DuelCard | null {
  const master = view.deckMaster;
  if (!master) return null;
  if (master.inZone) {
    return {
      controller: view.seat,
      location: LOCATION_DMZONE,
      sequence: 0,
      position: POS_FACEUP_ATTACK,
      code: master.card.code,
      name: master.card.name,
      description: master.card.description,
      attack: master.card.attack,
      defense: master.card.defense,
      level: master.card.level,
      type: master.card.type,
      attribute: master.card.attribute,
      race: master.card.race,
    };
  }
  return findByCode(view, master.card.code);
}

function masterStatus(view: DuelSeatView): string {
  const master = view.deckMaster;
  if (!master) return "No Deck Master";
  if (master.inZone) return "In Deck Master Zone";
  const card = findByCode(view, master.card.code);
  if (card && (card.location === LOCATION_MZONE || card.location === LOCATION_SZONE || card.location === LOCATION_FZONE)) {
    return "On field";
  }
  return "Elsewhere";
}

/** Two short lines for a dock: "DARK · Level 7" and "Spellcaster". */
function masterDetailLines(card: DuelCardInfo): string[] {
  const [first, second] = cardDetailsText(card).split(" · ");
  const rank = second != null ? first : "";
  const identity = second ?? first ?? "";
  const race = identity.split(" / ")[0] ?? "";
  return [[attributeLabel(card.attribute), rank].filter(Boolean).join(" · "), race].filter(Boolean);
}

function NibIcon() {
  return (
    <svg className={styles.nib} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 21.5 6.8 11 12 2.5 17.2 11Z" />
      <path d="M12 21.5V13" />
      <circle cx="12" cy="11" r="1.4" />
    </svg>
  );
}

/**
 * Legal or selected zones get a signal that is not colour alone: a glow on a card, in the hand too (soft and
 * pulsing when it can be used or picked, steady and stronger when picked) or a dashed outline on an empty zone, plus a tag
 * (a nib, or a check once picked).
 * A legal pile with a summoning circle already shows that signal, so it skips the glow and tag until selected.
 */
function ZoneMarks({
  legal,
  selected,
  circle = false,
  occupied,
}: {
  legal: boolean;
  selected: boolean;
  circle?: boolean;
  occupied: boolean;
}) {
  if (!legal && !selected) return null;
  if (circle && !selected) return null;
  const look = zoneMarkLook({ occupied });
  return (
    <>
      {look === "glow" ? (
        <span className={styles.glow} data-state={selected ? "picked" : "usable"} aria-hidden="true" />
      ) : (
        <span className={styles.ring} aria-hidden="true" />
      )}
      <span className={styles.mark} aria-hidden="true">
        {selected ? <Check size={11} strokeWidth={2.4} /> : <NibIcon />}
      </span>
    </>
  );
}

const PILE_WORDS: Record<string, [string, string]> = {
  deck: ["Deck", "Deck"],
  gy: ["GY", "GY"],
  banish: ["Banished", "Ban"],
  extra: ["Extra", "Ex"],
  field: ["Field", "Fld"],
};

function PileLabel({ kind, count }: { kind: string; count: number }) {
  const [full, short] = PILE_WORDS[kind] ?? [kind, kind];
  return (
    <span className={styles.pileLabel}>
      <span className={styles.plFull}>{full}</span>
      <span className={styles.plShort}>{short}</span>
      <b className={styles.plCount} data-pile-count={count}>{count}</b>
    </span>
  );
}

function ZoneSlot({
  card,
  label,
  kind,
  keys,
  legalKeys,
  selectedKeys,
  showStats,
  pendulum,
  sleeve,
  pileCount,
  flip,
  onActivate,
  onHoverCard,
}: {
  card: DuelCard | null;
  label: string;
  kind: string;
  keys: string[];
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  showStats?: boolean;
  pendulum?: boolean;
  sleeve?: "deck" | "extra";
  /** Field Spell zone: shows the pile label with this count. */
  pileCount?: number;
  /** Opponent side of the board (labels and marks face the other way). */
  flip?: boolean;
  onActivate: DuelActivateHandler;
  onHoverCard?: DuelHoverHandler;
}) {
  const legal = anyLegal(keys, legalKeys);
  const selected = anySelected(keys, selectedKeys);
  const stats = cardFieldStats(card, showStats);
  const [atk, def] = stats ? stats.split(" / ") : [null, null];
  const defense = card != null && isDefenseAt(card.location, card.position);
  const equipRole = useEquipRole(card);
  const equipText = equipSentence(equipRole);

  return (
    <div
      className={styles.zone}
      data-zones={keys.join(" ")}
      data-kind={kind}
      data-legal={legal ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      data-occupied={card ? "true" : "false"}
      data-equip={equipRole?.role}
      data-defense={defense ? "true" : "false"}
      data-side={flip ? "opp" : "you"}
    >
      <button
        type="button"
        className={styles.zoneHit}
        aria-label={equipText ? `${label}. ${equipText}` : label}
        aria-pressed={selected}
        onClick={(event) => onActivate(keys, card, event.currentTarget)}
        onMouseEnter={(event) => onHoverCard?.(card, event.currentTarget)}
        onMouseLeave={() => onHoverCard?.(null, null)}
        onFocus={(event) => onHoverCard?.(card, event.currentTarget)}
        onBlur={() => onHoverCard?.(null, null)}
      >
        {!card && kind === "emz" ? <span className={styles.zoneName}>Extra Monster</span> : null}
        <div className={styles.frame}>
          {pendulum ? <span className={styles.pendulumMark}>P</span> : null}
          {card ? <CardFace card={card} sleeve={sleeve} /> : sleeve ? <CardFace card={null} sleeve={sleeve} /> : null}
          {atk ? (
            <span className={styles.plate}>
              <b>{atk}</b>
              {def != null ? (
                <>
                  <i className={styles.plateSep}>/</i>
                  <span className={styles.plateDef}>{def}</span>
                </>
              ) : null}
            </span>
          ) : null}
          <EquipChip role={equipRole} flip={flip} />
          <ZoneMarks legal={legal} selected={selected} occupied={card != null} />
        </div>
        {pileCount != null ? <PileLabel kind={kind} count={pileCount} /> : null}
      </button>
    </div>
  );
}

type FanEntry = { card: DuelCard | null; key: string };

/** The top two or three cards of a pile, deepest first. Unknown cards are null and render as sleeves. */
function fanEntries(kind: string, cards: DuelCard[], count: number): FanEntry[] {
  if (kind === "deck") return [];
  const want = Math.min(3, count);
  if (want <= 0) return [];
  const top = cards.slice(-want);
  const pad = Math.max(0, want - top.length);
  return [
    ...Array.from({ length: pad }, (_, index): FanEntry => ({ card: null, key: `pad-${index}` })),
    ...top.map((card, index): FanEntry => ({ card, key: `${cardZoneKey(card)}-${index}` })),
  ];
}

const CHIP_TEXT: Record<string, string> = { gy: "Open GY", banish: "Open Banished", extra: "Open Extra Deck" };

function PileSlot({
  label,
  count,
  kind,
  keys,
  cards,
  inspectable,
  sleeve,
  side,
  column,
  legalKeys,
  selectedKeys,
  onActivate,
  onInspect,
  onHoverCard,
}: {
  label: string;
  count: number;
  kind: string;
  keys: string[];
  cards: DuelCard[];
  inspectable: boolean;
  sleeve?: "deck" | "extra";
  side: "opp" | "you";
  /** Board column the pile sits in; the fan spreads toward the outer edge. */
  column: "left" | "right";
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  onActivate: DuelActivateHandler;
  onInspect: (target: InspectTarget) => void;
  onHoverCard?: DuelHoverHandler;
}) {
  const legal = anyLegal(keys, legalKeys);
  const selected = anySelected(keys, selectedKeys);
  const circleTone = pileSummonTone({ kind, side, count, keys, legalKeys });
  const fan = fanEntries(kind, cards, count);
  const chip = CHIP_TEXT[kind];
  const hoverTop = kind === "gy" || kind === "banish" ? (cards[cards.length - 1] ?? null) : null;

  function activate(anchor: HTMLElement) {
    if (inspectable) {
      onInspect({ type: "pile", title: label, cards });
      if (cards.length === 1) {
        onActivate([cardZoneKey(cards[0])], cards[0], anchor);
        return;
      }
      if (cards.length === 0) onActivate(keys, null, anchor);
      return;
    }
    onActivate(keys, null, anchor);
  }

  return (
    <div
      className={styles.zone}
      data-zones={keys.join(" ")}
      data-kind={kind}
      data-legal={legal ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      data-occupied={count > 0 ? "true" : "false"}
      data-summon={circleTone ?? undefined}
      data-side={side}
      data-col={column}
      data-fan={fan.length > 0 ? fan.length : undefined}
    >
      <button
        type="button"
        className={styles.zoneHit}
        aria-label={`${label} (${count})`}
        aria-pressed={selected}
        onClick={(event) => activate(event.currentTarget)}
        onMouseEnter={(event) => onHoverCard?.(hoverTop, event.currentTarget)}
        onMouseLeave={() => onHoverCard?.(null, null)}
        onFocus={(event) => onHoverCard?.(hoverTop, event.currentTarget)}
        onBlur={() => onHoverCard?.(null, null)}
      >
        <div className={styles.frame} data-stack-size={kind === "deck" ? Math.min(count, 3) : undefined}>
          {kind === "deck" ? (
            count > 0 ? <CardFace card={null} sleeve="deck" /> : null
          ) : (
            /* Top card first in the DOM so a card menu anchors on it (z-index, not order, stacks the fan). */
            [...fan].reverse().map((entry, fi) => (
              <div
                key={entry.key}
                className={styles.fanCard}
                data-fi={fi}
                onMouseEnter={(event) =>
                  onHoverCard?.(entry.card?.code != null ? entry.card : null, event.currentTarget)
                }
              >
                <CardFace card={entry.card} sleeve={sleeve ?? (kind === "extra" ? "extra" : "deck")} reveal={kind !== "banish"} />
              </div>
            ))
          )}
          {circleTone ? (
            <>
              <SummonGlow tone={circleTone} />
              <SummonCircle tone={circleTone} />
            </>
          ) : null}
          <ZoneMarks legal={legal} selected={selected} circle={circleTone != null} occupied={count > 0} />
        </div>
        <PileLabel kind={kind} count={count} />
      </button>
      {chip && inspectable && cards.length > 0 ? (
        <button
          type="button"
          className={styles.openChip}
          aria-label={`Open ${label}`}
          onClick={() => onInspect({ type: "pile", title: label, cards })}
        >
          <LayoutGrid size={11} strokeWidth={1.8} aria-hidden />
          {chip}
        </button>
      ) : null}
    </div>
  );
}

function Tally({
  side,
  name,
  lp,
  seatKey,
  active,
  priorityLabel,
  spectator,
  reducedMotion,
}: {
  side: "opp" | "you";
  name: string;
  lp: number | null;
  seatKey: number | undefined;
  active: boolean;
  priorityLabel: string | null;
  spectator: boolean;
  reducedMotion: boolean;
}) {
  return (
    <div className={styles.tally} data-side={side} data-lp-seat={seatKey} data-active={active ? "true" : "false"}>
      <div className={styles.tHead}>
        <span className={styles.tWho}>{name}</span>
        {active ? (
          <span className={styles.tTurn}>Turn</span>
        ) : null}
        {priorityLabel ? (
          <span className={styles.tPriority} aria-label={priorityLabel} title={priorityLabel}>
            {spectator ? "to act" : priorityLabel}
          </span>
        ) : null}
      </div>
      <div className={styles.tLp}>
        <strong>
          <span className={styles.lpPrefix}>LP</span>
          <LifePoints key={seatKey} value={lp} reducedMotion={reducedMotion} />
        </strong>
      </div>
    </div>
  );
}

function HandStrip({
  seat,
  cards,
  mine,
  ownerLabel,
  legalKeys,
  selectedKeys,
  onActivate,
  onHoverCard,
}: {
  seat: number;
  cards: DuelCard[];
  mine: boolean;
  ownerLabel: string;
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  onActivate: DuelActivateHandler;
  onHoverCard?: DuelHoverHandler;
}) {
  const vars: CssVars = { "--hn": cards.length, "--hn1": Math.max(1, cards.length - 1) };
  return (
    <div className={`${styles.handRail}`}>
      <div
        className={`${styles.hand} ${mine ? styles.handLocal : ""}`}
        role="group"
        aria-label={`${ownerLabel} hand`}
        data-hand-seat={seat}
        data-side={mine ? "you" : "opp"}
        data-many={cards.length >= 7 ? "true" : "false"}
        style={vars}
      >
        {cards.map((card, index) => {
          const keys = [zoneKey(seat, LOCATION_HAND, card.sequence ?? index)];
          const revealed = card.code != null;
          const label = !revealed ? `${ownerLabel} card ${index + 1}` : (card.name ?? `Card ${card.code}`);
          const cardVars: CssVars = { "--i": index };
          return (
            <div
              key={`${seat}-hand-${card.sequence ?? index}`}
              className={styles.handCard}
              data-revealed={!mine && revealed ? "true" : undefined}
              style={cardVars}
            >
              <ZoneSlot
                card={card}
                label={label}
                kind="hand"
                keys={keys}
                legalKeys={legalKeys}
                selectedKeys={selectedKeys}
                showStats={mine || revealed}
                flip={!mine}
                onActivate={onActivate}
                onHoverCard={onHoverCard}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonsterRow({
  view,
  reversed,
  callbacks,
}: {
  view: DuelSeatView | undefined;
  reversed: boolean;
  callbacks: FieldCallbacks;
}) {
  const seat = view?.seat ?? 0;
  const order = reversed ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  return (
    <div className={styles.zones}>
      {order.map((sequence) => {
        const card = slot(view?.monsters, sequence);
        return (
          <ZoneSlot
            key={`${seat}-mz-${sequence}`}
            card={card}
            label={`Monster zone ${sequence + 1}`}
            kind="mz"
            keys={withExact(card, [zoneKey(seat, LOCATION_MZONE, sequence)])}
            legalKeys={callbacks.legalKeys}
            selectedKeys={callbacks.selectedKeys}
            showStats
            flip={reversed}
            onActivate={callbacks.onActivate}
            onHoverCard={callbacks.onHoverCard}
          />
        );
      })}
    </div>
  );
}

function SpellRow({
  view,
  reversed,
  callbacks,
  masterRule,
}: {
  view: DuelSeatView | undefined;
  reversed: boolean;
  callbacks: FieldCallbacks;
  masterRule: DuelMasterRule;
}) {
  const seat = view?.seat ?? 0;
  const order = reversed ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  return (
    <div className={styles.zones}>
      {order.map((sequence) => {
        const card = slot(view?.spells, sequence);
        const pendulum = masterRule >= 4 && (sequence === 0 || sequence === ST_COUNT - 1);
        return (
          <ZoneSlot
            key={`${seat}-st-${sequence}`}
            card={card}
            label={pendulum ? `Spell and Trap zone ${sequence + 1}, pendulum` : `Spell and Trap zone ${sequence + 1}`}
            kind="st"
            keys={stKeys(seat, sequence, card, masterRule)}
            legalKeys={callbacks.legalKeys}
            selectedKeys={callbacks.selectedKeys}
            pendulum={pendulum}
            flip={reversed}
            onActivate={callbacks.onActivate}
            onHoverCard={callbacks.onHoverCard}
          />
        );
      })}
    </div>
  );
}

function PileColumn({
  view,
  opponent,
  side,
  callbacks,
  ownerLabel,
  masterRule,
}: {
  view: DuelSeatView | undefined;
  opponent: boolean;
  side: "left" | "right";
  callbacks: FieldCallbacks;
  ownerLabel: string;
  masterRule: DuelMasterRule;
}) {
  const seat = view?.seat ?? 0;
  const gy = view?.graveyard ?? [];
  const banished = view?.banished ?? [];
  const extra = view?.extra ?? [];
  const fieldSpell = slot(view?.spells, 5);
  const whose = ownerLabel;
  const owner = opponent ? "opp" : "you";
  const deck = (
    <PileSlot
      key="deck"
      label={`${whose} Main Deck`}
      count={view?.deckCount ?? 0}
      kind="deck"
      keys={[zoneKey(seat, LOCATION_DECK, 0)]}
      cards={[]}
      inspectable={false}
      sleeve="deck"
      side={owner}
      column={side}
      legalKeys={callbacks.legalKeys}
      selectedKeys={callbacks.selectedKeys}
      onActivate={callbacks.onActivate}
      onInspect={callbacks.onInspect}
      onHoverCard={callbacks.onHoverCard}
    />
  );
  const grave = (
    <PileSlot
      key="gy"
      label={`${whose} Graveyard`}
      count={gy.length}
      kind="gy"
      keys={pileHighlightKeys(seat, LOCATION_GRAVE, gy)}
      cards={gy}
      inspectable
      side={owner}
      column={side}
      legalKeys={callbacks.legalKeys}
      selectedKeys={callbacks.selectedKeys}
      onActivate={callbacks.onActivate}
      onInspect={callbacks.onInspect}
      onHoverCard={callbacks.onHoverCard}
    />
  );
  const banish = (
    <PileSlot
      key="banish"
      label={`${whose} Banished`}
      count={banished.length}
      kind="banish"
      keys={pileHighlightKeys(seat, LOCATION_REMOVED, banished)}
      cards={banished}
      inspectable
      side={owner}
      column={side}
      legalKeys={callbacks.legalKeys}
      selectedKeys={callbacks.selectedKeys}
      onActivate={callbacks.onActivate}
      onInspect={callbacks.onInspect}
      onHoverCard={callbacks.onHoverCard}
    />
  );
  const extraPile = (
    <PileSlot
      key="extra"
      label={`${whose} Extra Deck`}
      count={view?.extraCount ?? extra.length}
      kind="extra"
      keys={pileHighlightKeys(seat, LOCATION_EXTRA, extra)}
      cards={extra}
      inspectable
      sleeve="extra"
      side={owner}
      column={side}
      legalKeys={callbacks.legalKeys}
      selectedKeys={callbacks.selectedKeys}
      onActivate={callbacks.onActivate}
      onInspect={callbacks.onInspect}
      onHoverCard={callbacks.onHoverCard}
    />
  );
  const fieldPile = (
    <ZoneSlot
      key="field"
      card={fieldSpell}
      label={`${whose} Field Spell`}
      kind="field"
      keys={withExact(fieldSpell, [zoneKey(seat, LOCATION_FZONE, 0), zoneKey(seat, LOCATION_SZONE, 5)])}
      legalKeys={callbacks.legalKeys}
      selectedKeys={callbacks.selectedKeys}
      pileCount={fieldSpell ? 1 : 0}
      flip={opponent}
      onActivate={callbacks.onActivate}
      onHoverCard={callbacks.onHoverCard}
    />
  );

  const items = opponent
    ? side === "left"
      ? [deck, grave, banish]
      : [extraPile, fieldPile]
    : side === "left"
      ? [fieldPile, extraPile]
      : [banish, grave, deck];

  const pendulumSequence = (opponent ? side === "left" : side === "right") ? 7 : 6;
  const pendulumCard = slot(view?.spells, pendulumSequence);
  return (
    <div className={styles.piles} data-side={side} data-opponent={opponent}>
      {masterRule === 3 ? (
        <ZoneSlot card={pendulumCard} kind="st" pendulum flip={opponent}
          label={`${whose} ${pendulumSequence === 6 ? "left" : "right"} Pendulum zone`}
          keys={stKeys(seat, pendulumSequence, pendulumCard, masterRule)}
          legalKeys={callbacks.legalKeys} selectedKeys={callbacks.selectedKeys}
          onActivate={callbacks.onActivate} onHoverCard={callbacks.onHoverCard} />
      ) : null}
      {items}
    </div>
  );
}

/**
 * The duel board, restyled as a ruled match sheet.
 *
 * Root element: `<div data-duel-field="true" data-battle="true|false" data-reduced-motion="true|false">`.
 * It fills its parent (width and height 100%) and is a size container: the zone size `--z` is derived
 * from the smaller of the width-bound and height-bound fit, so the whole board is visible without scrolling.
 */
export function DuelField({
  engine,
  mySeat,
  masterRule,
  reducedMotion,
  legalKeys,
  selectedKeys,
  onActivate,
  onInspect,
  onHoverCard,
  bottomName,
  topName,
}: {
  engine: DuelEngineView;
  mySeat: number | null;
  masterRule: DuelMasterRule;
  reducedMotion: boolean;
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  onActivate: DuelActivateHandler;
  onInspect: (target: InspectTarget) => void;
  onHoverCard?: DuelHoverHandler;
  bottomName: string;
  topName: string;
}) {
  const bottomIndex = mySeat ?? 0;
  const topIndex = bottomIndex === 0 ? 1 : 0;
  const bottom = engine.seats.find((seat) => seat.seat === bottomIndex);
  const top = engine.seats.find((seat) => seat.seat === topIndex);
  const callbacks: FieldCallbacks = { legalKeys, selectedKeys, onActivate, onInspect, onHoverCard };
  const topLabel = mySeat == null ? topName : "Opponent";
  const bottomLabel = mySeat == null ? bottomName : "Your";
  const battle = isBattlePhase(engine.phase);
  const boardRef = useRef<HTMLElement | null>(null);
  const pending = deriveFieldActivity(engine);
  // The parent contains the sibling DOM/Three.js effects as well as the field. Reuse their
  // animation/hold gate for every prompt owner, including private opponent prompts.
  const priorityReady = useFieldPriorityReady({
    events: engine.events,
    waiting: pending.prioritySeat != null,
    board: boardRef,
    reducedMotion,
  });
  const activity = deriveFieldActivity(engine, !priorityReady);
  const priorityLabel = (seat: number, name: string) => activity.prioritySeat !== seat ? null
    : mySeat == null ? `${name} to act` : mySeat === seat ? "Your move" : "Opponent to act";

  const leftEmz = extraMonster(bottom, top, "left");
  const rightEmz = extraMonster(bottom, top, "right");
  const leftEmzKeys = withExact(leftEmz, extraMonsterKeys(bottomIndex, topIndex, "left"));
  const rightEmzKeys = withExact(rightEmz, extraMonsterKeys(bottomIndex, topIndex, "right"));

  const equipLinks = useMemo(() => resolveEquipLinks(engine.seats), [engine.seats]);

  return (
    <EquipLinksContext.Provider value={equipLinks}>
    <div
      className={cn(duelFontClasses, styles.felt)}
      ref={(node) => { boardRef.current = node?.parentElement ?? null; }}
      data-duel-field="true"
      data-battle={battle ? "true" : "false"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-master-rule={masterRule}
    >
      <div className={styles.wash} aria-hidden="true" />
      <div className={styles.playmat}>
        <span className={styles.marginRule} aria-hidden="true" />
        <div className={`${styles.strip} ${styles.stripTop}`}>
          <Tally
            side="opp"
            name={topName}
            lp={top?.lp ?? null}
            seatKey={top?.seat}
            active={activity.turnSeat === topIndex}
            priorityLabel={priorityLabel(topIndex, topName)}
            spectator={mySeat == null}
            reducedMotion={reducedMotion}
          />
          {top ? (
            <HandStrip
              seat={top.seat}
              cards={top.hand}
              mine={false}
              ownerLabel={topLabel}
              legalKeys={legalKeys}
              selectedKeys={selectedKeys}
              onActivate={onActivate}
              onHoverCard={onHoverCard}
            />
          ) : (
            <div className={styles.handRail}><div className={styles.hand} /></div>
          )}
        </div>
        <div className={styles.arena}>
          <div className={styles.half} data-field-seat={topIndex} data-side="top"
            data-turn={activity.turnSeat === topIndex ? "true" : "false"}
            data-priority={activity.prioritySeat === topIndex ? "true" : "false"}>
            <span className={styles.halfSignals} data-field-signals data-side="top" aria-hidden="true" />
            <PileColumn view={top} opponent side="left" callbacks={callbacks} ownerLabel={topLabel} masterRule={masterRule} />
            <div className={styles.rows}>
              <SpellRow view={top} reversed callbacks={callbacks} masterRule={masterRule} />
              <MonsterRow view={top} reversed callbacks={callbacks} />
            </div>
            <PileColumn view={top} opponent side="right" callbacks={callbacks} ownerLabel={topLabel} masterRule={masterRule} />
          </div>
          <div className={styles.emzBand}>
            {masterRule >= 4 ? (
              <div className={styles.emzRow}>
                <div />
                <ZoneSlot
                  card={leftEmz}
                  label="Extra monster zone, column 2"
                  kind="emz"
                  keys={leftEmzKeys}
                  legalKeys={legalKeys}
                  selectedKeys={selectedKeys}
                  showStats
                  flip={leftEmz != null && leftEmz.controller === topIndex}
                  onActivate={onActivate}
                  onHoverCard={onHoverCard}
                />
                <div />
                <ZoneSlot
                  card={rightEmz}
                  label="Extra monster zone, column 4"
                  kind="emz"
                  keys={rightEmzKeys}
                  legalKeys={legalKeys}
                  selectedKeys={selectedKeys}
                  showStats
                  flip={rightEmz != null && rightEmz.controller === topIndex}
                  onActivate={onActivate}
                  onHoverCard={onHoverCard}
                />
                <div />
              </div>
            ) : <div />}
          </div>
          <div className={`${styles.half} ${styles.halfLocal}`} data-field-seat={bottomIndex} data-side="bottom"
            data-turn={activity.turnSeat === bottomIndex ? "true" : "false"}
            data-priority={activity.prioritySeat === bottomIndex ? "true" : "false"}>
            <span className={styles.halfSignals} data-field-signals data-side="bottom" aria-hidden="true" />
            <PileColumn view={bottom} opponent={false} side="left" callbacks={callbacks} ownerLabel={bottomLabel} masterRule={masterRule} />
            <div className={styles.rows}>
              <MonsterRow view={bottom} reversed={false} callbacks={callbacks} />
              <SpellRow view={bottom} reversed={false} callbacks={callbacks} masterRule={masterRule} />
            </div>
            <PileColumn view={bottom} opponent={false} side="right" callbacks={callbacks} ownerLabel={bottomLabel} masterRule={masterRule} />
          </div>
        </div>
        <div className={`${styles.strip} ${styles.stripBottom}`}>
          <Tally
            side="you"
            name={bottomName}
            lp={bottom?.lp ?? null}
            seatKey={bottom?.seat}
            active={activity.turnSeat === bottomIndex}
            priorityLabel={priorityLabel(bottomIndex, bottomName)}
            spectator={mySeat == null}
            reducedMotion={reducedMotion}
          />
          {bottom ? (
            <HandStrip
              seat={bottom.seat}
              cards={bottom.hand}
              mine
              ownerLabel={bottomLabel}
              legalKeys={legalKeys}
              selectedKeys={selectedKeys}
              onActivate={onActivate}
              onHoverCard={onHoverCard}
            />
          ) : (
            <div className={styles.handRail}><div className={`${styles.hand} ${styles.handLocal}`} /></div>
          )}
        </div>
      </div>
      <EquipFx links={equipLinks} events={engine.events} duelKey="field" reducedMotion={reducedMotion} />
    </div>
    </EquipLinksContext.Provider>
  );
}

function MasterDock({
  title,
  view,
  local,
  legalKeys,
  selectedKeys,
  canAct,
  legalActionsFor,
  onActivate,
  onChooseAction,
  onInspect,
  onHoverCard,
}: {
  title: string;
  view: DuelSeatView | undefined;
  local: boolean;
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  canAct: boolean;
  legalActionsFor: (card: DuelCard | null, keys: string[]) => DuelPromptOption[];
  onActivate: DuelActivateHandler;
  onChooseAction: (option: DuelPromptOption) => void;
  onInspect: (target: InspectTarget) => void;
  onHoverCard?: DuelHoverHandler;
}) {
  const master = view?.deckMaster;
  const card = view ? masterCard(view) : null;
  const keys = view ? withExact(card, [zoneKey(view.seat, LOCATION_DMZONE, 0)]) : [];
  const legal = anyLegal(keys, legalKeys);
  const selected = anySelected(keys, selectedKeys);
  const actions = local && canAct ? legalActionsFor(card, keys) : [];
  const status = view ? masterStatus(view) : "";
  const stats = master ? cardStatsText(master.card) : null;
  const details = master ? masterDetailLines(master.card) : [];

  function inspect() {
    if (card) onInspect({ type: "card", card });
    else if (master) onInspect({ type: "info", card: master.card });
  }

  return (
    <section
      className={styles.masterDock}
      data-local={local ? "true" : "false"}
      data-legal={legal ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
    >
      <h2 className={styles.masterTitle}>{title}</h2>
      {master && view ? (
        <>
          <button
            type="button"
            className={styles.masterHit}
            aria-label={`${title}: ${master.card.name}`}
            aria-pressed={selected}
            onClick={(event) => {
              if (card) onActivate(keys, card, event.currentTarget);
              else inspect();
            }}
            onMouseEnter={(event) => onHoverCard?.(card, event.currentTarget)}
            onMouseLeave={() => onHoverCard?.(null, null)}
            onFocus={(event) => onHoverCard?.(card, event.currentTarget)}
            onBlur={() => onHoverCard?.(null, null)}
          >
            <div className={styles.masterArt} data-master-dock={view.seat} data-away={status === "Elsewhere" ? "true" : "false"}>
              <img src={cardArtUrl(master.card.code, "full")} alt="" draggable={false} />
              <ZoneMarks legal={legal} selected={selected} occupied />
            </div>
            <div className={styles.masterId}>
              <b className={styles.masterName}>{master.card.name}</b>
              {details.map((line) => (
                <span key={line} className={styles.masterDetails}>{line}</span>
              ))}
              {stats ? <span className={styles.masterStats}>{stats}</span> : null}
            </div>
          </button>
          <dl className={styles.masterMeta}>
            <div>
              <dt>Status</dt>
              <dd>{status}</dd>
            </div>
            <div>
              <dt>Returns</dt>
              <dd>{master.returns}</dd>
            </div>
            <div>
              <dt>Next surcharge</dt>
              <dd>{master.nextCost} LP</dd>
            </div>
          </dl>
          {local ? (
            <div className={styles.masterActions}>
              {actions.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.masterAction}
                  data-primary={index === 0 ? "true" : "false"}
                  disabled={!canAct}
                  onClick={() => onChooseAction(option)}
                >
                  {option.label}
                </button>
              ))}
              <button type="button" className={styles.masterInspect} onClick={inspect}>
                <Search size={14} strokeWidth={1.75} aria-hidden />
                Inspect
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className={styles.masterEmpty}>No Deck Master</div>
      )}
    </section>
  );
}

export function DeckMasterRail({
  engine,
  mySeat,
  legalKeys,
  selectedKeys,
  canAct,
  legalActionsFor,
  onActivate,
  onChooseAction,
  onInspect,
  onHoverCard,
}: {
  engine: DuelEngineView;
  mySeat: number | null;
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  canAct: boolean;
  legalActionsFor: (card: DuelCard | null, keys: string[]) => DuelPromptOption[];
  onActivate: DuelActivateHandler;
  onChooseAction: (option: DuelPromptOption) => void;
  onInspect: (target: InspectTarget) => void;
  onHoverCard?: DuelHoverHandler;
}) {
  const bottomIndex = mySeat ?? 0;
  const topIndex = bottomIndex === 0 ? 1 : 0;
  const bottom = engine.seats.find((seat) => seat.seat === bottomIndex);
  const top = engine.seats.find((seat) => seat.seat === topIndex);
  return (
    <div className={cn(duelFontClasses, styles.masterRail)} data-battle={isBattlePhase(engine.phase) ? "true" : "false"}>
      <MasterDock
        title={mySeat == null ? "Seat 2 Master" : "Opponent Master"}
        view={top}
        local={false}
        legalKeys={legalKeys}
        selectedKeys={selectedKeys}
        canAct={false}
        legalActionsFor={legalActionsFor}
        onActivate={onActivate}
        onChooseAction={onChooseAction}
        onInspect={onInspect}
        onHoverCard={onHoverCard}
      />
      <MasterDock
        title={mySeat == null ? "Seat 1 Master" : "Your Master"}
        view={bottom}
        local={mySeat != null}
        legalKeys={legalKeys}
        selectedKeys={selectedKeys}
        canAct={canAct}
        legalActionsFor={legalActionsFor}
        onActivate={onActivate}
        onChooseAction={onChooseAction}
        onInspect={onInspect}
        onHoverCard={onHoverCard}
      />
    </div>
  );
}
