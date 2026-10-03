"use client";

import { useMemo } from "react";
import { seatsOfTeam, teamOfSeat, type DuelEvent, type DuelEngineView } from "@yugidraft/shared/duels";
import { BattleFx } from "../battle-fx";
import { ChainFx } from "../chain-fx";
import { DestroyFx } from "../destroy-fx";
import { DuelFeedback } from "../feedback";
import { FxBoundary } from "../fx-boundary";
import { MasterReturnFx } from "../master-return-fx";
import { MoveFx } from "../move-fx";
import { PositionFx } from "../position-fx";
import type { PrioritySlot } from "../priority-chips";
import { useDuelPreferences } from "../preferences";
import { SummonFx } from "../summon-fx";
import { tableLayout } from "../table/geometry";
import { toneBySeat } from "../table/seat-state";
import { SEAT_TONE_HEX, type TableController } from "../table/types";
import { tagResponseOrder } from "./live-tag";

/** The part of the live controller the effects read. `TableController` fits, so the shell passes its own. */
export type TagFxController = Pick<TableController, "engine" | "room" | "viewerSeat" | "nameOf" | "prompt" | "reducedMotion">;

export interface TagFxProps {
  controller: TagFxController;
  /** False while the connection is down or recovering: nothing plays, so no effect replays old events. */
  fxActive?: boolean;
  /** Seats that passed on the open chain (the shell tracks them); the chain chips follow them. */
  passedSeats?: readonly number[];
}

const sameTeam = (a: number, b: number) => teamOfSeat("tag", a) === teamOfSeat("tag", b);

/**
 * One effect per hit. The engine makes one damage event per core message; if a team's loss reaches the view once per
 * member, the second event is a mirror of the first and would play the same effect twice. A damage event is dropped when
 * its id was seen already, or when the damage event right before it hit a team mate for the same amount and cause.
 */
export function dedupeTeamDamage(events: readonly DuelEvent[]): readonly DuelEvent[] {
  const seen = new Set<number>();
  const kept: DuelEvent[] = [];
  let previous: DuelEvent | null = null;
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const mirror =
      event.kind === "damage" &&
      previous?.kind === "damage" &&
      event.seat != null &&
      previous.seat != null &&
      event.seat !== previous.seat &&
      sameTeam(event.seat, previous.seat) &&
      event.amount === previous.amount &&
      event.cause === previous.cause;
    previous = event;
    if (!mirror) kept.push(event);
  }
  return kept.length === events.length ? events : kept;
}

/**
 * Who may answer the open chain, in order, for the chain chips: the team that answers now (the opposing team first,
 * R-TAG-RESPONSE), then the other team. Null when the chain is empty or nobody is left to answer.
 */
export function tagPriority(engine: DuelEngineView, passed: readonly number[], choosingSeat: number | null): PrioritySlot[] | null {
  const order = tagResponseOrder(engine, passed);
  if (!order) return null;
  const others = seatsOfTeam("tag", 1 - order.team);
  return [...order.seats, ...others].map((seat) => ({ seat, choosing: seat === choosingSeat }));
}

/**
 * The effects of the live Tag table: feedback, summon, move, position, chain, Master return, battle and destroy. They
 * read the same events as the FFA table and render nothing at all while `fxActive` is false. Mount it inside the stage's
 * board overlay slot. The chain chips use the Tag response order instead of the seat order.
 */
export function TagFx({ controller, fxActive = true, passedSeats = [] }: TagFxProps) {
  const { engine, room, viewerSeat, nameOf, prompt, reducedMotion } = controller;
  const preferences = useDuelPreferences();
  const events = useMemo(() => dedupeTeamDamage(engine.events), [engine.events]);
  const layout = useMemo(
    () => tableLayout("tag", engine, viewerSeat),
    // The layout depends on who sits where, never on a card: the seat list is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine.seats.length, viewerSeat],
  );
  const seatTones = useMemo(() => new Map([...toneBySeat(layout)].map(([seat, tone]) => [seat, SEAT_TONE_HEX[tone]])), [layout]);
  const choosing = prompt?.context?.type === "chain" ? prompt.seat : null;
  const priority = useMemo(
    () => (room.session.status === "active" ? tagPriority(engine, passedSeats, choosing) ?? undefined : undefined),
    [engine, passedSeats, choosing, room.session.status],
  );
  if (!fxActive) return null;
  const duelKey = room.session.slug;
  return (
    <FxBoundary>
      <DuelFeedback events={events} duelKey={duelKey} soundEnabled={preferences.soundEnabled} soundVolume={preferences.soundVolume} reducedMotion={reducedMotion} />
      <SummonFx events={events} duelKey={duelKey} reducedMotion={reducedMotion} shake={preferences.shake} />
      <MoveFx events={events} duelKey={duelKey} reducedMotion={reducedMotion} />
      <PositionFx events={events} duelKey={duelKey} reducedMotion={reducedMotion} />
      <ChainFx events={events} chain={engine.chain} duelKey={duelKey} reducedMotion={reducedMotion} mySeat={viewerSeat} playerName={nameOf} seatTones={seatTones} priority={priority} />
      <MasterReturnFx events={events} seats={engine.seats} duelKey={duelKey} reducedMotion={reducedMotion} mySeat={viewerSeat} />
      <BattleFx events={events} seats={engine.seats} reducedMotion={reducedMotion} active aim={null} />
      <DestroyFx events={events} reducedMotion={reducedMotion} active mySeat={viewerSeat ?? 0} />
    </FxBoundary>
  );
}
