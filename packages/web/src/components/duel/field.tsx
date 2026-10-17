"use client";

import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import type { DuelCard, DuelCardInfo, DuelEngineView, DuelMasterRule, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import { Check, LayoutGrid, Link2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardFace, cardFieldStats } from "./card-face";
import { CardActionMenu } from "./card-interactions";
import { DECK_SURRENDER_ID, DECK_USE_ID, deckMenuOptions, deckOffersSurrender, useDeckSurrender } from "./deck-surrender";
import { EquipChip, EquipLinksContext, useEquipRole } from "./equip-chip";
import { EquipFx } from "./equip-fx";
import { equipSentence, resolveEquipLinks } from "./equip-links";
import { duelFontClasses } from "./fonts";
import { deriveFieldActivity } from "./field-activity";
import { useFieldPriorityReady } from "./field-priority";
import { useFieldTurnSeat } from "./field-turn";
import { LifePoints } from "./life-points";
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
import { disabledZones } from "./multi-seat";
import { findMasterCard, masterActionText, masterInUse, masterPlace, masterNextCost, masterSummonLine, surchargeText, useMasterSeats, type MasterPlace } from "./master-place";
import type { InspectTarget } from "./inspector";
import { FieldCracks } from "./field-cracks/field-cracks";
import { RivalHand } from "./table/rival-hand";
import { hexToRgbTriplet, normalizeDeg, textScale } from "./table/seat-angle";
import { SEAT_TONE_HEX, type SeatFieldProps } from "./table/types";
import { useForkLabels } from "./table/fork-labels";
import { MasterZoneContext } from "./master-zone-context";
import { useDuelFieldModel, type DuelFieldProps } from "./field-model";
import {
  anyLegal,
  anySelected,
  cardZoneKey,
  extraMonster,
  extraMonsterKeys,
  pileHighlightKeys,
  slot,
  stKeys,
  withExact,
  type DuelActivateHandler,
  type DuelHoverHandler,
  type FieldCallbacks,
} from "./field-keys";
import { isCoinTossActive } from "./coin-toss-lock";
import { useSkinStyles } from "./skin";
import baseStyles from "./field.module.css";

export { extraMonster, extraMonsterKeys, pileHighlightKeys, stKeys, withExact };
export type { DuelActivateHandler, DuelHoverHandler, ExtraMonsterMode, FieldCallbacks, ZoneRef } from "./field-keys";
export { EquipLinksContext };

type CssVars = CSSProperties & Record<`--${string}`, string | number>;

// DuelField, SeatField and the row components keep the base styles; the skinned primitives below read the skin.
const styles = baseStyles;

export function masterCard(view: DuelSeatView): DuelCard | null {
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
  return findMasterCard(view, master.card.code);
}

const PLACE_STATUS: Record<MasterPlace, string> = {
  none: "No Deck Master",
  zone: "In Deck Master Zone",
  field: "On field",
  elsewhere: "Elsewhere",
};

export function masterStatus(view: DuelSeatView, seats: readonly DuelSeatView[] = []): string {
  return PLACE_STATUS[masterPlace(view, seats)];
}

/** Two short lines for a dock: "DARK · Level 7" and "Spellcaster". */
export function masterDetailLines(card: DuelCardInfo): string[] {
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
 * pulsing when it can be used or picked, steady and stronger when picked), on an empty zone too (never a dashed outline),
 * plus a tag (a nib, or a check once picked).
 * A legal pile with a summoning circle already shows that signal, so it skips the glow and tag until selected.
 */
export function ZoneMarks({
  legal,
  selected,
  circle = false,
}: {
  legal: boolean;
  selected: boolean;
  circle?: boolean;
}) {
  const styles = useSkinStyles(baseStyles, "field");
  if (!legal && !selected) return null;
  if (circle && !selected) return null;
  return (
    <>
      <span className={styles.glow} data-state={selected ? "picked" : "usable"} aria-hidden="true" />
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

export function PileLabel({ kind, count }: { kind: string; count: number }) {
  const styles = useSkinStyles(baseStyles, "field");
  const [full, short] = PILE_WORDS[kind] ?? [kind, kind];
  return (
    <span className={styles.pileLabel}>
      <span className={styles.plFull}>{full}</span>
      <span className={styles.plShort}>{short}</span>
      <b className={styles.plCount} data-pile-count={count}>{count}</b>
    </span>
  );
}

export function ZoneSlot({
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
  offId,
  link,
  linkSeq,
  linkId,
  onActivate,
  onHoverCard,
}: {
  card: DuelCard | null;
  label: string;
  kind: string;
  /** A shared Extra Monster Zone seen from one of its two seats (plaza): `shared` = linked, `taken` = the card is the facing seat's. */
  link?: "shared" | "taken";
  /** Sequence of the zone (5 or 6): the pair link joins zone 5 of one seat with zone 6 of the other. */
  linkSeq?: number;
  /** Names the pair of linked cells ("0-1-5": seats 0 and 1, the zone that is zone 5 of the lower seat). Both cells carry the same id, so one hover or focus rule can light both. */
  linkId?: string;
  /** The core disabled this zone: test id suffix `{seat}-{m|s|f}-{sequence}`. Draws a dim zone with a cross. */
  offId?: string;
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
  const styles = useSkinStyles(baseStyles, "field");
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
      data-disabled={offId ? "true" : undefined}
      data-link={link}
      data-link-seq={link ? linkSeq : undefined}
      data-link-id={link ? linkId : undefined}
    >
      {link === "taken" ? <span className={styles.zoneLink} aria-hidden="true"><Link2 size={11} strokeWidth={2.4} /></span> : null}
      {offId ? <span className={styles.zoneOff} role="img" aria-label={`${label} (disabled)`} data-testid={`zone-disabled-${offId}`} /> : null}
      <button
        type="button"
        className={styles.zoneHit}
        aria-label={equipText ? `${label}. ${equipText}` : label}
        aria-pressed={selected}
        // A ghost is the facing seat's card: a click on it acts on nothing (hover still previews it).
        onClick={(event) => onActivate(keys, link === "taken" ? null : card, event.currentTarget)}
        onMouseEnter={(event) => onHoverCard?.(card, event.currentTarget)}
        onMouseLeave={() => onHoverCard?.(null, null)}
        onFocus={(event) => onHoverCard?.(card, event.currentTarget)}
        onBlur={() => onHoverCard?.(null, null)}
      >
        {!card && kind === "emz" ? <span className={styles.zoneName}>Extra Monster</span> : null}
        <div className={styles.frame} data-card-frame>
          {pendulum ? <span className={styles.pendulumMark} data-zone-label>P</span> : null}
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
          <ZoneMarks legal={legal} selected={selected} />
        </div>
        {pileCount != null ? <PileLabel kind={kind} count={pileCount} /> : null}
      </button>
    </div>
  );
}

/** The id both cells of one linked Extra Monster Zone carry: the lower seat first, then the zone that is its own zone 5 or 6 (the other seat sees it mirrored: 5 there is 6 here). */
export function linkIdOf(seat: number, other: number, sequence: number): string {
  return seat < other ? `${seat}-${other}-${sequence}` : `${other}-${seat}-${11 - sequence}`;
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

/** A touch that drifts further than this (px) is a scroll or a drag, not a long press. */
const HOLD_MOVE_LIMIT = 8;

const CHIP_TEXT: Record<string, string> = { gy: "Open GY", banish: "Open Banished", extra: "Open Extra Deck" };

export function PileSlot({
  label,
  count,
  kind,
  keys,
  cards,
  inspectable,
  sleeve,
  side,
  column,
  ownerSeat,
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
  /** The seat that owns a Main Deck. Its owner gets the Surrender menu on the deck (see deck-surrender.tsx). */
  ownerSeat?: number;
  side: "opp" | "you";
  /** Board column the pile sits in; the fan spreads toward the outer edge. */
  column: "left" | "right";
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  onActivate: DuelActivateHandler;
  onInspect: (target: InspectTarget) => void;
  onHoverCard?: DuelHoverHandler;
}) {
  const styles = useSkinStyles(baseStyles, "field");
  const legal = anyLegal(keys, legalKeys);
  const selected = anySelected(keys, selectedKeys);
  const circleTone = pileSummonTone({ kind, side, count, keys, legalKeys });
  const fan = fanEntries(kind, cards, count);
  const chip = CHIP_TEXT[kind];
  const hoverTop = kind === "gy" || kind === "banish" ? (cards[cards.length - 1] ?? null) : null;

  const surrender = useDeckSurrender();
  const deckMenu = kind === "deck" && ownerSeat != null && deckOffersSurrender(surrender, ownerSeat);
  // A deck that can act (summon, or a pick it can join) keeps its one-click action; the menu then opens on
  // right click and long press. A deck with no action opens the menu on a plain click.
  const deckActs = legal || selected;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const clearHold = () => {
    if (hold.current != null) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  // The menu belongs to the deck: it goes when the duel ends or the deck stops being the viewer's.
  useEffect(() => {
    if (!deckMenu) setMenuAnchor(null);
  }, [deckMenu]);
  // It also goes when the prompt or the turn changes, or the deck gains or loses its action: the rows would shift.
  const menuScope = surrender?.scope;
  useEffect(() => {
    setMenuAnchor(null);
  }, [menuScope, legal, selected]);
  // The room mutes the prompt keys and the right-click decline while the menu is open.
  const reportMenu = surrender?.onMenuOpenChange;
  const menuIsOpen = deckMenu && menuAnchor != null;
  useEffect(() => {
    reportMenu?.(menuIsOpen);
    return () => reportMenu?.(false);
  }, [reportMenu, menuIsOpen]);
  useEffect(() => clearHold, []);

  function activate(anchor: HTMLElement) {
    if (deckMenu && !deckActs) {
      setMenuAnchor(anchor);
      return;
    }
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
      data-pile="true"
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
        aria-pressed={deckMenu ? undefined : selected}
        data-duel-menu={deckMenu ? "" : undefined}
        onClick={(event) => activate(event.currentTarget)}
        onContextMenu={deckMenu ? (event) => {
          // The room's right-click decline must not see this click: it opens the menu, nothing else.
          event.preventDefault();
          event.stopPropagation();
          setMenuAnchor(event.currentTarget);
        } : undefined}
        onPointerDown={deckMenu ? (event) => {
          // A long press on touch opens the same menu as a tap.
          if (event.pointerType !== "touch") return;
          const target = event.currentTarget;
          clearHold();
          hold.current = {
            x: event.clientX,
            y: event.clientY,
            timer: window.setTimeout(() => {
              hold.current = null;
              // A press that began before a coin toss must not open the menu (surrender) under the cover.
              if (isCoinTossActive()) return;
              setMenuAnchor(target);
            }, 500),
          };
        } : undefined}
        onPointerMove={deckMenu ? (event) => {
          const start = hold.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > HOLD_MOVE_LIMIT) clearHold();
        } : undefined}
        onPointerUp={deckMenu ? clearHold : undefined}
        onPointerCancel={deckMenu ? clearHold : undefined}
        onPointerLeave={deckMenu ? clearHold : undefined}
        aria-haspopup={deckMenu ? "menu" : undefined}
        aria-expanded={deckMenu ? menuAnchor != null : undefined}
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
          <ZoneMarks legal={legal} selected={selected} circle={circleTone != null} />
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
      {deckMenu && menuAnchor ? (
        <CardActionMenu
          anchor={menuAnchor}
          title={label}
          options={deckMenuOptions(legal)}
          busy={surrender?.busy ?? false}
          onClose={closeMenu}
          onChoose={(option) => {
            const anchor = menuAnchor;
            closeMenu();
            if (option.id === DECK_SURRENDER_ID) surrender?.onSurrender();
            else if (option.id === DECK_USE_ID) onActivate(keys, null, anchor);
          }}
        />
      ) : null}
    </div>
  );
}

export function Tally({
  side,
  name,
  lp,
  seatKey,
  active,
  priorityLabel,
  spectator,
  reducedMotion,
  acting = false,
  badge = null,
}: {
  side: "opp" | "you";
  name: string;
  lp: number | null;
  seatKey: number | undefined;
  active: boolean;
  priorityLabel: string | null;
  spectator: boolean;
  reducedMotion: boolean;
  /** A replay fork: the seat that answers. Tagged "Acting" next to the name. */
  acting?: boolean;
  /** The Deck Master badge: a round portrait in the name plate (see master-badge.tsx). */
  badge?: ReactNode;
}) {
  const styles = useSkinStyles(baseStyles, "field");
  const priority = priorityLabel ? (
    <span className={styles.tPriority} title={priorityLabel}>
      <span className={styles.visuallyHidden}>{priorityLabel}</span>
      <span className={styles.tPriorityFull} data-priority-full aria-hidden="true">{spectator ? "to act" : priorityLabel}</span>
      <span className={styles.tPriorityShort} aria-hidden="true">To act</span>
    </span>
  ) : null;
  return (
    <div className={styles.tally} data-side={side} data-lp-seat={seatKey} data-active={active ? "true" : "false"} data-badge={badge ? "true" : undefined}>
      {badge ? <div className={styles.tBadge} data-dm-slot="">{badge}</div> : null}
      <div className={styles.tHead}>
        <span className={styles.tIdentity}>
          <span className={styles.tWho} aria-hidden={spectator && priorityLabel ? true : undefined}>{name}</span>
          {acting ? <span className={styles.tActing} data-acting>Acting</span> : null}
          {spectator ? priority : null}
        </span>
        {active ? (
          <span className={styles.tTurn}>Turn</span>
        ) : null}
        {!spectator ? priority : null}
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

export function HandStrip({
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
  const styles = useSkinStyles(baseStyles, "field");
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
        {(mine ? cards : [...cards].reverse()).map((card, index) => {
          const keys = [zoneKey(seat, LOCATION_HAND, card.sequence ?? index)];
          const revealed = card.code != null;
          const label = !revealed ? `${ownerLabel} card ${index + 1}` : (card.name ?? `Card ${card.code}`);
          const cardVars: CssVars = { "--i": index };
          return (
            <div
              key={`${seat}-hand-${card.handId ?? card.sequence ?? index}`}
              className={styles.handCard}
              data-hand-id={card.handId}
              data-hand-card="true"
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
      <div className={styles.handSizeProbe} data-hand-size-probe="true" data-side={mine ? "you" : "opp"} aria-hidden="true" />
    </div>
  );
}

/** The props of one Monster Zone of a seat. `flip` turns the art half way (the far side of the board). */
export function monsterZoneProps(
  view: DuelSeatView | undefined,
  sequence: number,
  options: { flip: boolean; callbacks: FieldCallbacks; owner?: string },
): ZoneSlotProps {
  const { flip, callbacks, owner } = options;
  const seat = view?.seat ?? 0;
  const card = slot(view?.monsters, sequence);
  return {
    card,
    label: `${owner ? `${owner} m` : "M"}onster zone ${sequence + 1}`,
    kind: "mz",
    offId: disabledZones(view).monsters[sequence] ? `${seat}-m-${sequence}` : undefined,
    keys: withExact(card, [zoneKey(seat, LOCATION_MZONE, sequence)]),
    legalKeys: callbacks.legalKeys,
    selectedKeys: callbacks.selectedKeys,
    showStats: true,
    flip,
    onActivate: callbacks.onActivate,
    onHoverCard: callbacks.onHoverCard,
  };
}

/** The props of one Spell and Trap Zone of a seat (the first and last one are the Pendulum zones from Master Rule 4). */
export function spellZoneProps(
  view: DuelSeatView | undefined,
  sequence: number,
  options: { flip: boolean; callbacks: FieldCallbacks; masterRule: DuelMasterRule; owner?: string; keys?: string[]; pendulum?: boolean },
): ZoneSlotProps {
  const { flip, callbacks, masterRule, owner } = options;
  const seat = view?.seat ?? 0;
  const card = slot(view?.spells, sequence);
  const pendulum = options.pendulum ?? (masterRule >= 4 && (sequence === 0 || sequence === ST_COUNT - 1));
  return {
    card,
    label: `${owner ? `${owner} s` : "S"}pell and Trap zone ${sequence + 1}${pendulum ? ", pendulum" : ""}`,
    kind: "st",
    offId: disabledZones(view).spells[sequence] ? `${seat}-s-${sequence}` : undefined,
    keys: options.keys ?? stKeys(seat, sequence, card, masterRule),
    legalKeys: callbacks.legalKeys,
    selectedKeys: callbacks.selectedKeys,
    pendulum,
    flip,
    onActivate: callbacks.onActivate,
    onHoverCard: callbacks.onHoverCard,
  };
}

/** The props of one Extra Monster Zone (`left` is column 2, `right` column 4); the model gives card, keys and off id. */
export function emzZoneProps(
  side: "left" | "right",
  options: { card: DuelCard | null; keys: string[]; offId: string | undefined; flip: boolean; callbacks: Pick<FieldCallbacks, "legalKeys" | "selectedKeys" | "onActivate" | "onHoverCard"> },
): ZoneSlotProps {
  const { card, keys, offId, flip, callbacks } = options;
  return {
    card,
    label: `Extra monster zone, column ${side === "left" ? 2 : 4}`,
    kind: "emz",
    offId,
    keys,
    legalKeys: callbacks.legalKeys,
    selectedKeys: callbacks.selectedKeys,
    showStats: true,
    flip,
    onActivate: callbacks.onActivate,
    onHoverCard: callbacks.onHoverCard,
  };
}

function MonsterRow({
  view,
  reversed,
  callbacks,
  flip,
  owner,
}: {
  view: DuelSeatView | undefined;
  reversed: boolean;
  callbacks: FieldCallbacks;
  /** Turn the art half way. Default: the same as `reversed` (the 1v1 far side). */
  flip?: boolean;
  /** Owner name in the zone labels (multi-seat boards, so labels stay unique). */
  owner?: string;
}) {
  const seat = view?.seat ?? 0;
  const order = reversed ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  return (
    <div className={styles.zones} data-monster-row={seat}>
      {order.map((sequence) => (
        <ZoneSlot key={`${seat}-mz-${sequence}`} {...monsterZoneProps(view, sequence, { flip: flip ?? reversed, callbacks, owner })} />
      ))}
    </div>
  );
}

function SpellRow({
  view,
  reversed,
  callbacks,
  masterRule,
  flip,
  owner,
}: {
  view: DuelSeatView | undefined;
  reversed: boolean;
  callbacks: FieldCallbacks;
  masterRule: DuelMasterRule;
  flip?: boolean;
  owner?: string;
}) {
  const seat = view?.seat ?? 0;
  const order = reversed ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  return (
    <div className={styles.zones}>
      {order.map((sequence) => (
        <ZoneSlot key={`${seat}-st-${sequence}`} {...spellZoneProps(view, sequence, { flip: flip ?? reversed, callbacks, masterRule, owner })} />
      ))}
    </div>
  );
}

export type PileKind = "deck" | "gy" | "banish" | "extra";

type PileSlotProps = ComponentProps<typeof PileSlot>;
type ZoneSlotProps = ComponentProps<typeof ZoneSlot>;

/**
 * The props of one pile of a seat (Main Deck, Graveyard, Banished or Extra Deck). The classic `PileColumn` and the
 * 3D table build their piles from this, so keys, labels and counts cannot drift apart. `flip` is the far side of the board.
 */
export function pileSlotProps(
  view: DuelSeatView | undefined,
  kind: PileKind,
  options: { ownerLabel: string; flip: boolean; column: "left" | "right"; callbacks: FieldCallbacks },
): PileSlotProps {
  const { ownerLabel: whose, flip, column, callbacks } = options;
  const seat = view?.seat ?? 0;
  const side: "opp" | "you" = flip ? "opp" : "you";
  const common = {
    side,
    column,
    legalKeys: callbacks.legalKeys,
    selectedKeys: callbacks.selectedKeys,
    onActivate: callbacks.onActivate,
    onInspect: callbacks.onInspect,
    onHoverCard: callbacks.onHoverCard,
  };
  if (kind === "deck") {
    return { ...common, label: `${whose} Main Deck`, count: view?.deckCount ?? 0, kind, keys: [zoneKey(seat, LOCATION_DECK, 0)],
      cards: [], inspectable: false, sleeve: "deck", ownerSeat: seat };
  }
  if (kind === "gy") {
    const gy = view?.graveyard ?? [];
    return { ...common, label: `${whose} Graveyard`, count: gy.length, kind, keys: pileHighlightKeys(seat, LOCATION_GRAVE, gy), cards: gy, inspectable: true };
  }
  if (kind === "banish") {
    const banished = view?.banished ?? [];
    return { ...common, label: `${whose} Banished`, count: banished.length, kind, keys: pileHighlightKeys(seat, LOCATION_REMOVED, banished), cards: banished, inspectable: true };
  }
  const extra = view?.extra ?? [];
  return { ...common, label: `${whose} Extra Deck`, count: view?.extraCount ?? extra.length, kind, keys: pileHighlightKeys(seat, LOCATION_EXTRA, extra),
    cards: extra, inspectable: true, sleeve: "extra" };
}

/** The props of a seat's Field Spell zone (keys `[FZONE 0, SZONE 5]`, the pile label shows 0 or 1). */
export function fieldZoneProps(
  view: DuelSeatView | undefined,
  options: { ownerLabel: string; flip: boolean; callbacks: FieldCallbacks },
): ZoneSlotProps {
  const { ownerLabel, flip, callbacks } = options;
  const seat = view?.seat ?? 0;
  const fieldSpell = slot(view?.spells, 5);
  return {
    card: fieldSpell,
    label: `${ownerLabel} Field Spell`,
    kind: "field",
    offId: disabledZones(view).field ? `${seat}-f-0` : undefined,
    keys: withExact(fieldSpell, [zoneKey(seat, LOCATION_FZONE, 0), zoneKey(seat, LOCATION_SZONE, 5)]),
    legalKeys: callbacks.legalKeys,
    selectedKeys: callbacks.selectedKeys,
    pileCount: fieldSpell ? 1 : 0,
    flip,
    onActivate: callbacks.onActivate,
    onHoverCard: callbacks.onHoverCard,
  };
}

function PileColumn({
  view,
  opponent,
  side,
  callbacks,
  ownerLabel,
  masterRule,
  flip,
}: {
  view: DuelSeatView | undefined;
  opponent: boolean;
  side: "left" | "right";
  callbacks: FieldCallbacks;
  ownerLabel: string;
  masterRule: DuelMasterRule;
  /** Turn the art half way. Default: the same as `opponent` (the 1v1 far side). */
  flip?: boolean;
}) {
  const seat = view?.seat ?? 0;
  const whose = ownerLabel;
  const turned = flip ?? opponent;
  const pile = (kind: PileKind) => <PileSlot key={kind} {...pileSlotProps(view, kind, { ownerLabel, flip: turned, column: side, callbacks })} />;
  const deck = pile("deck");
  const grave = pile("gy");
  const banish = pile("banish");
  const extraPile = pile("extra");
  const fieldPile = <ZoneSlot key="field" {...fieldZoneProps(view, { ownerLabel, flip: turned, callbacks })} />;

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
        <ZoneSlot card={pendulumCard} kind="st" pendulum flip={turned}
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
 * The turn light: a soft glow behind one half of the board, strongest at the outer edge of the screen
 * (like the turn side in Master Duel). Cool blue-violet below, warm amber-red above. No lines. It sits
 * under the sheet, so it never covers a card, a zone glow, the chain or a prompt. A response window
 * without the turn lifts a faint violet bloom on that half instead (`data-priority`).
 */
function TurnGlow({ side, turn, priority }: { side: "top" | "bottom"; turn: boolean; priority: boolean }) {
  return (
    <div className={styles.turnGlow} data-turn-glow data-side={side}
      data-turn={turn ? "true" : "false"} data-priority={priority ? "true" : "false"} aria-hidden="true" />
  );
}

/**
 * The duel board, restyled as a ruled match sheet.
 *
 * Root element: `<div data-duel-field="true" data-battle="true|false" data-reduced-motion="true|false">`.
 * It fills its parent (width and height 100%) and is a size container: the zone size `--z` is derived
 * from the smaller of the width-bound and height-bound fit, so the whole board is visible without scrolling.
 */
export function DuelField(props: DuelFieldProps) {
  const { engine, mySeat, masterRule, reducedMotion, legalKeys, selectedKeys, onActivate, onHoverCard, bottomName, topName,
    showExtraZones = true } = props;
  const boardRef = useRef<HTMLElement | null>(null);
  const { bottomIndex, topIndex, bottom, top, callbacks, topLabel, bottomLabel, battle, activity, priorityLabel,
    leftEmz, rightEmz, leftEmzKeys, rightEmzKeys, emzOff, equipLinks, actingSeat } = useDuelFieldModel({ ...props, boardRef });

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
      <TurnGlow side="top" turn={activity.turnSeat === topIndex} priority={activity.prioritySeat === topIndex} />
      <TurnGlow side="bottom" turn={activity.turnSeat === bottomIndex} priority={activity.prioritySeat === bottomIndex} />
      <div className={styles.playmat} data-hub={props.hub ? "true" : undefined}>
        <span className={styles.marginRule} aria-hidden="true" />
        {/* One mat, two fields: each half cracks from its own LP and keeps off the hand strips. */}
        <FieldCracks seat={topIndex} lp={top?.lp} part="top" avoidSelector={`.${styles.strip}`} splitSelector={`.${styles.emzBand}`} />
        <FieldCracks seat={bottomIndex} lp={bottom?.lp} part="bottom" avoidSelector={`.${styles.strip}`} splitSelector={`.${styles.emzBand}`} />
        <div className={`${styles.strip} ${styles.stripTop}`}>
          <Tally
            side="opp"
            name={topName}
            lp={top?.lp ?? null}
            seatKey={top?.seat}
            active={activity.turnSeat === topIndex}
            priorityLabel={priorityLabel(topIndex, topName)}
            acting={actingSeat === topIndex}
            spectator={mySeat == null || props.named === true}
            reducedMotion={reducedMotion}
            badge={top ? props.masterBadge?.(top.seat, "opp") : null}
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
            <PileColumn view={top} opponent side="left" callbacks={callbacks} ownerLabel={topLabel} masterRule={masterRule} />
            <div className={styles.rows}>
              <SpellRow view={top} reversed callbacks={callbacks} masterRule={masterRule} />
              <MonsterRow view={top} reversed callbacks={callbacks} />
            </div>
            <PileColumn view={top} opponent side="right" callbacks={callbacks} ownerLabel={topLabel} masterRule={masterRule} />
          </div>
          <div className={styles.emzBand}>
            {props.hub ? <div className={styles.emzHub} data-emz-zones={showExtraZones && masterRule >= 4 ? "true" : "false"}>{props.hub}</div> : null}
            {showExtraZones && masterRule >= 4 ? (
              <div className={styles.emzRow}>
                <div />
                <ZoneSlot {...emzZoneProps("left", { card: leftEmz, keys: leftEmzKeys, offId: emzOff(true), flip: leftEmz != null && leftEmz.controller === topIndex, callbacks })} />
                <div />
                <ZoneSlot {...emzZoneProps("right", { card: rightEmz, keys: rightEmzKeys, offId: emzOff(false), flip: rightEmz != null && rightEmz.controller === topIndex, callbacks })} />
                <div />
              </div>
            ) : <div />}
          </div>
          <div className={`${styles.half} ${styles.halfLocal}`} data-field-seat={bottomIndex} data-side="bottom"
            data-turn={activity.turnSeat === bottomIndex ? "true" : "false"}
            data-priority={activity.prioritySeat === bottomIndex ? "true" : "false"}>
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
            acting={actingSeat === bottomIndex}
            spectator={mySeat == null || props.named === true}
            reducedMotion={reducedMotion}
            badge={bottom ? props.masterBadge?.(bottom.seat, "you") : null}
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

/**
 * One seat of a 3 or 4 seat table: its own five-column board (Extra Monster Zones, Monster Zones, Spell and
 * Trap Zones, Field and Extra piles on the left, Banished, Graveyard and Deck on the right) with its hand.
 * The board is drawn like the bottom half of the 1v1 field, turned by `angleDeg`. It is `5.83` zone sizes
 * wide and `3.39` tall (`--z`, default 112px, set by `--sf-z`); the table stage places, scales and tilts it.
 *
 * DOM hooks for the effects: `data-zones` on every zone, `data-hand-seat` on the hand, `data-card-art` on art,
 * `data-side` (`you` or `opp`), `data-seat-angle` (the effective angle). The LP tally only renders with
 * `showTally`; a holo LP panel owns `data-lp-seat` otherwise.
 */
export const SeatField = memo(function SeatField({
  engine,
  seat,
  viewerSeat,
  masterRule,
  side,
  dataSide,
  angleDeg,
  tone,
  density,
  hand,
  emz: requestedEmz,
  pair,
  emzLink,
  showTally,
  usable,
  legalKeys,
  selectedKeys,
  reducedMotion,
  onActivate,
  onInspect,
  onHoverCard,
  name,
  scale,
}: SeatFieldProps) {
  const emz = masterRule < 4 ? "none" : requestedEmz;
  const view = engine.seats.find((entry) => entry.seat === seat);
  const callbacks: FieldCallbacks = { legalKeys, selectedKeys, onActivate, onInspect, onHoverCard };
  const angle = normalizeDeg(angleDeg);
  const label = name ?? `Player ${seat + 1}`;
  // A fork names every seat: the one that answers is not the camera seat, so neither is "Your".
  const forkLabels = useForkLabels();
  const owner = viewerSeat === seat && !forkLabels ? "Your" : label;
  const battle = isBattlePhase(engine.phase);
  const eliminated = view?.eliminated === true;
  const turn = engine.turnSeat === seat && !eliminated;
  const off = disabledZones(view);
  const equipLinks = useMemo(() => resolveEquipLinks(engine.seats), [engine.seats]);
  // Domain tables: the Deck Master Zone, a column of its own left of the Field Spell Zone (master-zone-context.ts).
  const MasterZone = useContext(MasterZoneContext);
  const dmz = MasterZone != null && view?.deckMaster != null && masterRule >= 4;
  const toneHex = SEAT_TONE_HEX[tone];
  const vars: CssVars = {
    "--t": hexToRgbTriplet(toneHex.main),
    "--tink": toneHex.ink,
    // The turn of this seat in degrees (raw, as the wrapper turns): a label that must read upright for the viewer (a rival's hand count) turns back by it.
    "--seat-turn": `${angleDeg}deg`,
    // Without a scale the wrapper owns the text scale (--sf-ts): the 4-way grid sizes its fields from outside, and a
    // size change must not draw the whole field again.
    ...(scale != null ? { "--ts": textScale(scale).toFixed(2) } : {}),
  };
  const emzSlot = (column: "left" | "right") => {
    const sequence = (column === "left") === (emz !== "shared-top") ? 5 : 6;
    const own = slot(view?.monsters, sequence);
    // The engine shares one row between this seat and `emzLink.other`: zone 5 here is zone 6 there. A card of the facing
    // seat in the mirrored zone blocks this one, so it shows here as a taken ghost (nothing to target).
    const across = emzLink && emz === "own" ? engine.seats.find((entry) => entry.seat === emzLink.other) : undefined;
    const ghost = own == null ? slot(across?.monsters, 11 - sequence) : null;
    const card = own ?? ghost;
    const link = emzLink && emz === "own" ? (ghost ? "taken" : "shared") : undefined;
    const keys = ghost ? [] : withExact(card, emz === "own" ? extraMonsterKeys(seat, seat, column, "own") : [zoneKey(seat, LOCATION_MZONE, sequence)]);
    const base = `${owner} Extra monster zone, column ${column === "left" ? 2 : 4}`;
    return (
      <ZoneSlot
        card={card}
        label={ghost ? `${base}, shared with ${emzLink?.otherName}: taken by their ${ghost.name ?? "monster"}` : emzLink ? `${base}, shared with ${emzLink.otherName}` : base}
        kind="emz"
        link={link}
        linkSeq={sequence}
        linkId={emzLink ? linkIdOf(seat, emzLink.other, sequence) : undefined}
        offId={off.monsters[sequence] ? `${seat}-m-${sequence}` : undefined}
        keys={keys}
        legalKeys={legalKeys}
        selectedKeys={selectedKeys}
        showStats
        flip={false}
        onActivate={onActivate}
        onHoverCard={onHoverCard}
      />
    );
  };
  // A facing pair shares ONE row of two Extra Monster Zones, like the two sides of a 1v1 table (see table/grid-layout.ts):
  // this seat is the "bottom" of it, the facing seat the "top". Left is this seat's seq 5 or the facing seat's seq 6.
  const pairSlot = (column: "left" | "right") => {
    const other = engine.seats.find((entry) => entry.seat === pair?.other);
    const card = extraMonster(view, other, column);
    const otherOff = other ? disabledZones(other) : null;
    const offId = column === "left"
      ? off.monsters[5] ? `${seat}-m-5` : otherOff?.monsters[6] ? `${other?.seat}-m-6` : undefined
      : off.monsters[6] ? `${seat}-m-6` : otherOff?.monsters[5] ? `${other?.seat}-m-5` : undefined;
    return (
      <ZoneSlot
        {...emzZoneProps(column, {
          card,
          keys: withExact(card, extraMonsterKeys(seat, pair?.other ?? seat, column)),
          offId,
          flip: card != null && (card.controller !== seat),
          callbacks,
        })}
        label={`Shared Extra monster zone, ${column}`}
      />
    );
  };

  return (
    <EquipLinksContext.Provider value={equipLinks}>
      <div
        className={cn(duelFontClasses, styles.seatField)}
        data-seat-field={seat}
        data-testid={`seat-field-${seat}`}
        data-seat={seat}
        data-side={dataSide ?? side}
        data-seat-angle={Math.round(angle)}
        data-tone={tone}
        data-density={density}
        data-turn={turn ? "true" : undefined}
        data-elim={eliminated ? "true" : undefined}
        data-usable={usable ? "true" : "false"}
        data-battle={battle ? "true" : "false"}
        data-reduced-motion={reducedMotion ? "true" : "false"}
        data-master-rule={masterRule}
        data-emz={emz === "pair" || emz === "none" ? emz : undefined}
        data-joined={emz === "pair" && pair?.joined ? "true" : undefined}
        data-framed={pair?.framed ? "true" : undefined}
        data-dmz={dmz ? "true" : undefined}
        style={vars}
      >
        <div className={styles.sfMat}>
          <FieldCracks seat={seat} lp={view?.lp} chunks={pair?.framed !== true} avoidSelector="[data-crack-avoid]" layoutToken={`${masterRule}:${emz}`} />
          {emz === "none" ? <span className={styles.sfCrackAvoid} data-crack-avoid="" aria-hidden="true" /> : null}
          <span className={styles.sfRule} aria-hidden="true" />
          <div className={styles.sfGrid}>
            {dmz && MasterZone ? <div className={styles.sfDm}><MasterZone seat={seat} side={side} /></div> : null}
            <PileColumn view={view} opponent={false} flip={false} side="left" callbacks={callbacks} ownerLabel={owner} masterRule={masterRule} />
            <div className={styles.sfEmz}>
              {masterRule >= 4 && emz === "pair" ? (
                <div className={styles.emzPair} style={{ "--pl": pair?.left ?? 0, "--pr": pair?.right ?? 0, "--pg": pair?.gap ?? 0.06 } as CssVars}>
                  {pairSlot("left")}
                  {pairSlot("right")}
                </div>
              ) : masterRule >= 4 && emz !== "none" ? (
                <div className={styles.emzRow}>
                  <div />
                  {emzSlot("left")}
                  <div />
                  {emzSlot("right")}
                  <div />
                </div>
              ) : null}
            </div>
            <div className={styles.sfRows}>
              <MonsterRow view={view} reversed={false} flip={false} owner={owner} callbacks={callbacks} />
              <SpellRow view={view} reversed={false} flip={false} owner={owner} callbacks={callbacks} masterRule={masterRule} />
            </div>
            <PileColumn view={view} opponent={false} flip={false} side="right" callbacks={callbacks} ownerLabel={owner} masterRule={masterRule} />
          </div>
        </div>
        {density !== "compact" ? <span className={styles.sfName} data-seat-name>{label}</span> : null}
        {showTally ? (
          <div className={styles.sfTally}>
            <Tally side={side} name={label} lp={view?.lp ?? null} seatKey={seat} active={turn}
              priorityLabel={null} spectator={viewerSeat == null} reducedMotion={reducedMotion} />
          </div>
        ) : null}
        {eliminated ? <span className={styles.sfOut} role="status">Eliminated</span> : null}
        {hand === "face" && view ? (
          <div className={styles.sfHand}>
            <HandStrip
              seat={seat}
              cards={view.hand}
              mine
              ownerLabel={owner}
              legalKeys={legalKeys}
              selectedKeys={selectedKeys}
              onActivate={onActivate}
              onHoverCard={onHoverCard}
            />
          </div>
        ) : null}
        {hand === "backs" && view ? <RivalHand seat={seat} count={view.hand.length} name={label} cards={view.hand} /> : null}
      </div>
    </EquipLinksContext.Provider>
  );
});

export function MasterDock({
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
  showInUse = false,
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
  /** Draw the zone empty ("In use") while the master is out of it, with the summon line; also the plate a summon flies out of. Every table passes it. */
  showInUse?: boolean;
}) {
  const styles = useSkinStyles(baseStyles, "field");
  const master = view?.deckMaster;
  const seats = useMasterSeats();
  const inUse = showInUse && masterInUse(view, seats);
  const card = view ? masterCard(view) : null;
  const keys = view ? withExact(card, [zoneKey(view.seat, LOCATION_DMZONE, 0)]) : [];
  const legal = anyLegal(keys, legalKeys);
  const selected = anySelected(keys, selectedKeys);
  const actions = local && canAct ? legalActionsFor(card, keys) : [];
  const status = view ? masterStatus(view, seats) : "";
  // The rail says the cost once, in the summon line; without showInUse it keeps "Next surcharge".
  const summonLine = showInUse ? masterSummonLine(view) : null;
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
      data-in-use={inUse ? "true" : undefined}
    >
      <h2 className={styles.masterTitle}>{title}</h2>
      {master && view ? (
        <>
          <button
            type="button"
            className={styles.masterHit}
            aria-label={`${title}: ${master.card.name}${inUse ? `, in use (${status})` : ""}`}
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
            <div className={styles.masterArt} data-master-dock={view.seat} data-master-source={showInUse ? view.seat : undefined} data-in-use={inUse ? "true" : undefined} data-away={status === "Elsewhere" && !inUse ? "true" : "false"}>
              {inUse ? <span className={styles.masterInUse} data-testid="master-dock-in-use">In use</span> : <img src={cardArtUrl(master.card.code, "full")} alt="" draggable={false} />}
              <ZoneMarks legal={legal} selected={selected} />
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
            {summonLine ? null : (
              <div>
                <dt>Next surcharge</dt>
                <dd>{surchargeText(masterNextCost(master))}</dd>
              </div>
            )}
          </dl>
          {summonLine ? <p className={styles.masterSummon} data-testid="master-dock-summon">{summonLine}</p> : null}
          {local ? (
            <div className={styles.masterActions}>
              {actions.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.masterAction}
                  data-primary={index === 0 ? "true" : "false"}
                  disabled={!canAct}
                  title={showInUse ? option.label : undefined}
                  onClick={() => onChooseAction(option)}
                >
                  {showInUse ? masterActionText(option, view, false) : option.label}
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
  topSeat,
  bottomSeat,
  rivals,
  selfTitle,
  showInUse = false,
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
  /** 3 and 4 seat tables: the opponent whose master shows in the top dock. */
  topSeat?: number | null;
  /** Replay camera: the seat whose master shows in the bottom dock when it is not `mySeat`. */
  bottomSeat?: number | null;
  /**
   * 3 and 4 seat tables: one dock per rival seat (small, read-only), in this order, above your own. Replaces the single
   * top dock. `title` is the dock heading, for example "Ryo's Master".
   */
  rivals?: ReadonlyArray<{ seat: number; title: string }>;
  /** The heading of the bottom dock, for example "Mika's Master" to a spectator of a table of 3. Default: "Your Master" / "Seat 1 Master". */
  selfTitle?: string;
  /** 3 and 4 seat tables and Tag: the docks draw an empty "In use" zone while a master is out of it. */
  showInUse?: boolean;
}) {
  const styles = useSkinStyles(baseStyles, "field");
  const bottomIndex = bottomSeat ?? mySeat ?? 0;
  const topIndex = topSeat ?? (bottomIndex === 0 ? 1 : 0);
  const bottom = engine.seats.find((seat) => seat.seat === bottomIndex);
  const top = engine.seats.find((seat) => seat.seat === topIndex);
  return (
    <div
      className={cn(duelFontClasses, styles.masterRail)}
      data-battle={isBattlePhase(engine.phase) ? "true" : "false"}
      data-docks={rivals ? rivals.length + 1 : undefined}
    >
      {(rivals ?? [{ seat: topIndex, title: mySeat == null ? "Seat 2 Master" : "Opponent Master" }]).map((rival) => (
        <MasterDock
          key={rival.seat}
          title={rival.title}
          view={rivals ? engine.seats.find((seat) => seat.seat === rival.seat) : top}
          local={false}
          legalKeys={legalKeys}
          selectedKeys={selectedKeys}
          canAct={false}
          legalActionsFor={legalActionsFor}
          onActivate={onActivate}
          onChooseAction={onChooseAction}
          onInspect={onInspect}
          onHoverCard={onHoverCard}
          showInUse={showInUse}
        />
      ))}
      <MasterDock
        title={selfTitle ?? (mySeat == null ? "Seat 1 Master" : "Your Master")}
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
        showInUse={showInUse}
      />
    </div>
  );
}
