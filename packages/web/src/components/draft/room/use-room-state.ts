"use client";

/**
 * Everything the room derives from the live draft. The store and the one-second polling stay as they were;
 * this hook turns them into the mock's events (deal, pick, settle) so animations key on changes,
 * never on each fetch.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useDraftStore } from "@/lib/stores/draft-store";
import {
  INITIAL_DEAL,
  dealReducer,
  everyoneIn,
  orderSeats,
  passDirection,
  roomSizes,
  stepKeyOf,
  tableCards,
  turnState,
  type RoomConfigLike,
} from "./room-model";

export function useRoomState(config: RoomConfigLike, isParticipant: boolean) {
  const packRound = useDraftStore((s) => s.packRound);
  const pickStep = useDraftStore((s) => s.pickStep);
  const currentPack = useDraftStore((s) => s.currentPack);
  const myPool = useDraftStore((s) => s.myPool);
  const seats = useDraftStore((s) => s.seats);
  const isMyTurn = useDraftStore((s) => s.isMyTurn);
  const completed = useDraftStore((s) => s.completed);
  const pickSeconds = useDraftStore((s) => s.pickSeconds);

  const sizes = useMemo(() => roomSizes(config), [config]);
  const stepKey = stepKeyOf(packRound, pickStep);
  const [deal, dispatch] = useReducer(dealReducer, INITIAL_DEAL);
  const poolIds = useRef<ReadonlySet<number>>(new Set());
  poolIds.current = new Set(myPool.map((c) => c.id));

  useEffect(() => {
    dispatch({ type: "server", stepKey, pack: currentPack, poolIds: poolIds.current, isMyTurn, completed, theme: sizes.theme });
  }, [stepKey, currentPack, myPool, isMyTurn, completed, sizes.theme]);

  const direction = passDirection(packRound, config.alternatePassDirection);
  const turn = turnState({
    completed,
    isMyTurn: isMyTurn && deal.pickedId == null,
    isParticipant,
    seats,
  });
  const tableSeats = useMemo(() => orderSeats(seats), [seats]);
  const cards = useMemo(() => tableCards(deal), [deal]);

  /* settle: everyone is in, or the step moved on. Once per step. */
  const settledFor = useRef<string | null>(null);
  const [settle, setSettle] = useState(0);
  const allIn = everyoneIn(seats);
  useEffect(() => {
    if (completed || !allIn || settledFor.current === stepKey) return;
    settledFor.current = stepKey;
    setSettle((n) => n + 1);
  }, [allIn, stepKey, completed]);

  const picked = useCallback((cardId: number) => dispatch({ type: "picked", cardId }), []);
  const unpicked = useCallback(() => dispatch({ type: "unpicked" }), []);

  return {
    sizes,
    stepKey,
    packRound,
    pickStep,
    pickSeconds,
    seats,
    tableSeats,
    pool: myPool,
    deal,
    cards,
    turn,
    direction,
    settle,
    picked,
    unpicked,
    completed,
  };
}
