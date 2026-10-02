"use client";

/**
 * Everything the room derives from the live draft. The store and the one-second polling stay as they were;
 * this hook turns them into the mock's events (deal, pick, settle, wheel) so animations key on changes,
 * never on each fetch.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useDraftStore } from "@/lib/stores/draft-store";
import {
  EMPTY_WHEEL_STATE,
  INITIAL_DEAL,
  dealReducer,
  everyoneIn,
  orderSeats,
  passDirection,
  roomSizes,
  stepKeyOf,
  tableCards,
  trackWheel,
  turnState,
  type RoomConfigLike,
  type Wheel,
  type WheelState,
} from "./room-model";

const wheelKey = (slug: string) => `yugidraft-room-wheel:${slug}`;

function loadWheel(slug: string): WheelState {
  try {
    const raw = window.sessionStorage.getItem(wheelKey(slug));
    if (!raw) return EMPTY_WHEEL_STATE;
    const parsed = JSON.parse(raw) as WheelState;
    if (Array.isArray(parsed?.history) && Array.isArray(parsed?.gone)) return parsed;
  } catch {
    /* storage can be blocked: the room works without it */
  }
  return EMPTY_WHEEL_STATE;
}

function saveWheel(slug: string, state: WheelState) {
  try {
    window.sessionStorage.setItem(wheelKey(slug), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function useRoomState(slug: string, config: RoomConfigLike, isParticipant: boolean) {
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

  /* the wheel: packs you held this round, what came back around, what left */
  const [wheelState, setWheelState] = useState<WheelState>(() => loadWheel(slug));
  const [wheel, setWheel] = useState<Wheel | null>(null);
  const tracked = useRef(0);
  const stateRef = useRef(wheelState);
  stateRef.current = wheelState;
  useEffect(() => {
    if (sizes.theme || deal.seq === 0 || deal.seq === tracked.current || deal.dealt.length === 0) return;
    tracked.current = deal.seq;
    const result = trackWheel(stateRef.current, {
      round: packRound,
      step: pickStep,
      cards: deal.dealt,
      poolIds: poolIds.current,
    });
    setWheelState(result.state);
    setWheel(result.wheel);
    saveWheel(slug, result.state);
    // only a new deal changes the wheel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.seq]);

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
    wheel,
    gone: wheelState.gone,
    picked,
    unpicked,
    completed,
  };
}
