"use client";

import { useMemo } from "react";
import { seatsOfTeam, teamOfSeat, type DuelEvent, type DuelEngineView } from "@yugidraft/shared/duels";
import { BattleFx } from "../battle-fx";
import { ChainFx } from "../chain-fx";
import { CoinTossFx } from "../coin-toss-fx";
import { DestroyFx } from "../destroy-fx";
import { DuelFeedback } from "../feedback";
import { FxBoundary } from "../fx-boundary";
import { MasterReturnFx } from "../master-return-fx";
import { MoveFx } from "../move-fx";
import { PositionFx } from "../position-fx";
import type { PrioritySlot } from "../priority-chips";
import type { DuelPreferences } from "../preferences";
import { SummonFx } from "../summon-fx";
import { tableLayout } from "../table/geometry";
import { toneBySeat } from "../table/seat-state";
import { SEAT_TONE_HEX, type TableController } from "../table/types";
import { tagResponseOrder } from "./live-tag";
import { chainDecidingSeat } from "./use-chain-passes";
import { withDestroyCards } from "../destroy-cards";

/** The part of the live controller the effects read. `TableController` fits, so the shell passes its own. */
export type TagFxController = Pick<TableController, "engine" | "room" | "viewerSeat" | "nameOf" | "prompt" | "reducedMotion">;

export interface TagFxProps {
  controller: TagFxController;
  /** The shell's one `useDuelPreferences()` object, so the header toggle, the Settings tab and the sound agree. */
  preferences: Pick<DuelPreferences, "soundEnabled" | "soundVolume" | "shake">;
  /** False while the connection is down or recovering: nothing plays, so no effect replays old events. */
  fxActive?: boolean;
  /** Seats that passed on the open chain (the shell tracks them); the chain chips follow them. */
  passedSeats?: readonly number[];
}

/**
 * One effect per hit. A damage event id plays once: a repeated id (a resend of the same core message) is dropped.
 * Two damage events with different ids are two real hits, even for team mates with the same amount and cause: the
 * engine takes team LP once per core message.
 */
export function dedupeTeamDamage(events: DuelEvent[]): DuelEvent[] {
  const seen = new Set<number>();
  const kept: DuelEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    kept.push(event);
  }
  return kept.length === events.length ? events : kept;
}

/**
 * Who may answer the open chain, in order, for the chain chips: the team that answers now (the opposing team first,
 * R-TAG-RESPONSE), then the other team. Each team starts from the turn seat. Null when the chain is empty or both teams passed.
 */
export function tagPriority(engine: DuelEngineView, passed: readonly number[], choosingSeat: number | null): PrioritySlot[] | null {
  const order = tagResponseOrder(engine, engine.turnSeat, passed);
  if (!order) return null;
  // The other team reads in turn order too, from the turn seat, as the responding team does.
  const count = seatsOfTeam("tag", 0).length + seatsOfTeam("tag", 1).length;
  const others = Array.from({ length: count }, (_, i) => (engine.turnSeat + i) % count).filter((seat) => teamOfSeat("tag", seat) !== order.team);
  return [...order.seats, ...others].map((seat) => ({ seat, choosing: seat === choosingSeat }));
}

/**
 * The effects of the live Tag table: feedback, summon, move, position, chain, Master return, battle and destroy. They
 * read the same events as the FFA table and render nothing at all while `fxActive` is false. Mount it inside the stage's
 * board overlay slot. The chain chips use the Tag response order instead of the seat order.
 */
export function TagFx({ controller, preferences, fxActive = true, passedSeats = [] }: TagFxProps) {
  const { engine, room, viewerSeat, nameOf, prompt, reducedMotion } = controller;
  const events = useMemo(() => dedupeTeamDamage(engine.events), [engine.events]);
  const layout = useMemo(
    () => tableLayout("tag", engine, viewerSeat),
    // The layout depends on who sits where, never on a card: the seat list is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine.seats.length, viewerSeat],
  );
  const seatTones = useMemo(() => new Map([...toneBySeat(layout)].map(([seat, tone]) => [seat, SEAT_TONE_HEX[tone]])), [layout]);
  const choosing = chainDecidingSeat(engine, prompt);
  const priority = useMemo(
    () => (room.session.status === "active" ? tagPriority(engine, passedSeats, choosing) ?? undefined : undefined),
    [engine, passedSeats, choosing, room.session.status],
  );
  if (!fxActive) return null;
  const duelKey = room.session.slug;
  return (
    <FxBoundary>
      <CoinTossFx events={events} duelKey={duelKey} reducedMotion={reducedMotion} />
      <DuelFeedback events={events} duelKey={duelKey} soundEnabled={preferences.soundEnabled} soundVolume={preferences.soundVolume} reducedMotion={reducedMotion} />
      <SummonFx events={withDestroyCards(events)} duelKey={duelKey} reducedMotion={reducedMotion} shake={preferences.shake} />
      <MoveFx events={withDestroyCards(events)} duelKey={duelKey} reducedMotion={reducedMotion} />
      <PositionFx events={events} duelKey={duelKey} reducedMotion={reducedMotion} />
      <ChainFx events={withDestroyCards(events)} chain={engine.chain} duelKey={duelKey} reducedMotion={reducedMotion} mySeat={viewerSeat} playerName={nameOf} seatTones={seatTones} priority={priority} ended={room.session.status !== "active" || engine.result != null} table="tag" seats={engine.seats} />
      <MasterReturnFx events={events} seats={engine.seats} duelKey={duelKey} reducedMotion={reducedMotion} mySeat={viewerSeat} />
      <BattleFx events={withDestroyCards(events)} seats={engine.seats} reducedMotion={reducedMotion} active aim={null} />
      <DestroyFx events={withDestroyCards(events)} reducedMotion={reducedMotion} active mySeat={viewerSeat ?? 0} />
    </FxBoundary>
  );
}
