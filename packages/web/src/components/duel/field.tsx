"use client";

import type { DuelCard, DuelEngineView, DuelMasterRule, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import { Search } from "lucide-react";
import { CardFace, cardFieldStats } from "./card-face";
import {
  cardArtUrl,
  formatLp,
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
  POS_FACEUP_ATTACK,
  ST_COUNT,
  zoneKey,
} from "./constants";
import type { InspectTarget } from "./inspector";
import styles from "./field.module.css";

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

function FeltEtch() {
  return (
    <svg className={styles.etch} viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="rgb(168 162 148 / 0.16)" strokeWidth="1">
        <path d="M70 70L930 930M78 62L938 922M930 70L70 930M922 62L62 922" />
      </g>
    </svg>
  );
}

function FeltSun() {
  return (
    <svg className={styles.sun} viewBox="400 400 200 200" aria-hidden="true">
      <g fill="none" stroke="rgb(186 168 120 / 0.28)" strokeWidth="1">
        <circle cx="500" cy="500" r="73" />
        <circle cx="500" cy="500" r="83" />
      </g>
      <circle cx="500" cy="500" r="30" fill="none" stroke="rgb(176 168 150 / 0.38)" strokeWidth="1.15" />
      <path
        fill="rgb(170 162 140 / 0.22)"
        d="M529.9 497.3L560.0 500.0L529.9 502.7ZM528.6 508.9L555.4 523.0L526.6 513.9ZM523.0 519.2L542.4 542.4L519.2 523.0ZM513.9 526.6L523.0 555.4L508.9 528.6ZM502.7 529.9L500.0 560.0L497.3 529.9ZM491.1 528.6L477.0 555.4L486.1 526.6ZM480.8 523.0L457.6 542.4L477.0 519.2ZM473.4 513.9L444.6 523.0L471.4 508.9ZM470.1 502.7L440.0 500.0L470.1 497.3ZM471.4 491.1L444.6 477.0L473.4 486.1ZM477.0 480.8L457.6 457.6L480.8 477.0ZM486.1 473.4L477.0 444.6L491.1 471.4ZM497.3 470.1L500.0 440.0L502.7 470.1ZM508.9 471.4L523.0 444.6L513.9 473.4ZM519.2 477.0L542.4 457.6L523.0 480.8ZM526.6 486.1L555.4 477.0L528.6 491.1Z"
      />
    </svg>
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
  caption,
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
  caption?: string;
  onActivate: DuelActivateHandler;
  onHoverCard?: DuelHoverHandler;
}) {
  const legal = anyLegal(keys, legalKeys);
  const selected = anySelected(keys, selectedKeys);
  const stats = cardFieldStats(card, showStats);

  return (
    <div
      className={styles.zone}
      data-kind={kind}
      data-legal={legal ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
    >
      <button
        type="button"
        className={styles.zoneHit}
        aria-label={label}
        aria-pressed={selected}
        onClick={(event) => onActivate(keys, card, event.currentTarget)}
        onMouseEnter={(event) => onHoverCard?.(card, event.currentTarget)}
        onMouseLeave={() => onHoverCard?.(null, null)}
        onFocus={(event) => onHoverCard?.(card, event.currentTarget)}
        onBlur={() => onHoverCard?.(null, null)}
      >
        <div className={styles.frame}>
          {pendulum ? <span className={styles.pendulumMark}>P</span> : null}
          {card ? <CardFace card={card} sleeve={sleeve} /> : sleeve ? <CardFace card={null} sleeve={sleeve} /> : null}
        </div>
        {stats ? <span className={styles.statLine}>{stats}</span> : null}
        {caption && !stats ? <span className={styles.pileLabel}>{caption}</span> : null}
      </button>
    </div>
  );
}

function PileSlot({
  label,
  count,
  kind,
  keys,
  cards,
  top,
  inspectable,
  sleeve,
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
  top: DuelCard | null;
  inspectable: boolean;
  sleeve?: "deck" | "extra";
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  onActivate: DuelActivateHandler;
  onInspect: (target: InspectTarget) => void;
  onHoverCard?: DuelHoverHandler;
}) {
  const legal = anyLegal(keys, legalKeys);
  const selected = anySelected(keys, selectedKeys);
  const caption = `${label} (${count})`;
  const shortLabel = kind === "deck" ? "Deck" : kind === "gy" ? "GY" : kind === "banish" ? "Ban." : kind === "extra" ? "Extra" : "Field";
  const showFace = kind === "gy" || kind === "banish" || kind === "field";

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
      data-kind={kind}
      data-legal={legal ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
    >
      <button
        type="button"
        className={styles.zoneHit}
        aria-label={caption}
        aria-pressed={selected}
        onClick={(event) => activate(event.currentTarget)}
        onMouseEnter={(event) => onHoverCard?.(showFace ? top : null, event.currentTarget)}
        onMouseLeave={() => onHoverCard?.(null, null)}
        onFocus={(event) => onHoverCard?.(showFace ? top : null, event.currentTarget)}
        onBlur={() => onHoverCard?.(null, null)}
      >
        <div className={styles.frame}>
          {showFace && top ? (
            <CardFace card={top} sleeve={sleeve} />
          ) : count > 0 ? (
            <CardFace card={null} sleeve={sleeve ?? (kind === "extra" ? "extra" : "deck")} />
          ) : null}
        </div>
        <span className={styles.pileLabel}>{shortLabel} {count}</span>
      </button>
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
  return (
    <div className={`${styles.handRail} ${mine ? styles.handRailLocal : ""}`}>
      <div className={`${styles.hand} ${mine ? styles.handLocal : ""}`} aria-label={`${ownerLabel} hand`}>
        {cards.map((card, index) => {
          const keys = [zoneKey(seat, LOCATION_HAND, card.sequence ?? index)];
          const label = card.code == null ? `${ownerLabel} card ${index + 1}` : (card.name ?? `Card ${card.code}`);
          return (
            <div key={`${seat}-hand-${card.sequence ?? index}`} className={styles.handCard}>
              <ZoneSlot
                card={card}
                label={label}
                kind="hand"
                keys={keys}
                legalKeys={legalKeys}
                selectedKeys={selectedKeys}
                showStats={mine}
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
  const deck = (
    <PileSlot
      label={`${whose} Main Deck`}
      count={view?.deckCount ?? 0}
      kind="deck"
      keys={[zoneKey(seat, LOCATION_DECK, 0)]}
      cards={[]}
      top={null}
      inspectable={false}
      sleeve="deck"
      legalKeys={callbacks.legalKeys}
      selectedKeys={callbacks.selectedKeys}
      onActivate={callbacks.onActivate}
      onInspect={callbacks.onInspect}
      onHoverCard={callbacks.onHoverCard}
    />
  );
  const grave = (
    <PileSlot
      label={`${whose} Graveyard`}
      count={gy.length}
      kind="gy"
      keys={pileHighlightKeys(seat, LOCATION_GRAVE, gy)}
      cards={gy}
      top={gy[gy.length - 1] ?? null}
      inspectable
      legalKeys={callbacks.legalKeys}
      selectedKeys={callbacks.selectedKeys}
      onActivate={callbacks.onActivate}
      onInspect={callbacks.onInspect}
      onHoverCard={callbacks.onHoverCard}
    />
  );
  const banish = (
    <PileSlot
      label={`${whose} Banished`}
      count={banished.length}
      kind="banish"
      keys={pileHighlightKeys(seat, LOCATION_REMOVED, banished)}
      cards={banished}
      top={banished[banished.length - 1] ?? null}
      inspectable
      legalKeys={callbacks.legalKeys}
      selectedKeys={callbacks.selectedKeys}
      onActivate={callbacks.onActivate}
      onInspect={callbacks.onInspect}
      onHoverCard={callbacks.onHoverCard}
    />
  );
  const extraPile = (
    <PileSlot
      label={`${whose} Extra Deck`}
      count={view?.extraCount ?? extra.length}
      kind="extra"
      keys={pileHighlightKeys(seat, LOCATION_EXTRA, extra)}
      cards={extra}
      top={null}
      inspectable
      sleeve="extra"
      legalKeys={callbacks.legalKeys}
      selectedKeys={callbacks.selectedKeys}
      onActivate={callbacks.onActivate}
      onInspect={callbacks.onInspect}
      onHoverCard={callbacks.onHoverCard}
    />
  );
  const fieldPile = (
    <ZoneSlot
      card={fieldSpell}
      label={`${whose} Field Spell`}
      kind="field"
      keys={withExact(fieldSpell, [zoneKey(seat, LOCATION_FZONE, 0), zoneKey(seat, LOCATION_SZONE, 5)])}
      legalKeys={callbacks.legalKeys}
      selectedKeys={callbacks.selectedKeys}
      caption={`Field ${fieldSpell ? 1 : 0}`}
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
    <div className={styles.piles}>
      {masterRule === 3 ? (
        <ZoneSlot card={pendulumCard} kind="st" pendulum
          label={`${whose} ${pendulumSequence === 6 ? "left" : "right"} Pendulum zone`}
          keys={stKeys(seat, pendulumSequence, pendulumCard, masterRule)}
          legalKeys={callbacks.legalKeys} selectedKeys={callbacks.selectedKeys}
          onActivate={callbacks.onActivate} onHoverCard={callbacks.onHoverCard} />
      ) : null}
      {items}
    </div>
  );
}

export function DuelField({
  engine,
  mySeat,
  masterRule,
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

  const leftEmz = extraMonster(bottom, top, "left");
  const rightEmz = extraMonster(bottom, top, "right");
  const leftEmzKeys = withExact(leftEmz, extraMonsterKeys(bottomIndex, topIndex, "left"));
  const rightEmzKeys = withExact(rightEmz, extraMonsterKeys(bottomIndex, topIndex, "right"));

  return (
    <div className={styles.felt}>
      <div className={`${styles.feltTrim} ${styles.chamfer}`} aria-hidden="true" />
      <FeltEtch />
      <div className={`${styles.lpBadge} ${styles.lpOpp}`}>
        <span className={styles.lpName}>{topName}</span>
        <strong><span className={styles.lpPrefix}>LP</span>{top ? formatLp(top.lp) : "—"}</strong>
      </div>
      <div className={`${styles.lpBadge} ${styles.lpYou}`}>
        <span className={styles.lpName}>{bottomName}</span>
        <strong><span className={styles.lpPrefix}>LP</span>{bottom ? formatLp(bottom.lp) : "—"}</strong>
      </div>
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
      <div className={styles.half}>
        <PileColumn view={top} opponent side="left" callbacks={callbacks} ownerLabel={topLabel} masterRule={masterRule} />
        <div className={styles.rows}>
          <SpellRow view={top} reversed callbacks={callbacks} masterRule={masterRule} />
          <MonsterRow view={top} reversed callbacks={callbacks} />
        </div>
        <PileColumn view={top} opponent side="right" callbacks={callbacks} ownerLabel={topLabel} masterRule={masterRule} />
      </div>
      <div className={styles.emzBand}>
        <FeltSun />
        <div />
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
            onActivate={onActivate}
            onHoverCard={onHoverCard}
          />
          <div />
        </div>
        ) : <div />}
        <div />
      </div>
      <div className={`${styles.half} ${styles.halfLocal}`}>
        <PileColumn view={bottom} opponent={false} side="left" callbacks={callbacks} ownerLabel={bottomLabel} masterRule={masterRule} />
        <div className={styles.rows}>
          <MonsterRow view={bottom} reversed={false} callbacks={callbacks} />
          <SpellRow view={bottom} reversed={false} callbacks={callbacks} masterRule={masterRule} />
        </div>
        <PileColumn view={bottom} opponent={false} side="right" callbacks={callbacks} ownerLabel={bottomLabel} masterRule={masterRule} />
      </div>
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
        <div className={`${styles.handRail} ${styles.handRailLocal}`}><div className={`${styles.hand} ${styles.handLocal}`} /></div>
      )}
    </div>
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
      <span className={styles.chamfer} aria-hidden="true" />
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
            <div className={styles.masterArt}>
              <img src={cardArtUrl(master.card.code, "full")} alt="" draggable={false} />
            </div>
            <div className={styles.masterMeta}>
              <span>{masterStatus(view)}</span>
              <span>Returns {master.returns}</span>
              <span>Next surcharge {master.nextCost} LP</span>
            </div>
          </button>
          {local ? (
            <div className={styles.masterActions}>
              {actions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.masterAction}
                  disabled={!canAct}
                  onClick={() => onChooseAction(option)}
                >
                  {option.label}
                </button>
              ))}
              <button type="button" className={styles.masterInspect} onClick={inspect}>
                <Search size={14} strokeWidth={2} aria-hidden />
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
    <div className={styles.masterRail}>
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
