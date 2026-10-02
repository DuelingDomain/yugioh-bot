"use client";

import type { DuelEngineView, DuelMasterRule } from "@yugidraft/shared/duels";
import { DuelField, type DuelActivateHandler, type DuelHoverHandler } from "./field";
import type { InspectTarget } from "./inspector";
import { FocusedSeatPick, SeatBoard, SeatExtras, SharedExtraZones, type SeatBoardCallbacks } from "./opponent-board";
import { SeatStrip } from "./seat-strip";
import { engineFormat, isEliminated, railGroups, seatDisabledMask, seatRelation, sharedExtraPairs, withoutSeatExtraKeys, withoutSeatExtraZones, type SeatPick } from "./multi-seat";
import styles from "./opponent-board.module.css";

/**
 * The board of a 3 or 4 seat table. A player sees the focused opponent and their own field at full size
 * (the usual DuelField) and every other seat as a compact board above it. A spectator sees all seats as a
 * 2x2 grid of compact boards. Every card and zone on a compact board answers prompts like a field zone.
 */
export function MultiSeatStage({
  engine,
  mySeat,
  masterRule,
  reducedMotion,
  legalKeys,
  selectedKeys,
  onActivate,
  onInspect,
  onHoverCard,
  nameOf,
  promptSeat,
  focusSeat,
  onFocusSeat,
  seatPick,
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
  nameOf: (seat: number) => string;
  promptSeat: number | null;
  focusSeat: number | null;
  onFocusSeat: (seat: number) => void;
  /** An opponent pick is open: the boards and strip entries of the offered seats answer it. */
  seatPick?: SeatPick | null;
}) {
  const format = engineFormat(engine);
  const spectator = mySeat == null;
  const callbacks: SeatBoardCallbacks = { legalKeys, selectedKeys, onActivate, onInspect, onHoverCard };
  const effectiveFocus = spectator ? null : focusSeat;
  const groups = railGroups(engine, mySeat, effectiveFocus);
  const focusView = effectiveFocus != null ? engine.seats.find((view) => view.seat === effectiveFocus) : undefined;
  const selfView = mySeat != null ? engine.seats.find((view) => view.seat === mySeat) : undefined;
  const selfOut = isEliminated(selfView);
  const extraPairs = masterRule >= 4 ? sharedExtraPairs(engine) : [];
  const sharedSeats = new Set(extraPairs.flatMap((pair) => pair.map((view) => view.seat)));
  // The focused opponent's separate EMZ and FFA4 shared EMZ have rows outside the main field.
  const fieldEngine = withoutSeatExtraZones(engine, effectiveFocus, sharedSeats);
  const fieldLegal = withoutSeatExtraKeys(legalKeys, effectiveFocus, sharedSeats);
  const fieldSelected = withoutSeatExtraKeys(selectedKeys, effectiveFocus, sharedSeats);
  return (
    <div className={styles.stage} data-testid="multi-seat-stage" data-format={format} data-spectator={spectator ? "true" : "false"}
      data-self-eliminated={selfOut ? "true" : "false"} data-picking={seatPick ? "true" : undefined}>
      <SeatStrip engine={engine} mySeat={mySeat} nameOf={nameOf} promptSeat={promptSeat}
        focusSeat={effectiveFocus} onFocusSeat={spectator ? undefined : onFocusSeat} pick={seatPick} />
      {selfOut ? <p className={styles.selfOut} role="status" data-testid="self-eliminated">You are eliminated. You are watching the duel.</p> : null}
      {groups.length > 0 ? (
        <div className={styles.rails} data-spectator={spectator ? "true" : "false"} data-testid="seat-rails">
          {groups.map((group) => (
            <div key={group.id} className={styles.rail} data-count={group.seats.length} data-group={group.id}
              data-grid={spectator ? "true" : "false"} data-testid={`seat-rail-${group.id}`}>
              {group.seats.map((view) => (
                <SeatBoard key={view.seat} view={view} name={nameOf(view.seat)}
                  relation={seatRelation(format, mySeat, view.seat)}
                  active={engine.turnSeat === view.seat} answering={promptSeat === view.seat}
                  callbacks={callbacks} reducedMotion={reducedMotion}
                  focusable={!spectator} onFocusSeat={onFocusSeat} masterRule={masterRule} format={format}
                  showExtraZones={!sharedSeats.has(view.seat)}
                  pick={seatPick} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {extraPairs.length > 0 ? (
        <div className={styles.sharedExtras}>
          {extraPairs.map((pair) => <SharedExtraZones key={pair[0].seat} pair={pair} nameOf={nameOf} callbacks={callbacks} />)}
        </div>
      ) : null}
      {focusView ? <FocusedSeatPick view={focusView} name={nameOf(focusView.seat)} pick={seatPick} /> : null}
      {focusView ? (
        <SeatExtras view={focusView} name={nameOf(focusView.seat)} masterRule={masterRule} showExtraZones={!sharedSeats.has(focusView.seat)} callbacks={callbacks} />
      ) : null}
      {selfView && seatDisabledMask(selfView) !== 0 ? (
        <SeatExtras view={selfView} name={nameOf(selfView.seat)} masterRule={masterRule} showExtraZones={false} callbacks={callbacks} />
      ) : null}
      {spectator || mySeat == null ? null : (
        <div className={styles.field} data-testid="seat-field">
          <DuelField engine={fieldEngine} mySeat={mySeat} masterRule={masterRule} reducedMotion={reducedMotion}
            legalKeys={fieldLegal} selectedKeys={fieldSelected} onActivate={onActivate}
            onHoverCard={onHoverCard} onInspect={onInspect}
            bottomName={nameOf(mySeat)} topName={focusSeat != null ? nameOf(focusSeat) : "Opponent"}
            showExtraZones={!sharedSeats.has(mySeat)}
            topSeat={focusSeat} topLabel={focusSeat != null ? nameOf(focusSeat) : undefined} />
        </div>
      )}
    </div>
  );
}
