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
import { useOptionalRouter } from "./use-optional-router";

export interface TournamentsListProps {
  initialItems: TournamentListItem[];
  nextCursor: string | null;
  rounds: Map<number, TournamentRounds>;
  viewerId: number | null;
  /** The signed-in user (not player) id; the creator of a tournament gets its Cancel control. */
  viewerUserId?: number | null;
}
/**
 * The first page is server rendered; "Load more" appends the next ones from `/api/tournaments`.
 * `rounds` covers the first page only, so an appended running or open row has no round strip or
 * duel action (`TournamentRow` already draws without them).
 */
export function TournamentsList({ initialItems, nextCursor, rounds, viewerId, viewerUserId = null }: TournamentsListProps) {
  const list = usePagedList<TournamentApiItem, TournamentListItem>({
    endpoint: "/api/tournaments",
    initialItems,
    initialCursor: nextCursor,
    adapt: tournamentFromApi,
  });
  // Rows the organizer cancelled here leave the list at once; a reload no longer returns them.
  const [cancelled, setCancelled] = React.useState<ReadonlySet<number>>(new Set());
  const tournaments = list.items.filter((t) => !cancelled.has(t.id));
  // The row that held focus is gone after a cancel, so a short status line takes focus and says what happened.
  const [notice, setNotice] = React.useState<string | null>(null);
  const noticeRef = React.useRef<HTMLParagraphElement>(null);
  React.useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);
  const router = useOptionalRouter();
  const onCancelled = (t: TournamentListItem) => {
    setCancelled((prev) => new Set(prev).add(t.id));
    setNotice(`Cancelled ${t.name}.`);
    // The header counts come from the server render.
    router?.refresh();
  };
  const canCancel = (t: TournamentListItem) => viewerUserId !== null && t.createdByUserId === viewerUserId;
  const groups = groupTournaments(tournaments);
  // One pagination control at a time: "Show all N" first, then "Load more".
  const [expanded, setExpanded] = React.useState(false);
  const previewOpen = expanded || list.appended;
  const collapsed = !previewOpen && groups.finished.length > FINISHED_PREVIEW;
  return (
    <div className={styles.paged}>
      {notice && <p ref={noticeRef} role="status" tabIndex={-1} className={styles.notice}>{notice}</p>}
      {tournaments.length === 0 ? (
        <EmptyTournaments />
      ) : (
        <div className={styles.sections}>
          {groups.running.length > 0 && (
            <section aria-labelledby="tl-run">
              <SectionHead title="In progress" id="tl-run" />
              <FloorList aria-labelledby="tl-run">
                {groups.running.map((t) => (
                  <TournamentRow key={t.id} tournament={t} variant="running" rounds={rounds.get(t.id)} viewerId={viewerId} canCancel={canCancel(t)} onCancelled={onCancelled} />
                ))}
              </FloorList>
            </section>
          )}
          {groups.open.length > 0 && (
            <section aria-labelledby="tl-open">
              <SectionHead title="Open to join" id="tl-open" note="Nothing starts until the organizer presses Start." />
              <FloorList aria-labelledby="tl-open">
                {groups.open.map((t) => (
                  <TournamentRow key={t.id} tournament={t} variant="open" rounds={rounds.get(t.id)} viewerId={viewerId} canCancel={canCancel(t)} onCancelled={onCancelled} />
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
