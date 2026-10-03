import { Mono, SectionHead, YouPill, ringColour } from "@/components/sheet";
import styles from "./lobby.module.css";

export interface LobbyPlayer {
  playerId: number;
  displayName: string;
  joinedAt?: string;
}

function joinedTime(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The players list: a ring and a name per seat. "You" comes from the seats response (violet ring and a pill); "Host" only
 * shows on your own seat when you are the host. While fewer than two have joined, one dashed seat says what is missing.
 * Only the join time is shown. Pick counts and pools stay hidden until the draft ends.
 */
export function LobbySeats({
  players,
  youIds,
  isCreator,
  aux,
}: {
  players: LobbyPlayer[];
  youIds: Set<number>;
  isCreator: boolean;
  aux: string;
}) {
  return (
    <section aria-labelledby="lobby-players-t" className={styles.seatsSec}>
      <SectionHead title="Players" note={aux} id="lobby-players-t" />
      <ul className={styles.seats} data-many={players.length > 6 ? "" : undefined}>
        {players.map((p) => {
          const you = youIds.has(p.playerId);
          const time = joinedTime(p.joinedAt);
          return (
            <li key={p.playerId} className={styles.seat} data-you={you ? "true" : undefined}>
              <Mono name={p.displayName} you={you} ring={you ? undefined : ringColour(p.playerId)} />
              <span className={styles.who}>
                <span className={styles.nm}>
                  <span className={styles.nmText}>{p.displayName}</span>
                  {you && <YouPill />}
                  {you && isCreator && <span className={styles.hostTag}>Host</span>}
                </span>
                {time && <span className={styles.sub}>Joined {time}</span>}
              </span>
            </li>
          );
        })}
        {players.length < 2 && (
          <li className={styles.seat} data-open="true">
            <Mono name="" dashed />
            <span className={styles.who}>
              <span className={styles.nm}><span className={styles.nmText}>Open seat</span></span>
              <span className={styles.sub}>Needed to start</span>
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}
