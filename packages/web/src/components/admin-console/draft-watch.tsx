"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import type { DraftDetailResponse } from "@yugidraft/shared/types";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { DraftRoom } from "@/components/draft/room/draft-room";
import { SEAT_TONE_HEX, type SeatTone } from "@/components/duel/table/types";
import { useAdminSpectate } from "@/lib/hooks/use-admin-spectate";
import { useDraftStore, type DraftState } from "@/lib/stores/draft-store";
import styles from "./live-watch.module.css";

const TONES: readonly SeatTone[] = ["violet", "ice", "verdant", "rose"];
const BACK_HREF = "/admin#duels";

type DraftWatchData = {
  readOnly: true;
  pov: number | null;
  picks: { id: number; waveNumber: number; pickStep: number; draftCardId: number }[];
  deck: DuelDeck | null;
  draft: DraftDetailResponse;
};

const EMPTY: Partial<DraftState> = {
  packRound: 1, pickStep: 1, currentPack: [], myPool: [], seats: [], timerSeconds: 0, isMyTurn: false, passed: false, completed: false, pickSeconds: 60,
};

/** The roster as the bar lists it: seated players while the draft runs, the lobby roster before it starts. */
function roster(d: DraftDetailResponse): { playerId: number; name: string }[] {
  if (d.seats.length) return d.seats.map((s) => ({ playerId: s.playerId, name: s.displayName }));
  return d.players.map((p) => ({ playerId: p.playerId, name: p.displayName ?? `Player ${p.playerId}` }));
}

function DraftWatchBar({ data, pov, onPov, loading }: { data: DraftWatchData | undefined; pov: number | null; onPov: (pov: number) => void; loading: boolean }) {
  const d = data?.draft;
  const players = d ? roster(d) : [];
  const waitingOn = d?.status === "active" ? new Set(d.seats.filter((s) => !s.hasPicked).map((s) => s.playerId)) : new Set<number>();
  return (
    <div className={styles.bar} role="region" aria-label="Admin watch" data-testid="admin-watch-bar" aria-busy={loading}>
      <span className={styles.badge}><Eye size={13} strokeWidth={1.9} aria-hidden /> Watching as admin <em>Read-only</em></span>
      <div className={styles.chips} role="radiogroup" aria-label="Point of view">
        {players.map((player, index) => {
          const tone = SEAT_TONE_HEX[TONES[index % 4]!];
          return (
            <button key={player.playerId} type="button" role="radio" aria-checked={pov === player.playerId} className={styles.chip}
              data-active={pov === player.playerId || undefined} data-testid={`watch-pov-${player.playerId}`}
              style={{ "--tone": tone.main, "--tone-ink": tone.ink } as React.CSSProperties}
              onClick={() => onPov(player.playerId)} title={`See the draft as ${player.name} sees it`}>
              <i aria-hidden />
              <span className={styles.chipName}>{player.name}</span>
              <small>Seat {index + 1}</small>
              {waitingOn.has(player.playerId) ? <b className={styles.actMark} title="Has not picked yet">Picking</b> : null}
            </button>
          );
        })}
        {!players.length ? <span className={styles.status}>No players seated</span> : null}
      </div>
      <span className={styles.status}>{d ? `${d.status === "active" ? `Round ${d.packRound}, pick ${d.pickStep}` : d.status}` : "Loading"}</span>
      <Link href={BACK_HREF} className={styles.back} data-testid="watch-back">Admin console</Link>
    </div>
  );
}

function CardList({ title, cards }: { title: string; cards: { id: number; passcode: number; name: string }[] }) {
  return (
    <section className={styles.panel}>
      <h2>{title} <small>({cards.length})</small></h2>
      <div className={styles.cards}>{cards.map((c, i) => (
        <figure key={`${c.id}-${i}`}>
          {/* Card images use the same local image endpoint as the draft room. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/cards/${c.passcode}/image?variant=small`} alt={c.name} loading="lazy" />
          <figcaption>{c.name}</figcaption>
        </figure>
      ))}</div>
      {cards.length === 0 ? <p>No cards yet.</p> : null}
    </section>
  );
}

/** The lobby and the finished draft have no room to show; they get a plain read-only panel under the same bar. */
function IdlePanel({ data }: { data: DraftWatchData }) {
  const d = data.draft;
  const players = roster(d);
  return (
    <main className={styles.lobby}>
      <h1>{d.name}</h1>
      <p>{d.status === "pending" ? "Waiting to start. The room opens here when the draft starts." : d.status === "completed" ? "Finished." : `Draft ${d.status}.`}</p>
      <ul>{players.map((p, i) => <li key={p.playerId}><span className={styles.lobbySeat}>Seat {i + 1}</span><span>{p.name}</span></li>)}</ul>
      {d.status !== "pending" ? (
        <>
          <CardList title="Pool" cards={d.myPool} />
          {data.deck ? (["main", "extra", "side"] as const).map((section) => (
            <CardList key={section} title={`Deck: ${section}`} cards={data.deck![section].map((code, i) => ({ id: i, passcode: code, name: d.myPool.find((c) => c.passcode === code)?.name ?? `Card ${code}` }))} />
          )) : null}
        </>
      ) : null}
    </main>
  );
}

/**
 * Admin live watch of one draft. The room is the real draft room (`DraftRoom` with `readOnly`), fed from the admin view of the
 * chosen player instead of the viewer's own: pack, pool, seats and timer are that player's, and nothing can be sent.
 */
export function AdminDraftWatch({ slug }: { slug: string }) {
  const [pov, setPov] = useState<number | null>(null);
  const { data, error, isLoading } = useAdminSpectate<DraftWatchData>("draft", slug, pov);
  const setFromServer = useDraftStore((s) => s.setFromServer);
  const choose = useCallback((next: number) => setPov(next), []);

  // The shared draft store is global: clear it for this slug, and again on leaving.
  useEffect(() => {
    setFromServer({ slug, ...EMPTY });
    return () => setFromServer({ slug: "", ...EMPTY });
  }, [slug, setFromServer]);

  const d = data?.draft;
  useEffect(() => {
    if (!d || d.status !== "active") return;
    setFromServer({
      slug,
      packRound: d.packRound ?? d.currentPackRound ?? 1,
      pickStep: d.pickStep ?? d.currentPickStep ?? 1,
      currentPack: d.currentPack ?? [],
      myPool: d.myPool ?? [],
      seats: d.seats ?? [],
      timerSeconds: d.timerSeconds ?? 0,
      isMyTurn: d.isMyTurn ?? false,
      passed: d.passed ?? false,
      completed: d.completed ?? false,
      pickSeconds: d.pickSeconds ?? d.config?.pickSeconds ?? 60,
    });
  }, [d, slug, setFromServer]);

  // The pick clock runs on this page between reads. It makes no sound.
  const timerSeconds = useDraftStore((s) => s.timerSeconds);
  const completed = useDraftStore((s) => s.completed);
  const tick = useDraftStore((s) => s.tick);
  useEffect(() => {
    if (completed || timerSeconds <= 0) return;
    const timeout = window.setTimeout(tick, 1000);
    return () => window.clearTimeout(timeout);
  }, [completed, timerSeconds, tick]);

  const bar = <DraftWatchBar data={data} pov={data?.pov ?? pov} onPov={choose} loading={isLoading} />;
  if (error && !data) {
    return <main className={styles.lobby}><Link href={BACK_HREF} className={styles.back}>Admin console</Link><p role="alert">{error.message}</p></main>;
  }
  if (!data || !d) return <main className={styles.lobby}><p role="status">Loading live view…</p></main>;
  if (d.status !== "active") return <>{bar}<IdlePanel data={data} /></>;

  const roomConfig = d.config.mode !== "theme" && d.boosterProgress ? { ...d.config, cardsPerPlayer: d.boosterProgress.mainTotal } : d.config;
  return <DraftRoom slug={slug} name={d.name} config={roomConfig} isParticipant readOnly adminBar={bar} />;
}
