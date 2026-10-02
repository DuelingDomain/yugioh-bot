import { UserPlus } from "lucide-react";
import { initialOf } from "./lobby-model";
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

/** The players list. "you" comes from the seats response; "host" only shows on your own seat when you are the host. */
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
      <div className="sec-h">
        <h2 className="sec-t" id="lobby-players-t">Players</h2>
        <span className="sec-aux">{aux}</span>
      </div>
      <ul className="seats">
        {players.map((p) => {
          const you = youIds.has(p.playerId);
          const time = joinedTime(p.joinedAt);
          return (
            <li key={p.playerId} className={`seat${you ? ` me ${styles.seatMe}` : ""}`}>
              <span className={styles.av} aria-hidden="true">{initialOf(p.displayName)}</span>
              <span className="who">
                <span className="nm">
                  <span className="t">{p.displayName}</span>
                  {you && <span className="youtag">you</span>}
                  {you && isCreator && <span className="hosttag">host</span>}
                </span>
                {time && <span className="sub">Joined {time}</span>}
              </span>
            </li>
          );
        })}
        {players.length < 2 && (
          <li className="seat open"><UserPlus className="ic" aria-hidden="true" /><span>Open seat · needed to start</span></li>
        )}
      </ul>
    </section>
  );
}
