"use client";

import { FloorList, SectionHead } from "@/components/sheet";
import { EmptyTournaments } from "@/components/empty-states/empty-tournaments";
import { TournamentRow } from "./tournament-row";
import { FinishedLedger } from "./finished-ledger";
import { groupTournaments, type TournamentListItem } from "./tournaments-list-model";
import type { TournamentRounds } from "@/components/dashboard/tournament-rounds";

export interface TournamentsListProps {
  initialItems: TournamentListItem[];
  nextCursor: string | null;
  rounds: Map<number, TournamentRounds>;
  viewerId: number | null;
}
/** First page is server rendered. nextCursor is reserved for the subsequent paging UI. */
export function TournamentsList({ initialItems, nextCursor: _nextCursor, rounds, viewerId }: TournamentsListProps) {
  const tournaments = initialItems;
  const groups = groupTournaments(tournaments);
  return (
    <>
      {tournaments.length === 0 ? (
        <EmptyTournaments />
      ) : (
        <>
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
              <FinishedLedger items={groups.finished} />
            </section>
          )}
        </>
      )}
    </>
  );
}
