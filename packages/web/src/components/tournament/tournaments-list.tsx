"use client";

import * as React from "react";
import { FloorList, SectionHead, SvButton } from "@/components/sheet";
import type { TournamentRounds } from "@/components/dashboard/tournament-rounds";
import { TournamentRow } from "./tournament-row";
import { FinishedLedger } from "./finished-ledger";
import { groupTournaments, type TournamentListItem } from "./tournaments-list-model";
import { useOptionalRouter } from "./use-optional-router";
import styles from "./tournaments-list.module.css";

export interface TournamentsListProps {
  initialItems: TournamentListItem[];
  rounds: Map<number, TournamentRounds>;
  viewerId: number | null;
  /** The session's Discord ID as text, distinct from the numeric player ID. */
  viewerUserId: string | null;
}

export function TournamentsList({ initialItems, rounds, viewerId, viewerUserId }: TournamentsListProps) {
  const [cancelled, setCancelled] = React.useState<ReadonlySet<number>>(new Set());
  const tournaments = initialItems.filter((t) => !cancelled.has(t.id));
  const groups = groupTournaments(tournaments);
  const [notice, setNotice] = React.useState<string | null>(null);
  const noticeRef = React.useRef<HTMLParagraphElement>(null);
  React.useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);
  const router = useOptionalRouter();
  const onCancelled = (t: TournamentListItem) => {
    setCancelled((prev) => new Set(prev).add(t.id));
    setNotice(`Cancelled ${t.name}.`);
    router?.refresh();
  };
  const canCancel = (t: TournamentListItem) => viewerUserId !== null && t.createdByUserId === viewerUserId;
  return (
    <div className={styles.sections}>
      {notice && <p ref={noticeRef} role="status" tabIndex={-1} className={styles.notice}>{notice}</p>}
      {tournaments.length === 0 ? (
        <section aria-labelledby="tl-none">
          <SectionHead title="No tournaments yet" id="tl-none" />
          <p className={styles.lede}>
            Create one here, or run <code className="cmd">/event create</code> in Discord. Either way it shows up on this
            page.
          </p>
          <SvButton as="a" href="/tournaments/new" variant="primary">
            New tournament
          </SvButton>
        </section>
      ) : (
        <>
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
              <FinishedLedger items={groups.finished} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
