import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DuelSeatView } from "@yugidraft/shared/duels";
import { onCrumbleStart } from "./crumble-gate";
import type { SeatPose } from "./types";

/** A seat that left the duel while the table was open: what it looked like just before, for the crumble. */
export interface SeatExit {
  seat: number;
  /** The last board of the seat, from before the engine emptied it. */
  view: DuelSeatView;
  /** The pose it had. */
  pose: SeatPose;
  /** The viewer's own hand shows faces. */
  faceUpHand: boolean;
}

export interface UseSeatExitsArgs {
  /** Seats that have left the duel now (eliminated, not just leaving). */
  out: readonly number[];
  seats: readonly DuelSeatView[];
  /** The poses drawn this render, by seat. */
  poses: ReadonlyMap<number, SeatPose>;
  faceUpHand: (seat: number) => boolean;
  /** False where no crumble is wanted (Tag, a table that shows no plaza). Seats that leave are only noted. */
  enabled: boolean;
  /** The seats that stay move when one leaves (a 3-way table). Only then are the saved poses held during the glide. */
  regroups?: boolean;
  /** Changes with the duel (and the game of a series): the seats that are out then start again as already seen. */
  resetKey?: string;
}

/**
 * How long the seats take to regroup after an elimination (the 3-way FINAL DUEL board): the crumble (EXIT_CRUMBLE_MS), the
 * beat (FINALE_BEAT_MS) and the glide (FINALE_GLIDE_MS) of the 4-way finale, with some slack.
 */
export const GLIDE_MS = 3800;

/**
 * Tells which seats left the duel since the last render and keeps what is needed to crumble them. The seats that were
 * already out on the first render (a reload, a late join) never crumble: the table shows its final layout at once.
 * A job ends when its layer calls `finish`. `gliding` is true for `GLIDE_MS` after the last job began: the seats that
 * stay use it to wait for the crumble and move slowly.
 *
 * It reads the previous poses and views from refs that are saved after each commit, so a seat that is emptied by the
 * engine in the same update still has its last board here.
 */
export function useSeatExits({ out, seats, poses, faceUpHand, enabled, regroups = false, resetKey = "" }: UseSeatExitsArgs): {
  exits: SeatExit[];
  gliding: boolean;
  finish: (seat: number) => void;
} {
  const last = useRef<{ views: Map<number, DuelSeatView>; poses: Map<number, SeatPose>; faceUp: Map<number, boolean> }>({
    views: new Map(),
    poses: new Map(),
    faceUp: new Map(),
  });
  const [state, setState] = useState(() => ({ key: resetKey, seen: [...out], exits: [] as SeatExit[], glideId: 0 }));

  // Derived while rendering (no effect, no extra paint): seats that are new in `out` start a job.
  if (state.key !== resetKey) {
    last.current.views.clear();
    last.current.poses.clear();
    last.current.faceUp.clear();
    setState({ key: resetKey, seen: [...out], exits: [], glideId: 0 });
  } else {
    const added = out.filter((seat) => !state.seen.includes(seat));
    if (added.length > 0 || state.seen.length !== out.length) {
      const exits = enabled
        ? added.flatMap((seat) => {
            const view = last.current.views.get(seat);
            const pose = last.current.poses.get(seat);
            return view && pose ? [{ seat, view, pose, faceUpHand: last.current.faceUp.get(seat) ?? false }] : [];
          })
        : [];
      setState({
        key: state.key,
        seen: [...out],
        exits: [...state.exits.filter((exit) => out.includes(exit.seat)), ...exits],
        glideId: exits.length > 0 ? state.glideId + 1 : state.glideId,
      });
    }
  }

  const [glidingFor, setGlidingFor] = useState(0);
  // A crumble that waited for the battle (crumble-gate.ts) starts late, and the glide waits with it: the glide time counts
  // from the start of the crumble.
  const [crumbleStarts, setCrumbleStarts] = useState(0);
  useEffect(() => onCrumbleStart(() => setCrumbleStarts((count) => count + 1)), []);
  useEffect(() => {
    if (state.glideId === 0) return;
    setGlidingFor(state.glideId);
    const timer = setTimeout(() => setGlidingFor((now) => (now === state.glideId ? 0 : now)), GLIDE_MS);
    return () => clearTimeout(timer);
  }, [state.glideId, crumbleStarts]);

  const finish = useCallback((seat: number) => {
    setState((prev) => (prev.exits.some((exit) => exit.seat === seat) ? { ...prev, exits: prev.exits.filter((exit) => exit.seat !== seat) } : prev));
  }, []);

  // The glide starts in the same render as the new layout, not one effect later, so the move waits for the crumble.
  const gliding = glidingFor !== 0 || state.exits.length > 0;

  useLayoutEffect(() => {
    const keep = last.current;
    for (const view of seats) {
      if (out.includes(view.seat) || view.eliminated) continue;
      keep.views.set(view.seat, view);
      keep.faceUp.set(view.seat, faceUpHand(view.seat));
    }
    // While the seats of a regrouping table glide, the saved poses stay those from before: a second seat that leaves then
    // crumbles where its board began, not at the end of a move that is still running.
    if (!(gliding && regroups)) for (const [seat, pose] of poses) if (!out.includes(seat)) keep.poses.set(seat, pose);
  });

  return { exits: state.exits, gliding, finish };
}
