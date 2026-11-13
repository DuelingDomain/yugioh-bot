"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type { RemoteReplay, RemoteState } from "@yugidraft/shared/remote";
import { sheetButtonClass, sheetPage, SheetButton } from "@/components/duel/sheet-ui";
import { duelFontClasses } from "@/components/duel/fonts";
import { remoteApi } from "./api";
import { cardArt, useCardInfo } from "./catalog";
import { remoteFormatName } from "./create";
import { describeEvent } from "./describe";
import { cardCode, cardName, cellsFor, hasExtraZones, EK, PHASE_LONG, ZK, zoneLabel, type ZoneKey } from "./model";
import { boardAt, turnStarts } from "./replay-model";
import s from "./replay.module.css";

const humanize = (type: string) => type.replace(/[._]/g, " ").replace(/^./, c => c.toUpperCase());

function Cell({ zone, cell, down }: { zone: ZoneKey; cell: ReturnType<typeof cellsFor>[ZoneKey]; down?: boolean }) {
  const card = cell.card, pile = zone === "gy" || zone === "ban" || zone === "ex" || zone === "deck";
  const code = card ? cardCode(card) : undefined;
  const faceUp = card?.faceUp !== false;
  return <div className={s.cell} data-wide={zone === "ban"} data-filled={!!card || cell.count > 0} data-pos={pile?undefined:card?.position} data-down={!!card && !faceUp || down}
    title={card ? (faceUp ? cardName(card) : "Face-down card") : undefined}>
    <span className={s.zl}>{zoneLabel(zone)}</span>
    {card && faceUp && code ? <img src={cardArt(code, "small")} alt="" draggable={false} loading="lazy" /> : null}
    {card ? <span className={s.tag}>{faceUp ? cardName(card) : "Set"}</span> : null}
    {pile && cell.count > 0 ? <span className={s.pile}>{cell.count}</span> : null}
  </div>;
}

function SeatMat({ state, seat, name, extraZones }: { state: RemoteState; seat: number; name: string; extraZones: boolean }) {
  const view = state.seats[seat];
  const cells = useMemo(() => cellsFor(view?.twin ?? [], extraZones), [view?.twin, extraZones]);
  if (!view) return null;
  const hand = view.twin.filter(card => card.zone === "hand").length;
  return <section className={s.seat} data-turn={state.turnSeat === seat} aria-label={`${name}'s field`} data-testid={`replay-seat-${seat}`}>
    <div className={s.seatHead}>
      <b>{name}{view.eliminated ? <span className={s.out}>Out</span> : null}</b>
      <span className={s.lp} aria-label={`${view.resources.lp ?? 0} life points`}>{view.resources.lp ?? 0}</span>
    </div>
    <div className={s.counts}>Hand {view.handCount ?? hand}{view.deckCount !== undefined ? ` · Deck ${view.deckCount}` : ""}</div>
    {/* Top row of the mat: the two Extra Monster Zones (Master Rule 5) and the Banished pile above the Graveyard. */}
    <div className={s.grid}>
      {extraZones ? EK.map((key, i) => <div key={key} style={{ gridColumn: 3 + 2 * i }}><Cell zone={key} cell={cells[key]} /></div>) : null}
      <div style={{ gridColumn: 7, justifySelf: "end", alignSelf: "end" }}><Cell zone="ban" cell={cells.ban} /></div>
    </div>
    <div className={s.grid}>{ZK.map(key => <Cell key={key} zone={key} cell={cells[key]} />)}</div>
  </section>;
}

/** An ended Remote table as steps. The board is rebuilt in the browser from the first board and the change of each event. */
export function RemoteReplayScreen({ slug }: { slug: string }) {
  const { data, error } = useSWR<RemoteReplay>(`remote:replay:${slug}`, () => remoteApi<RemoteReplay>(`/${slug}/replay`), { revalidateOnFocus: false });
  return <div className={`${duelFontClasses} ${sheetPage}`}><div className={s.wrap}>
    {error ? <p role="alert" className={s.state}>{(error as Error).message || "Could not load this replay."}</p>
      : !data ? <p className={s.state} role="status">Loading the replay…</p> : <Player replay={data} />}
  </div></div>;
}

function Player({ replay }: { replay: RemoteReplay }) {
  const last = replay.steps.length - 1;
  const [index, setIndex] = useState(last);
  const current = useRef<HTMLButtonElement>(null);
  const state = useMemo(() => boardAt(replay, index), [replay, index]);
  const turns = useMemo(() => turnStarts(replay), [replay]);
  const ids = useMemo(() => state.seats.flatMap(seat => seat.twin.map(card => cardCode(card))), [state]);
  const info = useCardInfo(ids);
  const names = useMemo(() => new Map(replay.table.seats.map(seat => [seat.seat, seat.displayName])), [replay]);
  const name = (seat: number) => names.get(seat) ?? `Seat ${seat + 1}`;
  const lines = useMemo(() => replay.steps.map(step => {
    const described = describeEvent(step.event, name, id => info(id)?.name, () => undefined);
    return described?.text ?? humanize(step.event.action.type);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `info` changes when card names load.
  }), [replay, info]);
  const extraZones = hasExtraZones(replay.table.format?.id);
  const clamp = (value: number) => Math.max(-1, Math.min(last, value));
  const step = replay.steps[index];
  useEffect(() => { current.current?.scrollIntoView({ block: "nearest" }); }, [index]);
  const onKey = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); setIndex(value => clamp(value - 1)); }
    if (event.key === "ArrowRight") { event.preventDefault(); setIndex(value => clamp(value + 1)); }
  };
  const winner = state.winnerSeat === null ? null : name(state.winnerSeat);
  const turnNow = step?.turn ?? 0;
  return <div onKeyDown={onKey}>
    <div className={s.head}>
      <div>
        <h1><span className={s.chip}>Remote</span>{replay.table.seats.map(seat => seat.displayName).join(" vs ")}</h1>
        <div className={s.meta}>{remoteFormatName(replay.table.format?.id)} · {replay.table.seatCount} players · {replay.steps.length} events{winner ? ` · ${winner} won` : ""}{replay.viewer === "spectator" ? " · Spectator view" : ""}</div>
      </div>
      <a href="/duels" className={sheetButtonClass("quiet", "sm")}>Back to duels</a>
    </div>
    <div className={s.layout}>
      <div className={s.board} data-seats={replay.table.seatCount} aria-live="off">
        {state.seats.map(seat => <SeatMat key={seat.seat} state={state} seat={seat.seat} name={name(seat.seat)} extraZones={extraZones} />)}
      </div>
      <div className={s.side}>
        <div className={s.panel}>
          <div className={s.meta} data-testid="replay-position">{index < 0 ? "Start" : `Step ${index + 1} of ${replay.steps.length}`} · Turn {turnNow} · {PHASE_LONG[state.phase] ?? state.phase} · {name(state.turnSeat)}</div>
          <div className={s.now} role="status" data-testid="replay-now">{index < 0 ? "Before the first event" : lines[index]}</div>
          <input className={s.scrub} type="range" min={-1} max={last} value={index} aria-label="Replay step" onChange={event => setIndex(Number(event.target.value))} />
          <div className={s.controls}>
            <SheetButton kind="secondary" size="sm" disabled={index <= -1} onClick={() => setIndex(-1)} aria-label="Go to the start">Start</SheetButton>
            <SheetButton kind="secondary" size="sm" disabled={index <= -1} onClick={() => setIndex(clamp(index - 1))} data-testid="replay-back">Back</SheetButton>
            <SheetButton kind="primary" size="sm" disabled={index >= last} onClick={() => setIndex(clamp(index + 1))} data-testid="replay-forward">Forward</SheetButton>
            <SheetButton kind="secondary" size="sm" disabled={index >= last} onClick={() => setIndex(last)} aria-label="Go to the end">End</SheetButton>
          </div>
          {turns.length > 1 ? <label className={s.meta}>Jump to turn{" "}
            <select value={turns.findLast(entry => entry.index <= index)?.index ?? turns[0]!.index} aria-label="Jump to turn" onChange={event => setIndex(Number(event.target.value))}>
              {turns.map(entry => <option key={entry.index} value={entry.index}>Turn {entry.turn}</option>)}
            </select></label> : null}
        </div>
        <div className={s.panel}>
          <b>Event log</b>
          <ol className={s.log} aria-label="Event log">
            {replay.steps.map((entry, i) => <li key={entry.seq}>
              <button type="button" ref={i === index ? current : undefined} aria-current={i === index} onClick={() => setIndex(i)}>
                <small>{i + 1}</small><span>{lines[i]}</span>
              </button>
            </li>)}
          </ol>
        </div>
      </div>
    </div>
  </div>;
}
