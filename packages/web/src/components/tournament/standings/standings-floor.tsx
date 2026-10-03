"use client";

import { useState } from "react";
import Link from "next/link";
import { FloorList, FloorRow, LiveDot, LocatorStrip, Mono, SectionHead, SvButton, TierName, YouPill, ringColour, type LocatorSlot } from "@/components/sheet";
import { SECTION_IDS, type CrosstableProps } from "../sheet-contracts";
import { champion, currentRound, roundWindow, totalRounds, zoneLabel, zonesFor, type ZoneInfo } from "../floor/floor-model";
import { zoneState } from "../floor/zones";
import { StandingsGrid } from "./crosstable";
import { buildCrosstable, buildPlayerFlags, buildStandings } from "./standings-model";
import styles from "./standings.module.css";

function slotsFor(tournament: CrosstableProps["tournament"], zones: ZoneInfo[], viewerId: number | null): LocatorSlot[] {
  return zones.map((zone) => ({ state: zoneState(zone.kind), label: zoneLabel(tournament, zone, viewerId) }));
}

/** Standings as rows on the floor: place, who, a strip of round results, and the record. */
export function StandingsFloor({ tournament, currentUserPlayerId, ratings, final = false }: CrosstableProps & { final?: boolean }) {
  const [grid, setGrid] = useState(false);
  const standings = buildStandings(tournament);
  const flags = buildPlayerFlags(tournament);
  const roundRobin = tournament.format === "round_robin";
  const total = totalRounds(tournament);
  const now = currentRound(tournament);
  const win = roundWindow(total, now);
  const champ = champion(tournament);

  return (
    <section id={SECTION_IDS.standings} aria-label={final ? "Final standings" : "Standings"} className={styles.standings}>
      <span id="players" className={styles.anchor} aria-hidden="true" />
      <SectionHead
        title={final ? "Final standings" : "Standings"}
        note="Wins, then fewest losses. Equal records share a place."
        action={roundRobin && standings.length > 0 ? <SvButton variant="quiet" aria-pressed={grid} onClick={() => setGrid(!grid)}>{grid ? "Show list" : "Show grid"}</SvButton> : undefined}
      />
      {standings.length === 0 ? (
        <p className={styles.empty}>No players yet.</p>
      ) : grid ? (
        <StandingsGrid rows={buildCrosstable(tournament, currentUserPlayerId)} currentUserPlayerId={currentUserPlayerId} narrow={false} />
      ) : (
        <FloorList as="ol" aria-label="Tournament standings">
          {standings.map((row) => {
            const me = row.playerId === currentUserPlayerId;
            const flag = flags.get(row.playerId);
            const rating = ratings.get(row.playerId);
            const zones = zonesFor(tournament, row.playerId, total, null);
            const shown = win ? zones.filter((z) => z.round >= win.lo && z.round <= win.hi) : zones;
            const first = final && champ?.playerId === row.playerId;
            return (
              <FloorRow
                key={row.playerId}
                you={me}
                cols="34px 36px minmax(110px, 1fr) 160px 90px 64px"
                phoneCols="20px 30px minmax(0, 1fr) auto 40px"
                phoneAreas={'"rk mo nm st rc"'}
              >
                <span className={`sv-cell-rank ${styles.rk}`} data-first={first ? "true" : undefined}>{row.place}</span>
                <span className={styles.mo}><Mono name={row.displayName} size="md" ring={ringColour(row.playerId)} you={me} champion={first} /></span>
                <span className={`sv-cell-name ${styles.who}`}>
                  <span className={styles.nm}>
                    <Link href={`/player/${row.playerId}`} title={row.displayName}>{row.displayName}</Link>
                    {me && <YouPill />}
                  </span>
                  {rating && <span className={styles.tier}><TierName tier={rating.rank} /><em>{rating.rating}</em></span>}
                </span>
                <span className={styles.strip}>
                  <LocatorStrip slots={slotsFor(tournament, shown, currentUserPlayerId)} size="sm" label={`${row.displayName}, rounds`} />
                </span>
                <span className={styles.flag}>
                  {flag?.live ? <LiveDot you={me} /> : flag?.owesReply ? <span className={styles.owes}>Owes a reply</span> : null}
                </span>
                <span className={`sv-cell-num ${styles.recd}`} aria-label={`${row.wins} wins, ${row.losses} losses`}>{row.wins}–{row.losses}</span>
              </FloorRow>
            );
          })}
        </FloorList>
      )}
    </section>
  );
}
