"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Eye } from "lucide-react";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { DuelRoomView } from "@/components/duel/room";
import { adminDuelRoomKey, getAdminDuelRoom } from "@/components/duel/api";
import { SEAT_TONE_HEX, type SeatTone } from "@/components/duel/table/types";
import styles from "./live-watch.module.css";

const TONES: readonly SeatTone[] = ["violet", "ice", "verdant", "rose"];
const TAG_TONES: readonly SeatTone[] = ["violet", "ice", "rose", "verdant"];
const BACK_HREF = "/admin#duels";

/** The seat colours of the live table, so a chip matches the plate on the board. */
function toneOf(format: string, seat: number): SeatTone {
  return (format === "tag" ? TAG_TONES : TONES)[seat % 4]!;
}

function statusLine(room: DuelRoom): string {
  const { session, engine } = room;
  if (session.status === "lobby") return "Waiting to start";
  if (engine?.result) {
    const winner = engine.result.winnerSeat == null ? null : session.seats.find((seat) => seat.seat === engine.result?.winnerSeat)?.displayName;
    return winner ? `Finished · ${winner} won` : "Finished · draw";
  }
  if (session.status !== "active") return session.status === "cancelled" ? "Cancelled" : "Finished";
  return engine ? `Turn ${engine.turn}` : "Starting";
}

/** The floating read-only notice and point-of-view switch. The board under it is the real player board. */
function WatchBar({ room, pov, onPov, loading }: { room: DuelRoom | undefined; pov: number | null; onPov: (pov: number | null) => void; loading: boolean }) {
  const seats = room?.session.seats ?? [];
  const format = room?.session.format ?? "1v1";
  const acting = room?.engine?.prompt?.seat ?? room?.engine?.prioritySeat ?? null;
  const turnSeat = room?.engine?.turnSeat ?? null;
  return (
    <div className={styles.bar} role="region" aria-label="Admin watch" data-testid="admin-watch-bar" aria-busy={loading}>
      <span className={styles.badge}><Eye size={13} strokeWidth={1.9} aria-hidden /> Watching as admin <em>Read-only</em></span>
      <div className={styles.chips} role="radiogroup" aria-label="Point of view">
        <button type="button" role="radio" aria-checked={pov === null} className={styles.chip} data-active={pov === null || undefined}
          data-testid="watch-pov-neutral" onClick={() => onPov(null)}>Neutral</button>
        {seats.map((seat) => {
          const tone = SEAT_TONE_HEX[toneOf(format, seat.seat)];
          return (
            <button key={seat.seat} type="button" role="radio" aria-checked={pov === seat.seat} className={styles.chip}
              data-active={pov === seat.seat || undefined} data-testid={`watch-pov-${seat.seat}`}
              style={{ "--tone": tone.main, "--tone-ink": tone.ink } as React.CSSProperties}
              onClick={() => onPov(seat.seat)} title={`See the table as ${seat.displayName} sees it`}>
              <i aria-hidden />
              <span className={styles.chipName}>{seat.displayName}</span>
              <small>Seat {seat.seat + 1}{seat.isBot ? " · Bot" : ""}</small>
              {turnSeat === seat.seat ? <b className={styles.turnMark} title="Their turn">Turn</b> : null}
              {acting === seat.seat ? <b className={styles.actMark} title="Waiting for their answer">Acts</b> : null}
            </button>
          );
        })}
      </div>
      <span className={styles.status}>{room ? statusLine(room) : "Loading"}</span>
      <Link href={BACK_HREF} className={styles.back} data-testid="watch-back">Admin console</Link>
    </div>
  );
}

/**
 * Admin live watch of one duel. The board is the player room itself (`DuelRoomView` in read-only admin mode), so a seat point
 * of view looks exactly like that player's screen; the neutral view is the public spectator screen.
 */
export function AdminDuelWatch({ slug, initialSeat = null }: { slug: string; initialSeat?: number | null }) {
  const [pov, setPov] = useState<number | null>(initialSeat);
  // The room reads the same key: one request serves both, and a change of view reads once.
  const { data: room, isLoading, error } = useSWR(adminDuelRoomKey(slug, pov), () => getAdminDuelRoom(slug, pov),
    { revalidateOnFocus: false, revalidateOnReconnect: false, keepPreviousData: true });
  const choose = useCallback((next: number | null) => {
    setPov(next);
    try {
      const url = new URL(window.location.href);
      if (next == null) url.searchParams.delete("seat"); else url.searchParams.set("seat", String(next));
      window.history.replaceState(window.history.state, "", url);
    } catch { /* the address bar only misses a deep link */ }
  }, []);
  return (
    <div className={styles.watchRoot} data-testid="admin-duel-watch">
      <WatchBar room={room} pov={pov} onPov={choose} loading={isLoading || (room != null && error != null)} />
      <DuelRoomView slug={slug} adminWatch={{ pov, backHref: BACK_HREF }} />
    </div>
  );
}
