"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import { cardInfo, loadCards, type CardInfo } from "./catalog";
import { serverNow } from "./api";
import { cardCode, type TwinCard } from "./model";
import { nextStep, type NextStep } from "./next-step";
import type { useTokens } from "./token-ui";
import type { useControlChange } from "./control-ui";
import type { useLayers } from "./use-layers";
import t from "./stats-tokens.module.css";
import { Icon } from "./icons";

/** How long the suggestion stays, and how old an event may be to count as news (a reconnect or page load replays old ones). */
const SHOW_MS = 6000, FRESH_MS = 8000, REPEAT_MS = 30_000;
const FIELD = new Set(["monster", "extra-monster", "spell-trap", "field", "pendulum"]);
const CELL: Record<string, string> = { monster: "m", "spell-trap": "s", "extra-monster": "e" };
type Chip = { id: number; step: NextStep; name: string; cardId: number; ref?: string; seat: number; at: { left: number; top: number } | null };

/**
 * One suggestion chip after my card was activated or placed: the typical next step from its card text (next-step.ts), such as
 * "Place on opponent's field" (a Kaiju) or "Add 2 Fluff Tokens". It never acts by itself: one click only starts the usual placing mode,
 * the next click on a zone does the rest. It leaves after 6 seconds or with Esc, and it takes no space from the board.
 */
export function useNextStep({ room, live, tokens, control, layers }: {
  room: RemoteRoom; live: boolean; tokens: ReturnType<typeof useTokens>; control: ReturnType<typeof useControlChange>; layers: ReturnType<typeof useLayers>;
}) {
  const { solo, mySeat } = room;
  const [chip, setChip] = useState<Chip | null>(null);
  const roomRef = useRef(room); roomRef.current = room;
  const seenSeq = useRef<number | null>(null);
  const before = useRef(new Map<string, string>());
  const shown = useRef(new Map<string, number>());
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismiss = useCallback(() => { clearTimeout(timer.current); setChip(null); }, []);

  const show = useCallback(async (seat: number, cardId: number, name: string | undefined, ref: string | undefined) => {
    if (!cardInfo(cardId)) await loadCards([cardId]);
    const found: CardInfo | undefined = cardInfo(cardId), label = found?.name ?? name;
    const step = label ? nextStep(label, found?.effectText) : null;
    if (!step || !label) return;
    const key = `${seat}:${label}`;
    if (serverNow() - (shown.current.get(key) ?? 0) < REPEAT_MS) return;
    shown.current.set(key, serverNow());
    const card = ref ? roomRef.current.state.seats[seat]?.twin.find(c => c.ref === ref) : undefined;
    const cell = card && CELL[card.zone] && card.slot ? `${CELL[card.zone]}${card.slot}` : null;
    const rect = cell ? [...document.querySelectorAll<HTMLElement>(`[data-zone="${cell}"][data-seat="${seat}"]`)].map(el => el.getBoundingClientRect()).find(r => r.width > 0) : undefined;
    clearTimeout(timer.current);
    setChip({ id: ++counter.current, step, name: label, cardId, ref, seat, at: rect ? { left: rect.left + rect.width / 2, top: rect.top } : null });
    timer.current = setTimeout(() => setChip(null), SHOW_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const cards = room.state.seats.flatMap(item => item.twin);
    const was = before.current;
    before.current = new Map(cards.map(card => [card.ref, card.zone]));
    const top = room.events.reduce((max, event) => Math.max(max, event.seq), 0);
    if (seenSeq.current === null) { seenSeq.current = top; return; }
    const fresh = room.events.filter(event => event.seq > seenSeq.current!).sort((a, b) => a.seq - b.seq);
    seenSeq.current = Math.max(seenSeq.current, top);
    if (!live || mySeat < 0 && !solo || room.spectator) return;
    for (const event of fresh) {
      const action = event.action;
      if (event.actorSeat === null || !solo && event.actorSeat !== mySeat || serverNow() - event.at > FRESH_MS) continue;
      if (action.type === "effect.activated" && action.source.cardId) void show(event.actorSeat, action.source.cardId, action.source.name, action.source.cardRef);
      // A card put on the field from the hand. One that came back from a pile, or only moved on the field, is not played now.
      else if (action.type === "twin.place" && !action.give && action.card.faceUp && !action.card.token && FIELD.has(action.zone)) {
        const id = action.card.cardId ?? action.card.passcode, from = was.get(action.fromRef ?? action.card.ref);
        if (id && (from === undefined || from === "hand")) void show(event.actorSeat, id, action.card.name, action.card.ref);
      }
    }
  }, [room.events]);

  // Esc ends the suggestion. The key is not consumed, so other Esc handlers (placing mode, dialogs) still run.
  useEffect(() => {
    if (!chip) return;
    const stop = (event: KeyboardEvent) => { if (event.key === "Escape" && !layers.layer) dismiss(); };
    window.addEventListener("keydown", stop);
    return () => window.removeEventListener("keydown", stop);
  }, [chip, layers.layer, dismiss]);
  const busy = tokens.placing || control.giving || !!layers.layer;
  // Another action took over: the suggestion is not needed any more.
  useEffect(() => { if (chip && (tokens.placing || control.giving)) dismiss(); }, [chip, tokens.placing, control.giving, dismiss]);

  const accept = (current: Chip) => {
    dismiss();
    const { step } = current;
    if (step.kind === "tokens") {
      const token = step.token;
      tokens.start({ name: token.name, atk: token.atk, def: token.def, artId: token.artId, position: token.position, left: token.count, ...(token.opponent ? { opponent: true } : {}), ...(token.ask ? { ask: true } : {}), confirm: token.ask || token.opponent });
      return;
    }
    const held: TwinCard | undefined = current.ref ? roomRef.current.state.seats[current.seat]?.twin.find(c => c.ref === current.ref && ["monster", "extra-monster", "spell-trap"].includes(c.zone)) : undefined;
    const info = cardInfo(current.cardId);
    control.giveCard(current.cardId, current.name, held && cardCode(held) ? held : undefined, info && /spell|trap/i.test(info.type) ? "spell-trap" : "monster");
  };

  const node = chip && live && !busy ? <div key={chip.id} className={`${t.nextStep} ${chip.at ? "" : t.nextStepLow}`} role="status" data-testid="next-step"
    style={chip.at ? { left: Math.min(Math.max(chip.at.left, 120), window.innerWidth - 120), top: Math.max(chip.at.top - 8, 56) } as CSSProperties : undefined}>
    <button type="button" className={t.nextGo} onClick={() => accept(chip)} data-testid="next-step-go"><Icon name="next" />{chip.step.label}</button>
    <button type="button" className={t.nextX} onClick={dismiss} aria-label="Dismiss suggestion" data-testid="next-step-dismiss"><Icon name="x" /></button>
  </div> : null;
  return { node };
}
