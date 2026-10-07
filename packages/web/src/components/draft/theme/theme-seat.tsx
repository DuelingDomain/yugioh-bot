"use client";

import * as React from "react";
import { Check, Crown } from "lucide-react";
import type { CSSProperties } from "react";
import type { DraftAllowedCube, LobbyPlayer, LobbySnapshot } from "@yugidraft/shared/types";
import { Mono, YouPill, ringColour, svButtonClass } from "@/components/sheet";
import { cn } from "@/lib/utils";
import { SeatControls, type LobbyController } from "../lobby/lobby-actions";
import { initialOf, seatSlots, type LobbySlot } from "../lobby/lobby-model";
import type { ThemeTable } from "./use-theme-table";
import styles from "./theme-table.module.css";

interface SeatThemeProps {
  player: LobbyPlayer;
  table: ThemeTable;
  cubes: DraftAllowedCube[];
  isHost: boolean;
  controller: LobbyController;
  locked: boolean;
}

/** The theme line of one seat: the claim controls for your own seat, the assign select for the host, plain text for the rest. */
function SeatTheme({ player, table, cubes, isHost, controller, locked }: SeatThemeProps) {
  const selectId = React.useId();
  const current = table.cubeOf(player.playerId);
  const cube = cubes.find((c) => c.id === current) ?? null;
  const busy = controller.pending !== null || locked;

  if (table.selection === "random") {
    return <p className={styles.seatTheme} data-empty="true">Gets a random theme when the draft starts.</p>;
  }

  const mine = table.selection === "player_pick" && player.isYou;
  const assigning = table.selection === "host_assigned" && isHost;
  if (!mine && !assigning) {
    if (table.selection === "host_assigned") {
      return <p className={styles.seatTheme} data-empty="true">The host gives out the themes.</p>;
    }
    return cube ? (
      <p className={styles.seatTheme}><span className={styles.themeLabel}>Theme</span><b>{cube.name}</b></p>
    ) : (
      <p className={styles.seatTheme} data-empty="true">{player.isBot ? "Gets a random theme at the start." : "No theme yet."}</p>
    );
  }

  const label = mine ? "Your theme" : `Theme for ${player.displayName}`;
  const change = (value: string) => {
    const cubeId = value === "" ? null : Number(value);
    if (mine) void (cubeId === null ? table.release() : table.claim(cubeId));
    else void table.assign(player.playerId, cubeId);
  };
  return (
    <div className={styles.seatTheme} data-field="true">
      <label className={styles.themeLabel} htmlFor={selectId}>{label}</label>
      <div className={styles.themePick}>
        <select
          id={selectId}
          className={cn("input", "select", styles.themeSelect)}
          value={current ?? ""}
          disabled={busy}
          onChange={(e) => change(e.target.value)}
        >
          <option value="">{cubes.length === 0 ? "No themes yet" : "Choose a theme"}</option>
          {cubes.map((c) => {
            const holder = table.unavailableFor(c.id, player.playerId);
            return (
              <option key={c.id} value={c.id} disabled={holder !== null}>
                {c.name}{holder ? ` (taken by ${holder.displayName})` : ""}
              </option>
            );
          })}
        </select>
        {mine && current !== null && (
          <button type="button" className={cn(svButtonClass("quiet"), styles.smallBtn)} disabled={busy} onClick={() => void table.release()}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export interface ThemeSeatsProps {
  players: LobbyPlayer[];
  lobby: LobbySnapshot;
  table: ThemeTable;
  cubes: DraftAllowedCube[];
  controller: LobbyController;
  isHost: boolean;
  isMember: boolean;
  onInvite?: () => void;
  onAddBot?: () => Promise<void>;
  botsEnabled?: boolean;
  inviteRef?: React.Ref<HTMLButtonElement>;
}

/**
 * The seats with their theme controls. This list is the real interface; the oval beside it only draws the same seats.
 * One open seat carries Invite (and Add bot where test bots are allowed).
 */
export function ThemeSeats({ players, lobby, table, cubes, controller, isHost, isMember, onInvite, onAddBot, botsEnabled, inviteRef }: ThemeSeatsProps) {
  const slots = seatSlots(players, lobby.targetSeats);
  const firstOpen = slots.findIndex((s) => s.type === "open");
  const locked = lobby.start !== null;
  return (
    <ul className={styles.seats} aria-label="Seats">
      {slots.map((slot, index) => {
        if (slot.type === "player") {
          const p = slot.player;
          return (
            <li key={p.playerId} className={styles.seat} data-you={p.isYou ? "true" : undefined} data-ready={p.ready ? "true" : undefined}>
              <span className={styles.seatHead}>
                <Mono name={p.displayName} initials={initialOf(p.displayName)} ring={ringColour(p.playerId)} you={p.isYou} />
                <span className={styles.seatWho}>
                  <span className={styles.seatName}>
                    <span className={styles.seatNameText}>{p.displayName}</span>
                    {p.isHost && <Crown size={14} aria-label="Host" />}
                    {p.isYou && <YouPill />}
                  </span>
                  <span className={styles.seatSub}>
                    {p.isBot && <span>Bot</span>}
                    <span className={styles.seatState} data-ready={p.ready ? "true" : undefined}>
                      {p.ready && <Check size={13} aria-hidden="true" />}
                      {p.ready ? "Ready" : "Not ready"}
                    </span>
                  </span>
                </span>
              </span>
              <SeatTheme player={p} table={table} cubes={cubes} isHost={isHost} controller={controller} locked={locked} />
              <SeatControls player={p} lobby={lobby} controller={controller} isHost={isHost} />
            </li>
          );
        }
        const first = index === firstOpen;
        return (
          <li key={`open-${slot.index}`} className={styles.seat} data-open="true">
            <span className={styles.seatHead}>
              <Mono name="" dashed />
              <span className={styles.seatWho}>
                <span className={styles.seatName}><span className={styles.seatNameText}>Open seat</span></span>
                <span className={styles.seatSub}>{first && lobby.targetSeats === null ? "Needed to start" : "Waiting for a player"}</span>
              </span>
            </span>
            {first && (
              <span className={styles.openActs}>
                {isMember && onInvite && (
                  <button ref={inviteRef} type="button" className={cn(svButtonClass("ghost"), styles.smallBtn)} onClick={onInvite}>Invite</button>
                )}
                {isHost && botsEnabled && onAddBot && (
                  <button
                    type="button"
                    className={cn(svButtonClass("quiet"), styles.smallBtn)}
                    disabled={controller.pending !== null}
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

/** Where seat `i` of `n` sits on the oval: the viewer's seat is at the bottom, the rest follow around the table. */
export function ovalPosition(i: number, n: number): { left: number; top: number } {
  const angle = (2 * Math.PI * i) / Math.max(n, 1);
  return { left: 50 - 46 * Math.sin(angle), top: 50 + 44 * Math.cos(angle) };
}

export interface ThemeOvalProps {
  slots: LobbySlot[];
  table: ThemeTable;
  cubes: DraftAllowedCube[];
  centre: React.ReactNode;
}

/** The table drawing: an oval, one disc per seat with the theme chip under it. Decorative; the seat list carries the controls. */
export function ThemeOval({ slots, table, cubes, centre }: ThemeOvalProps) {
  const youAt = Math.max(0, slots.findIndex((s) => s.type === "player" && s.player.isYou));
  const n = slots.length;
  return (
    <div className={styles.tableWrap} aria-hidden="true" data-seats={n}>
      <div className={styles.oval}>
        <div className={styles.mat}>{centre}</div>
      </div>
      {slots.map((slot, index) => {
        const { left, top } = ovalPosition((index - youAt + n) % n, n);
        const style = { left: `${left}%`, top: `${top}%` } as CSSProperties;
        if (slot.type === "open") {
          return (
            <span key={`open-${slot.index}`} className={styles.disc} data-open="true" style={style}>
              <Mono name="" dashed size="md" />
              <span className={styles.discName}>Open</span>
            </span>
          );
        }
        const p = slot.player;
        const cube = cubes.find((c) => c.id === table.cubeOf(p.playerId));
        return (
          <span key={p.playerId} className={styles.disc} data-you={p.isYou ? "true" : undefined} data-ready={p.ready ? "true" : undefined} style={style}>
            <Mono name={p.displayName} initials={initialOf(p.displayName)} ring={ringColour(p.playerId)} you={p.isYou} />
            <span className={styles.discName}>{p.displayName}</span>
            {cube && <span className={styles.discTheme}>{cube.name}</span>}
          </span>
        );
      })}
    </div>
  );
}
