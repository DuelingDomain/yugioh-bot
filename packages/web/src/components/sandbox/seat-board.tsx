"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Eraser } from "lucide-react";
import type { SandboxBotMode, SandboxDuelistId, SandboxCardEntry } from "@yugidraft/shared/duels";
import { SANDBOX_LIMITS } from "@yugidraft/shared/duels";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LP,
  PILE_ZONES,
  getEntry,
  seatIndex,
  slotCount,
  type CardLoc,
  type PileZone,
  type SandboxAction,
  type SandboxBuilderState,
  type SlotZone,
} from "./board-model";
import type { AddTarget } from "./placement";
import { PileRow } from "./pile-row";
import { CardPopover } from "./slot-popover";
import { ZoneSlot, type CardInfoMap, type SandboxDrag } from "./zone-slot";
import styles from "./builder.module.css";

const BOT_CHOICES: readonly { value: SandboxBotMode; label: string }[] = [
  { value: "pass", label: "Auto-pass" },
  { value: "practice", label: "Practice bot" },
  { value: "manual", label: "Manual" },
];

export const MONSTER_LABEL = ["Monster 1", "Monster 2", "Monster 3", "Monster 4", "Monster 5", "Extra Monster L", "Extra Monster R"];

export function sameLoc(a: CardLoc | null, b: CardLoc): boolean {
  return a !== null && a.seat === b.seat && a.zone === b.zone && a.index === b.index;
}

/** Everything the seat board asks of the builder. */
export interface SeatBoardActions {
  /** Apply one model action. The builder shows a refusal. Returns false when the model refused it. */
  act: (action: SandboxAction) => boolean;
  /** Click on a slot: place the selected card in an empty one, or toggle the popover of a filled one. */
  onSlot: (loc: CardLoc) => void;
  onDropOnLoc: (drag: SandboxDrag, to: CardLoc) => void;
  onSelectTarget: (target: AddTarget) => void;
  onAddArmedToPile: (zone: PileZone) => void;
  onOpen: (loc: CardLoc | null) => void;
  onAddMaterialByName: (loc: CardLoc, text: string) => Promise<string | null>;
}

export function SeatBoard({
  state,
  seat,
  infos,
  armedCode,
  target,
  open,
  actions,
}: {
  state: SandboxBuilderState;
  seat: SandboxDuelistId;
  infos: CardInfoMap;
  armedCode: number | null;
  target: AddTarget;
  open: CardLoc | null;
  actions: SeatBoardActions;
}) {
  const { board } = state;
  const index = seatIndex(seat);
  const domain = board.mode === "domain";
  const emz = slotCount(board, "monster") > 5;
  const setup = board[seat];

  function slot(zone: SlotZone, i: number, label: string): ReactNode {
    const loc: CardLoc = { seat, zone, index: i };
    const entry = getEntry(state, loc);
    const isOpen = sameLoc(open, loc);
    return (
      <ZoneSlot
        key={`${zone}-${i}`}
        label={label}
        zone={zone}
        loc={loc}
        entry={entry}
        info={entry === null ? undefined : infos.get(typeof entry === "number" ? entry : entry.card)}
        armed={armedCode !== null}
        active={isOpen}
        onActivate={() => actions.onSlot(loc)}
        onDropDrag={(drag) => actions.onDropOnLoc(drag, loc)}
        popover={isOpen && entry !== null ? (
          <CardPopover
            loc={loc}
            entry={entry}
            infos={infos}
            armedCode={armedCode}
            onAction={actions.act}
            onClose={() => actions.onOpen(null)}
            onAddMaterialByName={actions.onAddMaterialByName}
          />
        ) : null}
      />
    );
  }

  function pile(zone: PileZone, note?: ReactNode): ReactNode {
    const cards: readonly SandboxCardEntry[] = (setup?.[zone] as readonly SandboxCardEntry[] | undefined) ?? [];
    const openIndex = open && open.seat === seat && open.zone === zone ? open.index : null;
    return (
      <PileRow
        key={zone}
        seat={seat}
        zone={zone}
        cards={cards}
        infos={infos}
        isTarget={target === zone}
        armedCode={armedCode}
        note={note}
        openIndex={openIndex}
        onSelectTarget={() => actions.onSelectTarget(zone)}
        onToggleCard={(i) => actions.onOpen(openIndex === i ? null : { seat, zone, index: i })}
        onAddArmed={() => actions.onAddArmedToPile(zone)}
        onClear={() => actions.act({ type: "clearZone", seat, zone })}
        onDropDrag={(drag, i) => actions.onDropOnLoc(drag, { seat, zone, index: i })}
        renderPopover={(i) => {
          const loc: CardLoc = { seat, zone, index: i };
          const entry = getEntry(state, loc);
          return entry === null ? null : (
            <CardPopover loc={loc} entry={entry} infos={infos} armedCode={armedCode} onAction={actions.act} onClose={() => actions.onOpen(null)} onAddMaterialByName={actions.onAddMaterialByName} />
          );
        }}
      />
    );
  }

  const deckSize = board.deckSize ?? 20;
  const deckTop = setup?.deck?.length ?? 0;

  return (
    <div className={styles.seat}>
      <div className={styles.seatHead}>
        <h3>{seat.toUpperCase()}{index === 0 ? <span> You</span> : null}</h3>
        <LpField state={state} seat={seat} act={actions.act} />
        {index > 0 ? (
          <label className={styles.botField}>
            <span>Bot</span>
            <select
              className="input select"
              value={state.run.bots[String(index) as "1" | "2" | "3"]}
              onChange={(event) => actions.act({ type: "setBotMode", seat: index as 1 | 2 | 3, mode: event.target.value as SandboxBotMode })}
            >
              {BOT_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select>
          </label>
        ) : <span className={styles.botFixed}>Manual (you)</span>}
        <button type="button" className={cn("btn btn-quiet btn-sm", styles.clearSeat)} onClick={() => actions.act({ type: "clearSeat", seat })}>
          <Eraser size={14} aria-hidden /> Clear seat
        </button>
      </div>

      <div className={styles.seatBody}>
        <div className={styles.zones} role="group" aria-label={`Field of ${seat.toUpperCase()}`} style={{ "--rm": emz ? 2 : 1, "--rs": emz ? 3 : 2 } as React.CSSProperties}>
          {emz ? (
            <>
              <div className={styles.emzL}>{slot("monster", 5, MONSTER_LABEL[5])}</div>
              <div className={styles.emzR}>{slot("monster", 6, MONSTER_LABEL[6])}</div>
            </>
          ) : null}
          <div className={styles.fieldCell}>{slot("field", 0, "Field")}</div>
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className={styles.mCell} style={{ gridColumn: i + 2 }}>{slot("monster", i, MONSTER_LABEL[i])}</div>)}
          {domain ? <div className={styles.dmCell}>{slot("deckMaster", 0, "Deck Master")}</div> : null}
          <div className={styles.pendL}>{slot("pendulum", 0, "Pendulum L")}</div>
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className={styles.sCell} style={{ gridColumn: i + 2 }}>{slot("spell", i, `Spell/Trap ${i + 1}`)}</div>)}
          <div className={styles.pendR}>{slot("pendulum", 1, "Pendulum R")}</div>
        </div>

        <div className={styles.piles}>
          {PILE_ZONES.map((zone) => pile(zone, zone === "deck" ? <>+ {Math.max(0, deckSize - deckTop)} filler <span className="sr">cards below</span></> : undefined))}
        </div>
      </div>
    </div>
  );
}

/** The life point input of a seat. The table view reuses it in its seat badge. */
export function LpField({ state, seat, act }: { state: SandboxBuilderState; seat: SandboxDuelistId; act: (action: SandboxAction) => boolean }) {
  const stored = state.board[seat]?.lp;
  const [text, setText] = useState(stored === undefined ? "" : String(stored));
  useEffect(() => setText(stored === undefined ? "" : String(stored)), [stored, seat]);
  const teamLocked = state.board.format === "tag" && seatIndex(seat) >= 2;

  function commit() {
    const value = text.trim();
    const revert = () => setText(stored === undefined ? "" : String(stored));
    if (value === "") {
      if (stored !== undefined && !act({ type: "setLp", seat, lp: null })) revert();
      return;
    }
    const lp = Number(value);
    if (lp !== stored && !act({ type: "setLp", seat, lp })) revert();
  }

  return (
    <label className={styles.lpField}>
      <span>LP</span>
      <input
        className={cn("input num", styles.lpInput)}
        inputMode="numeric"
        value={text}
        placeholder={String(DEFAULT_LP)}
        disabled={teamLocked}
        title={teamLocked ? "Tag teams share LP. Set it on P0 and P1." : `${SANDBOX_LIMITS.lpMin} to ${SANDBOX_LIMITS.lpMax}`}
        aria-label={`Life points of ${seat.toUpperCase()}`}
        onChange={(event) => setText(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}
