"use client";

import { useEffect, useRef, useState } from "react";
import type { RemoteEvent } from "@yugidraft/shared/remote";
import { serverNow } from "./api";
import { cardArt, useCardInfo } from "./catalog";
import s from "./remote-ui.module.css";

const SHOW_MS = 3600;
/** An activation older than this is history (a reconnect or a page load), not news. */
const FRESH_MS = 8000;

type Shown = { id: string; seat: number; cardId?: number; name?: string };

/**
 * A card a player held up from the hand: every seat and every spectator sees it large for a moment. The text is plain,
 * never a click target, so it covers no control for long. An Undo of that same action takes it away (a spectator only sees
 * "Undid an action" from that seat, so that counts for them).
 */
export function HandActivation({ events, name }: { events: readonly RemoteEvent[]; name: (seat: number) => string }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const seen = useRef<number | null>(null);
  const current = useRef<Shown | null>(null);
  current.current = shown;
  const info = useCardInfo([shown?.cardId]);
  useEffect(() => {
    const top = events.reduce((max, event) => Math.max(max, event.seq), 0);
    // The first render only learns where the log stands.
    if (seen.current === null) { seen.current = top; return; }
    const fresh = events.filter(event => event.seq > seen.current!).sort((a, b) => a.seq - b.seq);
    seen.current = Math.max(seen.current, top);
    for (const event of fresh) {
      const action = event.action;
      const now = current.current;
      if (action.type === "undo" || action.type === "log.note" && action.text === "Undid an action") {
        // Only an Undo of the activation on screen takes it away, not another seat's undo.
        if (now && (action.type === "undo" ? action.targetActionId === now.id : event.actorSeat === now.seat)) setShown(null);
      } else if (action.type === "effect.activated" && action.fromHand && event.actorSeat !== null && serverNow() - event.at < FRESH_MS)
        setShown({ id: event.id, seat: event.actorSeat, cardId: action.source.cardId, name: action.source.name });
    }
  }, [events]);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  if (!shown) return null;
  const label = shown.name ?? info(shown.cardId)?.name ?? "a card";
  return <div className={s.hact} role="status" aria-live="polite" data-testid="hand-activation" key={shown.id}>
    {shown.cardId ? <img src={cardArt(shown.cardId, "full")} alt={label} draggable={false} /> : null}
    <p><b>{name(shown.seat)}</b> activated <b>{label}</b> from hand</p>
  </div>;
}
