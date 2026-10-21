"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { DuelDeck, DuelRoom } from "@yugidraft/shared/duels";
import { useAdminSpectate } from "@/lib/hooks/use-admin-spectate";
import { DuelCardInfoLoaderContext } from "@/components/duel/card-info";
import { DuelField } from "@/components/duel/field";
import { TableShell } from "@/components/duel/table/table-shell";
import { createReadOnlyTableController } from "@/components/duel/replay-controller";
import { FieldCracksScope } from "@/components/duel/field-cracks/context";
import type { InspectTarget } from "@/components/duel/inspector";
import styles from "./live-watch.module.css";

type DuelWatchData = { readOnly: true; pov: number | null; room: DuelRoom };
type DraftCard = { id: number; name: string; passcode: number; imageUrl?: string; imageUrlSmall?: string; blocked?: boolean; held?: number; forced?: boolean };
type DraftWatchData = {
  readOnly: true; pov: number | null; picks: { id: number; waveNumber: number; pickStep: number; draftCardId: number }[]; deck: DuelDeck | null;
  draft: { name: string; status: string; config: { mode?: string }; seats: { playerId: number; displayName: string; isCurrentPlayer: boolean; hasPicked: boolean }[];
    currentPack: DraftCard[]; myPool: DraftCard[]; packRound: number; pickStep: number; pickDeadlineAt?: string; timerSeconds: number; isMyTurn: boolean; passed: boolean };
};
const noop = () => undefined;
// Seat snapshots already carry visible card metadata. Never fall back to player API routes.
const snapshotOnlyCardInfo = async () => null;
const EMPTY_KEYS = new Set<string>();
function WatchHeading({ title }: { title: string }) {
  return <header className={styles.heading}><Link href="/admin#duels">← Admin console</Link><h1>{title}</h1><p>Live watch · Read-only · Private player views</p></header>;
}
export function AdminDuelWatch({ slug }: { slug: string }) {
  const [seat, setSeat] = useState<number | null>(null);
  const { data, error } = useAdminSpectate<DuelWatchData>("duel", slug, seat);
  const [inspected, setInspected] = useState<InspectTarget | null>(null);
  if (error) return <main className={styles.watch}><WatchHeading title="Watch duel" /><p role="alert">{error.message}</p></main>;
  if (!data) return <main className={styles.watch}><WatchHeading title="Watch duel" /><p role="status">Loading live view…</p></main>;
  const { room } = data; const engine = room.engine;
  const nameOf = (s: number) => room.session.seats.find(p => p.seat === s)?.displayName ?? `Seat ${s + 1}`;
  const controller = engine ? createReadOnlyTableController({ room, engine, camera: seat ?? 0, nameOf, reducedMotion: true,
    onActivate: noop, onInspect: setInspected }) : null;
  return <main className={styles.watch}>
    <WatchHeading title={room.session.name} />
    <label className={styles.selector}>Point of view <select aria-label="Point of view" value={seat ?? "public"} onChange={e => { setInspected(null); setSeat(e.target.value === "public" ? null : Number(e.target.value)); }}>
      <option value="public">Neutral public view</option>{room.session.seats.map(p => <option value={p.seat} key={p.seat}>{p.displayName} · Seat {p.seat + 1}</option>)}
    </select></label>
    <p>{room.session.status}{engine ? ` · Turn ${engine.turn} · ${engine.phase}` : " · Waiting for the duel to start"}</p>
    {engine ? <FieldCracksScope duelKey={slug} format={room.session.format} settings={room.session.settings} replay>
      <DuelCardInfoLoaderContext.Provider value={snapshotOnlyCardInfo}><div className={styles.board}>{room.session.format === "1v1" ? <DuelField engine={engine} mySeat={seat} masterRule={room.session.masterRule} reducedMotion legalKeys={EMPTY_KEYS} selectedKeys={EMPTY_KEYS}
        onActivate={noop} onInspect={setInspected} bottomName={nameOf(seat ?? 0)} topName={nameOf(seat === 1 ? 0 : 1)} />
        : controller ? <TableShell controller={controller} /> : null}</div></DuelCardInfoLoaderContext.Provider>
      {engine.prompt ? <section className={styles.panel} aria-label="Player prompt"><h2>{engine.prompt.title}</h2><p>Waiting for {nameOf(engine.prompt.seat)} · Read-only</p><ul>{engine.prompt.options.map(o => <li key={o.id}>{o.label}</li>)}</ul></section> : null}
      <details className={styles.panel}><summary>Duel log</summary><ol>{engine.log.map(line => <li key={line.id}>{line.text}</li>)}</ol></details>
    </FieldCracksScope> : null}
    {inspected && inspected.type !== "pile" ? <section className={styles.panel}><h2>{inspected.card.name ?? "Card"}</h2><p>{inspected.card.code ? `Card ${inspected.card.code}` : "Hidden card"}</p><button type="button" onClick={() => setInspected(null)}>Close card</button></section> : null}
  </main>;
}
function PickTimer({ seconds, step }: { seconds: number; step: string }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const until = Date.now() + seconds * 1000;
    setLeft(seconds);
    const timer = setInterval(() => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [seconds, step]);
  return <span aria-label="Pick timer">{left}s remaining</span>;
}
function Cards({ title, cards }: { title: string; cards: DraftCard[] }) {
  return <section className={styles.panel}><h2>{title} <small>({cards.length})</small></h2><div className={styles.cards}>{cards.map((c, i) => <figure key={`${c.id}-${i}`}>
    {/* Card images use the same local image endpoint as the draft room. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/api/cards/${c.passcode}/image?variant=small`} alt={c.name} loading="lazy" />
    <figcaption>{c.name}{c.blocked ? " · Unavailable" : ""}{c.forced ? " · Forced pick" : ""}</figcaption>
  </figure>)}</div>{cards.length === 0 ? <p>No cards yet.</p> : null}</section>;
}
export function AdminDraftWatch({ slug }: { slug: string }) {
  const [seat, setSeat] = useState<number | null>(null);
  const { data, error } = useAdminSpectate<DraftWatchData>("draft", slug, seat);
  if (error) return <main className={styles.watch}><WatchHeading title="Watch draft" /><p role="alert">{error.message}</p></main>;
  if (!data) return <main className={styles.watch}><WatchHeading title="Watch draft" /><p role="status">Loading live view…</p></main>;
  const d = data.draft;
  return <main className={styles.watch}>
    <WatchHeading title={d.name} />
    <label className={styles.selector}>Point of view <select aria-label="Point of view" value={data.pov ?? ""} onChange={e => setSeat(Number(e.target.value))}>
      {!d.seats.length ? <option value="">No players seated</option> : null}{d.seats.map(p => <option key={p.playerId} value={p.playerId}>{p.displayName}</option>)}
    </select></label>
    <p>{d.config.mode === "theme" ? "Theme" : "Booster"} · {d.status} · Round {d.packRound}, pick {d.pickStep}</p>
    <p><PickTimer seconds={d.timerSeconds} step={`${d.packRound}:${d.pickStep}`} /> · {d.isMyTurn ? "Choosing a card" : d.passed ? "Passed this pick" : "Waiting for other players"}{d.pickDeadlineAt ? <> · Pick deadline <time dateTime={d.pickDeadlineAt}>{new Date(d.pickDeadlineAt).toLocaleTimeString()}</time></> : null}</p>
    <Cards title="Current pack" cards={d.currentPack} /><Cards title="Player pool" cards={d.myPool} />
    <section className={styles.panel}><h2>Picks so far ({data.picks.length})</h2><ol>{data.picks.map(p => <li key={p.id}>Round {p.waveNumber}, pick {p.pickStep} · {d.myPool.find(c => c.id === p.draftCardId)?.name ?? "Picked card"}</li>)}</ol></section>
    {data.deck ? <section className={styles.panel}><h2>Saved draft deck</h2>{(["main", "extra", "side"] as const).map(section => <Cards key={section} title={section} cards={data.deck![section].map((code, i) => ({ id: i, passcode: code, name: d.myPool.find(c => c.passcode === code)?.name ?? `Card ${code}` }))} />)}</section> : null}
  </main>;
}
