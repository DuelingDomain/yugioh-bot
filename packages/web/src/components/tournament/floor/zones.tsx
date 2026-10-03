"use client";

import type { CSSProperties } from "react";
import { Zone, type ZoneState } from "@/components/sheet";
import type { TournamentDetail } from "../types";
import { initials, roundName, roundWindow, rangeText, zoneLabel, zonesFor, type ZoneInfo, type ZoneKind } from "./floor-model";
import styles from "./floor.module.css";

export function zoneState(kind: ZoneKind): ZoneState {
  switch (kind) {
    case "win": return "won";
    case "loss":
    case "ploss": return "lost";
    case "pwin": return "pending";
    case "now": return "now";
    case "bye": return "dashed";
    default: return "empty";
  }
}

/**
 * What the card itself shows. A won round shows the other player's initials on a gold card, a lost round shows
 * a bare card back. A round still to play shows the other player's initials dim inside the empty slot.
 */
function cardText(zone: ZoneInfo): string | undefined {
  switch (zone.kind) {
    case "win":
    case "pwin":
    case "now":
    case "open": return initials(zone.opponentName);
    default: return undefined;
  }
}

/** The label under a zone: "Beat DJ", "Lost to MM", "Round 3" for this one, "R4" for the ones to come. */
function captionText(zone: ZoneInfo): string {
  const mono = initials(zone.opponentName);
  switch (zone.kind) {
    case "win":
    case "pwin": return `Beat ${mono}`;
    case "loss":
    case "ploss": return `Lost to ${mono}`;
    case "bye": return "Bye";
    case "now": return `Round ${zone.round}`;
    default: return `R${zone.round}`;
  }
}

/** Single elimination names its rounds (Semifinal, Final), so the label is two lines: the round, then what happened. */
function eliminationCaption(tournament: Pick<TournamentDetail, "format" | "participants" | "matches">, zone: ZoneInfo): [string, string] {
  const mono = initials(zone.opponentName);
  const round = roundName(tournament, zone.round);
  switch (zone.kind) {
    case "win":
    case "pwin": return [round, `Beat ${mono}`];
    case "loss":
    case "ploss": return [round, `Lost to ${mono}`];
    case "bye": return [round, "Bye"];
    case "now": return [round, "Now"];
    default: return [round, ""];
  }
}

/**
 * One zone, wrapped in a span the locator fly looks up: `data-slot="<playerId>:<tournamentMatchId>"`.
 * The Zone itself forwards no data attributes, so the hook is on the wrapper.
 */
export function SlotZone({ tournament, zone, playerId, viewerId, size, width, focusable = true }: {
  tournament: Pick<TournamentDetail, "format" | "participants" | "matches">;
  zone: ZoneInfo;
  playerId: number;
  viewerId: number | null;
  size?: "xs" | "sm" | "md";
  /** A CSS length for `--zw`; omit for the size's own width. */
  width?: string;
  focusable?: boolean;
}) {
  return (
    <span className={styles.slot} data-slot={zone.match ? `${playerId}:${zone.match.id}` : undefined}>
      <Zone
        state={zoneState(zone.kind)}
        size={size}
        label={zoneLabel(tournament, zone, viewerId)}
        focusable={focusable}
        style={width ? ({ "--zw": width } as CSSProperties) : undefined}
      >
        {size === "xs" ? undefined : cardText(zone)}
      </Zone>
    </span>
  );
}

/**
 * A player's round zones on the field: one card per round with an opponent caption, at most 5 shown
 * with a counter at each end for the rest.
 */
export function ZoneRow({ tournament, playerId, viewerId, heroId, total, current, name, onPick }: {
  tournament: TournamentDetail;
  playerId: number;
  viewerId: number | null;
  heroId: number | null;
  total: number;
  current: number;
  name: string;
  /** On the viewer's own row: puts an open match of theirs on the field. Their other open zones become buttons. */
  onPick?: (matchId: number) => void;
}) {
  const zones = zonesFor(tournament, playerId, total, heroId);
  const win = roundWindow(total, current);
  const shown = win ? zones.filter((z) => z.round >= win.lo && z.round <= win.hi) : zones;
  const before = win && win.lo > 1 ? rangeText(zones, 1, win.lo - 1) : null;
  const after = win && win.hi < total ? rangeText(zones, win.hi + 1, total) : null;
  return (
    <div className={styles.zrow} data-win={win ? "true" : undefined} role="group" aria-label={`${name}, rounds`}>
      {before && <span className={styles.rcount}>{before.full}</span>}
      {shown.map((zone) => (
        <div key={zone.round} className={styles.zn}>
          {onPick && playerId === viewerId && zone.match && zone.match.id !== heroId && zone.kind !== "win" && zone.kind !== "loss" && zone.kind !== "bye" && zone.kind !== "none" ? (
            <button type="button" className={styles.zpick} data-match-id={zone.match.id} aria-label={`${zoneLabel(tournament, zone, viewerId)}. Show this match.`} onClick={() => onPick(zone.match!.id)}>
              <SlotZone tournament={tournament} zone={zone} playerId={playerId} viewerId={viewerId} width="var(--field-zw)" focusable={false} />
            </button>
          ) : (
            <SlotZone tournament={tournament} zone={zone} playerId={playerId} viewerId={viewerId} width="var(--field-zw)" />
          )}
          <span className={styles.zl}>
            {tournament.format === "single_elim" ? (() => {
              const [round, sub] = eliminationCaption(tournament, zone);
              return <><span className={styles.zlName}>{round}</span><span className={zone.kind === "now" ? styles.zlNow : undefined}>{sub}</span></>;
            })() : (
              <span className={zone.kind === "now" ? styles.zlNow : zone.kind === "open" || zone.kind === "none" ? undefined : styles.zlName}>{captionText(zone)}</span>
            )}
          </span>
        </div>
      ))}
      {after && <span className={styles.rcount}>{after.full}</span>}
    </div>
  );
}

/**
 * A player's rounds as a compact row of small cards, for the tables of the spectator grid. At most 5 show, with
 * a short counter ("2 wins") at each end for the rest. `heroId` is the table the row sits on, so its round is lit.
 */
export function ZoneStrip({ tournament, playerId, viewerId, heroId, total, current, name }: {
  tournament: TournamentDetail;
  playerId: number;
  viewerId: number | null;
  heroId: number | null;
  total: number;
  current: number;
  name: string;
}) {
  const zones = zonesFor(tournament, playerId, total, heroId);
  const win = roundWindow(total, current);
  const shown = win ? zones.filter((z) => z.round >= win.lo && z.round <= win.hi) : zones;
  const before = win && win.lo > 1 ? rangeText(zones, 1, win.lo - 1) : null;
  const after = win && win.hi < total ? rangeText(zones, win.hi + 1, total) : null;
  return (
    <span className={styles.zstrip} role="group" aria-label={`${name}, rounds`}>
      {before && <span className={styles.rcount} title={before.full}>{before.short}</span>}
      {shown.map((zone) => <SlotZone key={zone.round} tournament={tournament} zone={zone} playerId={playerId} viewerId={viewerId} size="sm" />)}
      {after && <span className={styles.rcount} title={after.full}>{after.short}</span>}
    </span>
  );
}
