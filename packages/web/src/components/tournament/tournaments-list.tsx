"use client";

import * as React from "react";
import { FloorList, SectionHead } from "@/components/sheet";
import { EmptyTournaments } from "@/components/empty-states/empty-tournaments";
import styles from "./tournaments-list.module.css";
import { TournamentRow } from "./tournament-row";
import { FinishedLedger } from "./finished-ledger";
import { LoadMore } from "@/components/paged-list/load-more";
import { usePagedList } from "@/lib/hooks/use-paged-list";
import { FINISHED_PREVIEW, groupTournaments, tournamentFromApi, type TournamentApiItem, type TournamentListItem } from "./tournaments-list-model";
import type { TournamentRounds } from "@/components/dashboard/tournament-rounds";

export interface TournamentsListProps {
  initialItems: TournamentListItem[];
  nextCursor: string | null;
  rounds: Map<number, TournamentRounds>;
  viewerId: number | null;
}
/**
 * The first page is server rendered; "Load more" appends the next ones from `/api/tournaments`.
 * `rounds` covers the first page only, so an appended running or open row has no round strip or
 * duel action (`TournamentRow` already draws without them).
 */
export function TournamentsList({ initialItems, nextCursor, rounds, viewerId }: TournamentsListProps) {
  const list = usePagedList<TournamentApiItem, TournamentListItem>({
    endpoint: "/api/tournaments",
    initialItems,
    initialCursor: nextCursor,
    adapt: tournamentFromApi,
  });
  const tournaments = list.items;
  const groups = groupTournaments(tournaments);
  // One pagination control at a time: "Show all N" first, then "Load more".
  const [expanded, setExpanded] = React.useState(false);
  const previewOpen = expanded || list.appended;
  const collapsed = !previewOpen && groups.finished.length > FINISHED_PREVIEW;
  return (
    <div className={styles.paged}>
      {tournaments.length === 0 ? (
        <EmptyTournaments />
      ) : (
        <div className={styles.sections}>
          {groups.running.length > 0 && (
            <section aria-labelledby="tl-run">
              <SectionHead title="In progress" id="tl-run" />
              <FloorList aria-labelledby="tl-run">
                {groups.running.map((t) => (
                  <TournamentRow key={t.id} tournament={t} variant="running" rounds={rounds.get(t.id)} viewerId={viewerId} />
                ))}
              </FloorList>
            </section>
          )}
          {groups.open.length > 0 && (
            <section aria-labelledby="tl-open">
              <SectionHead title="Open to join" id="tl-open" note="Nothing starts until the organizer presses Start." />
              <FloorList aria-labelledby="tl-open">
                {groups.open.map((t) => (
                  <TournamentRow key={t.id} tournament={t} variant="open" rounds={rounds.get(t.id)} viewerId={viewerId} />
                ))}
              </FloorList>
            </section>
          )}
          {groups.finished.length > 0 && (
            <section aria-labelledby="tl-fin">
              <SectionHead title="Finished" id="tl-fin" note="Newest first" />
              <FinishedLedger items={groups.finished} showAll={previewOpen} onShowAll={() => setExpanded(true)} />
            </section>
          )}
        </div>
      )}
      {!collapsed && <LoadMore list={list} noun="tournaments" />}
    </div>
  );
}
