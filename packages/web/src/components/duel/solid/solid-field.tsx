"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import type { DuelMasterRule, DuelCard, DuelSeatView } from "@yugidraft/shared/duels";
import { cn } from "@/lib/utils";
import { ST_COUNT } from "../constants";
import { EquipFx } from "../equip-fx";
import { EquipLinksContext } from "../equip-chip";
import {
  emzZoneProps,
  fieldZoneProps,
  HandStrip,
  monsterZoneProps,
  pileSlotProps,
  PileSlot,
  spellZoneProps,
  Tally,
  ZoneSlot,
  type PileKind,
} from "../field";
import baseStyles from "../field.module.css";
import { stKeys, withExact, type FieldCallbacks } from "../field-keys";
import { useDuelFieldModel, type DuelFieldModel, type DuelFieldProps } from "../field-model";
import { Emblem } from "./emblem";
import { DmChip } from "./dm-chip";
import rails from "./rails.module.css";
import table from "./table.module.css";

/** What SolidField takes: the 1v1 field props (the same as the classic board) plus two hooks from the room. */
export type SolidFieldProps = DuelFieldProps & {
  /** The duel clock of one seat, drawn in that player's gap of the centre band. Nothing when the duel has no clock. */
  renderClock?: (seat: number) => ReactNode;
  /** Opens the Deck Masters sheet (the mobile chips). */
  onOpenMasters?: () => void;
};

/** The derived field state (seats, activity, priority ...), for the rails and chips below SolidField. */
export const SolidFieldModelContext = createContext<DuelFieldModel | null>(null);
export function useSolidFieldModel(): DuelFieldModel | null {
  return useContext(SolidFieldModelContext);
}

/** One cell of the plane grid. Columns 1 to 7, rows 1 to 5 (spec 2.5). */
function Cell({ col, row, kind, children }: { col: number; row: number; kind: string; children: ReactNode }) {
  return (
    <div className={table.cell} data-cell={kind} style={{ gridColumn: col, gridRow: row }}>
      {children}
    </div>
  );
}

/**
 * Master Rule 3 has no Extra Monster Zones and keeps its two Pendulum zones (spell sequences 6 and 7) beside the
 * piles. The 7x5 table has no room for them, so they share S1 and S5: the cell answers to the keys of both.
 */
function spellKeys(seat: number, sequence: number, card: DuelCard | null, masterRule: DuelMasterRule): string[] {
  if (masterRule !== 3 || (sequence !== 0 && sequence !== ST_COUNT - 1)) return stKeys(seat, sequence, card, masterRule);
  const pendulum = sequence === 0 ? 6 : 7;
  return withExact(card, [...new Set([...stKeys(seat, sequence, null, masterRule), ...stKeys(seat, pendulum, null, masterRule)])]);
}

function PileCell({ view, kind, ownerLabel, flip, column, callbacks, col, row, cell = "pile" }: {
  view: DuelSeatView | undefined;
  kind: PileKind;
  ownerLabel: string;
  flip: boolean;
  column: "left" | "right";
  callbacks: FieldCallbacks;
  col: number;
  row: number;
  cell?: string;
}) {
  return (
    <Cell col={col} row={row} kind={cell}>
      <PileSlot {...pileSlotProps(view, kind, { ownerLabel, flip, column, callbacks })} />
    </Cell>
  );
}

function FieldCell({ view, ownerLabel, flip, callbacks, col, row }: {
  view: DuelSeatView | undefined;
  ownerLabel: string;
  flip: boolean;
  callbacks: FieldCallbacks;
  col: number;
  row: number;
}) {
  return (
    <Cell col={col} row={row} kind="pile">
      <ZoneSlot {...fieldZoneProps(view, { ownerLabel, flip, callbacks })} />
    </Cell>
  );
}

/** One half of the table. Cells carry the grid position; the wrapper (display: contents) carries the seat hooks. */
function Half({ view, seatIndex, opponent, ownerLabel, masterRule, callbacks, activity }: {
  view: DuelSeatView | undefined;
  seatIndex: number;
  opponent: boolean;
  ownerLabel: string;
  masterRule: DuelMasterRule;
  callbacks: FieldCallbacks;
  activity: DuelFieldModel["activity"];
}) {
  const seat = view?.seat ?? 0;
  const spellRow = opponent ? 1 : 5;
  const monsterRow = opponent ? 2 : 4;
  // The far side reads right to left, so the sequences run 5..1 from the left edge.
  const order = opponent ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  return (
    <div className={table.halfWrap} data-field-seat={seatIndex} data-side={opponent ? "top" : "bottom"}
      data-turn={activity.turnSeat === seatIndex ? "true" : "false"}
      data-priority={activity.prioritySeat === seatIndex ? "true" : "false"}>
      {order.map((sequence, index) => {
        const props = spellZoneProps(view, sequence, { flip: opponent, callbacks, masterRule, pendulum: masterRule >= 3 && (sequence === 0 || sequence === ST_COUNT - 1) });
        return (
          <Cell key={`st-${sequence}`} col={2 + index} row={spellRow} kind="st">
            <ZoneSlot {...props} keys={spellKeys(seat, sequence, props.card, masterRule)} />
          </Cell>
        );
      })}
      {order.map((sequence, index) => (
        <Cell key={`mz-${sequence}`} col={2 + index} row={monsterRow} kind="mz">
          <ZoneSlot {...monsterZoneProps(view, sequence, { flip: opponent, callbacks })} />
        </Cell>
      ))}
      {opponent ? (
        <>
          <PileCell view={view} kind="deck" ownerLabel={ownerLabel} flip column="left" callbacks={callbacks} col={1} row={1} />
          <PileCell view={view} kind="gy" ownerLabel={ownerLabel} flip column="left" callbacks={callbacks} col={1} row={2} />
          <PileCell view={view} kind="banish" ownerLabel={ownerLabel} flip column="left" callbacks={callbacks} col={1} row={3} cell="band-pile" />
          <PileCell view={view} kind="extra" ownerLabel={ownerLabel} flip column="right" callbacks={callbacks} col={7} row={1} />
          <FieldCell view={view} ownerLabel={ownerLabel} flip callbacks={callbacks} col={7} row={2} />
        </>
      ) : (
        <>
          <FieldCell view={view} ownerLabel={ownerLabel} flip={false} callbacks={callbacks} col={1} row={4} />
          <PileCell view={view} kind="extra" ownerLabel={ownerLabel} flip={false} column="left" callbacks={callbacks} col={1} row={5} />
          <PileCell view={view} kind="banish" ownerLabel={ownerLabel} flip={false} column="right" callbacks={callbacks} col={7} row={3} cell="band-pile" />
          <PileCell view={view} kind="gy" ownerLabel={ownerLabel} flip={false} column="right" callbacks={callbacks} col={7} row={4} />
          <PileCell view={view} kind="deck" ownerLabel={ownerLabel} flip={false} column="right" callbacks={callbacks} col={7} row={5} />
        </>
      )}
    </div>
  );
}

/**
 * The 1v1 duel board in the Solid Vision look (3D mode). It takes the props of the classic `DuelField` and uses the
 * same field model and the same zone, pile and hand components, so keys, labels, counts and hooks cannot drift.
 *
 * Root element: `<div data-duel-field data-battle data-reduced-motion data-master-rule>`. It is NOT tilted (the FX
 * engine shakes it). Inside it: the opponent rail, `.fieldwrap` (perspective) with `.plane` (the only tilted node,
 * 7x5 grid), and your rail. The FX layers are flat siblings of this root (see room.tsx `renderBoard`).
 *
 * Plane rows: 1 opponent Spell/Trap row with Deck and Extra; 2 opponent Monster row with GY and Field; 3 band with
 * the Banished piles, the two Extra Monster Zones (MR4+) and the two clock cells (`data-sv-clock="opp"` in column 2,
 * `data-sv-clock="you"` in column 6); 4 your Monster row; 5 your Spell/Trap row.
 */
export function SolidField(props: SolidFieldProps) {
  const { engine, mySeat, masterRule, reducedMotion, legalKeys, selectedKeys, onActivate, onHoverCard, bottomName, topName,
    showExtraZones = true, renderClock, onOpenMasters } = props;
  const boardRef = useRef<HTMLElement | null>(null);
  const model = useDuelFieldModel({ ...props, boardRef });
  const { bottomIndex, topIndex, bottom, top, callbacks, topLabel, bottomLabel, battle, activity, priorityLabel,
    leftEmz, rightEmz, leftEmzKeys, rightEmzKeys, emzOff, equipLinks } = model;
  const spectator = mySeat == null;
  const showEmz = showExtraZones && masterRule >= 4;

  const rail = (side: "opp" | "you") => {
    const index = side === "opp" ? topIndex : bottomIndex;
    const view = side === "opp" ? top : bottom;
    const name = side === "opp" ? topName : bottomName;
    const ownerLabel = side === "opp" ? topLabel : bottomLabel;
    const mine = side === "you";
    return (
      <div className={cn(rails.rail)} data-sv-rail={side}>
        <div className={rails.railPlate}>
          <Tally
            side={side}
            name={name}
            lp={view?.lp ?? null}
            seatKey={view?.seat}
            active={activity.turnSeat === index}
            priorityLabel={priorityLabel(index, name)}
            spectator={spectator}
            reducedMotion={reducedMotion}
          />
        </div>
        <div className={rails.railHand} data-side={side}>
          {view ? (
            <HandStrip
              seat={view.seat}
              cards={view.hand}
              mine={mine}
              ownerLabel={ownerLabel}
              legalKeys={legalKeys}
              selectedKeys={selectedKeys}
              onActivate={onActivate}
              onHoverCard={onHoverCard}
            />
          ) : (
            <div className={baseStyles.handRail}><div className={cn(baseStyles.hand, mine && baseStyles.handLocal)} /></div>
          )}
        </div>
        {onOpenMasters && view?.deckMaster?.card ? (
          <div className={rails.railChip}>
            <DmChip seat={view.seat} view={view} mine={mine} onOpen={onOpenMasters} />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <EquipLinksContext.Provider value={equipLinks}>
    <SolidFieldModelContext.Provider value={model}>
    <div
      className={cn(baseStyles.felt, table.root)}
      ref={(node) => { boardRef.current = node?.parentElement ?? null; }}
      data-duel-field="true"
      data-battle={battle ? "true" : "false"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-master-rule={masterRule}
    >
      {rail("opp")}
      <div className={table.fieldwrap}>
        <div className={table.plane} data-sv-plane="" data-light={activity.turnSeat === bottomIndex ? "you" : "opp"}>
          <Emblem />
          <Half view={top} seatIndex={topIndex} opponent ownerLabel={topLabel} masterRule={masterRule} callbacks={callbacks} activity={activity} />
          {showEmz ? (
            <>
              <Cell col={3} row={3} kind="emz">
                <ZoneSlot {...emzZoneProps("left", { card: leftEmz, keys: leftEmzKeys, offId: emzOff(true), flip: leftEmz != null && leftEmz.controller === topIndex, callbacks })} />
              </Cell>
              <Cell col={5} row={3} kind="emz">
                <ZoneSlot {...emzZoneProps("right", { card: rightEmz, keys: rightEmzKeys, offId: emzOff(false), flip: rightEmz != null && rightEmz.controller === topIndex, callbacks })} />
              </Cell>
            </>
          ) : null}
          <div className={table.clock} data-sv-clock="opp" style={{ gridColumn: 2, gridRow: 3 }}>{renderClock?.(topIndex)}</div>
          <div className={table.clock} data-sv-clock="you" style={{ gridColumn: 6, gridRow: 3 }}>{renderClock?.(bottomIndex)}</div>
          <Half view={bottom} seatIndex={bottomIndex} opponent={false} ownerLabel={bottomLabel} masterRule={masterRule} callbacks={callbacks} activity={activity} />
        </div>
      </div>
      {rail("you")}
      <EquipFx links={equipLinks} events={engine.events} duelKey="field" reducedMotion={reducedMotion} />
    </div>
    </SolidFieldModelContext.Provider>
    </EquipLinksContext.Provider>
  );
}
