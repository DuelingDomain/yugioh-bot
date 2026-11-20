"use client";

import { useEffect, useReducer } from "react";
import type { RemoteEvent } from "@yugidraft/shared/remote";
import { serverNow } from "./api";
import { activeRespond, type RespondHold } from "./respond";
import s from "./respond-banner.module.css";

/** The response that holds now (null when none), re-read when it runs out. Players and spectators share it through the room events. */
export function useRespondHold(events: readonly RemoteEvent[]): RespondHold | null {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const hold = activeRespond(events, serverNow());
  const until = hold?.until;
  useEffect(() => {
    if (until === undefined) return;
    const timer = setTimeout(tick, Math.max(0, until - serverNow()) + 20);
    return () => clearTimeout(timer);
  }, [until, hold?.eventId]);
  return hold;
}

/** A clear "Response!" with the player's name, on every screen for the length of the hold. It never takes clicks. */
export function RespondBanner({ hold, name }: { hold: RespondHold | null; name: (seat: number) => string }) {
  if (!hold) return null;
  return <div className={s.banner} key={hold.eventId} role="status" aria-live="assertive" data-testid="respond-banner">
    <small>{name(hold.seat)}</small><b>Response!</b>
  </div>;
}
