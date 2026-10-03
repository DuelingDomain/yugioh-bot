"use client";

import type { CSSProperties } from "react";
import { Zone, type ZoneState } from "@/components/sheet";
import type { TournamentDetail } from "../types";
import { initials, roundWindow, rangeText, zoneLabel, zonesFor, type ZoneInfo, type ZoneKind } from "./floor-model";
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

/** What the card itself shows: the other player's initials once it is played, the round number before that. */
function cardText(zone: ZoneInfo): string {
  if (zone.kind === "win" || zone.kind === "loss" || zone.kind === "pwin" || zone.kind === "ploss") return initials(zone.opponentName);
  if (zone.kind === "bye") return "";
  return String(zone.round);
}

/** The small caption under a zone. */
function captionText(zone: ZoneInfo): string {
  if (zone.kind === "bye") return "Bye";
  if (zone.kind === "none") return "Not drawn";
  return zone.opponentName;
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
        {size === "xs" ? undefined : cardText(zone) || undefined}
      </Zone>
    </span>
  );
}

/**
 * A player's round zones on the field: one card per round with an opponent caption, at most 5 shown
 * with a counter at each end for the rest.
 */
export function ZoneRow({ tournament, playerId, viewerId, heroId, total, current, name }: {
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
    <div className={styles.zrow} data-win={win ? "true" : undefined} role="group" aria-label={`${name}, rounds`}>
      {before && <span className={styles.rcount}>{before.full}</span>}
      {shown.map((zone) => (
        <div key={zone.round} className={styles.zn}>
          <SlotZone tournament={tournament} zone={zone} playerId={playerId} viewerId={viewerId} width="var(--field-zw)" />
          <span className={styles.zl}>
            <span className={zone.kind === "now" ? styles.zlNow : styles.zlName}>{captionText(zone)}</span>
          </span>
        </div>
      ))}
      {after && <span className={styles.rcount}>{after.full}</span>}
    </div>
  );
}
