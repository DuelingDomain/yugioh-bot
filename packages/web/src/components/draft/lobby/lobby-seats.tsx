"use client";

import { useRef, type CSSProperties, type Ref } from "react";
import { Check, Crown } from "lucide-react";
import type { LobbyPlayer as SeatPlayer, LobbySnapshot } from "@yugidraft/shared/types";
import { Mono, SectionHead, YouPill, ringColour, svButtonClass } from "@/components/sheet";
import { useFlipList } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { SeatControls, type LobbyController } from "./lobby-actions";
import { initialOf, lobbyStartBlocker, plural, seatSlots } from "./lobby-model";
import styles from "./lobby.module.css";
import seats from "./seats-first.module.css";

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
  const list = useRef<HTMLUListElement>(null);
  // A player who joins arrives with a short rise instead of appearing.
  useFlipList(list, { enter: true });
  return (
    <section aria-labelledby="lobby-players-t" className={styles.seatsSec}>
      <SectionHead title="Players" note={aux} id="lobby-players-t" />
      <ul ref={list} className={styles.seats} data-many={players.length > 6 ? "" : undefined}>
        {players.map((p) => {
          const you = youIds.has(p.playerId);
          const time = joinedTime(p.joinedAt);
          return (
            <li key={p.playerId} className={styles.seat} data-you={you ? "true" : undefined} data-flip-id={p.playerId}>
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

/* ---------- Seats First ---------- */

export interface SeatSlotsProps {
  players: SeatPlayer[];
  lobby: LobbySnapshot;
  controller: LobbyController;
  isHost: boolean;
  /** The viewer holds a seat. Only members see Invite on an open seat. */
  isMember: boolean;
  onInvite?: () => void;
  /** Add bot. It shows only for the host and only with `botsEnabled`, which the server sets. */
  onAddBot?: () => Promise<void>;
  botsEnabled?: boolean;
  /** The Discord bot is on. When false the seats have no Nudge. Default on. */
  discordEnabled?: boolean;
  /** Receives the Invite button of the first open seat, so a dialog can give focus back to it. */
  inviteRef?: Ref<HTMLButtonElement>;
  className?: string;
}

/**
 * The seat slots: a big ring per player (a crown for the host, a green glow when ready, a violet border for you) and
 * dashed open seats up to the target. The first open seat carries Invite and, for the host with bots on, Add bot.
 * A legacy lobby (no target) shows its players and one open seat. Seat buttons come from `SeatControls`.
 */
export function SeatSlots({ players, lobby, controller, isHost, isMember, onInvite, onAddBot, botsEnabled, discordEnabled = true, inviteRef, className }: SeatSlotsProps) {
  const list = useRef<HTMLUListElement>(null);
  useFlipList(list, { enter: true });
  const slots = seatSlots(players, lobby.targetSeats);
  const firstOpen = slots.findIndex((slot) => slot.type === "open");
  const addingBot = controller.pending === "bot";
  return (
    <ul ref={list} className={cn(seats.slots, className)} data-many={slots.length > 4 ? "" : undefined}>
      {slots.map((slot, index) => {
        if (slot.type === "player") {
          const p = slot.player;
          const ring = p.isYou ? undefined : ringColour(p.playerId);
          return (
            <li
              key={p.playerId}
              className={seats.slot}
              data-flip-id={p.playerId}
              data-you={p.isYou ? "true" : undefined}
              data-ready={p.ready ? "true" : undefined}
              data-host={p.isHost ? "true" : undefined}
            >
              <span className={seats.ava} style={ring ? ({ "--ring": ring } as CSSProperties) : undefined} aria-hidden="true">
                {initialOf(p.displayName)}
                {p.isHost && <Crown className={seats.crown} size={16} />}
              </span>
              <span className={seats.slotWho}>
                <span className={seats.slotName}>
                  <span className={seats.slotNameText}>{p.displayName}</span>
                  {p.isYou && <YouPill />}
                </span>
                <span className={seats.slotSub}>
                  {p.isHost && <span>Host</span>}
                  {p.isBot && <span>Bot</span>}
                  <span className={seats.slotState} data-ready={p.ready ? "true" : undefined}>
                    {p.ready && <Check size={13} aria-hidden="true" />}
                    {p.ready ? "Ready" : "Not ready"}
                  </span>
                </span>
              </span>
              <SeatControls player={p} lobby={lobby} controller={controller} isHost={isHost} discordEnabled={discordEnabled} />
            </li>
          );
        }
        const first = index === firstOpen;
        return (
          <li key={`open-${slot.index}`} className={seats.slot} data-open="true">
            <span className={seats.ava} data-open="true" aria-hidden="true" />
            <span className={seats.slotWho}>
              <span className={seats.slotName}><span className={seats.slotNameText}>Open seat</span></span>
              <span className={seats.slotSub}>{first && lobby.targetSeats === null ? "Needed to start" : "Waiting for a player"}</span>
            </span>
            {first && (
              <span className={seats.seatActs}>
                {isMember && onInvite && (
                  <button ref={inviteRef} type="button" className={cn(svButtonClass("ghost"), seats.seatBtn)} onClick={onInvite}>Invite</button>
                )}
                {isHost && botsEnabled && onAddBot && (
                  <button
                    type="button"
                    className={cn(svButtonClass("quiet"), seats.seatBtn)}
                    disabled={controller.pending !== null && !addingBot}
                    aria-busy={addingBot || undefined}
                    onClick={() => void controller.run("bot", onAddBot, "Failed to add bot")}
                  >
                    Add bot
                  </button>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The launch numbers: seats filled and players ready, a bar with one segment per seat, and three check chips (enough
 * players, everyone ready, setup passes). The numbers are text, so they stay readable without colour.
 */
export function SeatMeter({ lobby, className }: { lobby: LobbySnapshot; className?: string }) {
  const target = lobby.targetSeats;
  const segments = Math.max(target ?? lobby.joined, 1);
  const blocker = lobbyStartBlocker({ joined: lobby.joined, errors: lobby.errors });
  const checks = [
    { key: "players", ok: lobby.joined >= 2, label: lobby.joined >= 2 ? `${plural(lobby.joined, "player")} in` : "Needs 2 players" },
    { key: "ready", ok: lobby.allReady, label: lobby.allReady ? "Everyone ready" : `${lobby.ready} of ${lobby.joined} ready` },
    { key: "setup", ok: lobby.errors.length === 0, label: lobby.errors.length === 0 ? "Setup passes" : "Setup needs a fix" },
  ];
  return (
    <div className={cn(seats.meter, className)} data-blocked={blocker ? "true" : undefined}>
      <div className={seats.meterNums}>
        <span className={seats.meterNum}>
          <b>{lobby.joined}</b>{target !== null && <span>/{target}</span>}
          <small>{target !== null ? "seats" : "joined"}</small>
        </span>
        <span className={seats.meterNum}>
          <b>{lobby.ready}</b><span>/{lobby.joined}</span>
          <small>ready</small>
        </span>
      </div>
      <div className={seats.bar} role="img" aria-label={`${lobby.joined} joined, ${lobby.ready} ready${target !== null ? `, ${target} seats` : ""}`}>
        {Array.from({ length: segments }, (_, i) => (
          <i key={i} data-state={i < lobby.ready ? "ready" : i < lobby.joined ? "joined" : "open"} />
        ))}
      </div>
      <ul className={seats.chips} aria-label="Start checks">
        {checks.map((c) => (
          <li key={c.key} data-ok={c.ok ? "true" : undefined}>
            {c.ok && <Check size={13} aria-hidden="true" />}
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
