"use client";

import * as React from "react";
import { FloorList, SectionHead } from "@/components/sheet";
import { LiveDraftRow, WaitingDraftRow } from "./draft-rows";
import { FinishedLedger } from "./finished-ledger";
import { EmptyDrafts } from "@/components/empty-states/empty-drafts";
import { LoadMore } from "@/components/paged-list/load-more";
import { usePagedList } from "@/lib/hooks/use-paged-list";
import { FINISHED_PREVIEW, draftFromApi, groupDrafts, type DraftApiItem, type DraftListItem } from "./drafts-list-model";
import styles from "./drafts-list.module.css";

export interface DraftsListProps {
  initialItems: DraftListItem[];
  nextCursor: string | null;
}
/**
 * The first page is server rendered; "Load more" appends the next ones from `/api/drafts`.
 * Appended rows carry no setup (the API leaves it out), so a live row shows "Pack 2, pick 4"
 * without a total and no pick time.
 */
export function DraftsList({ initialItems, nextCursor }: DraftsListProps) {
  const list = usePagedList<DraftApiItem, DraftListItem>({
    endpoint: "/api/drafts",
    initialItems,
    initialCursor: nextCursor,
    adapt: draftFromApi,
  });
  const drafts = list.items;
  const groups = groupDrafts(drafts);
  // One pagination control at a time: "Show all N" first, then "Load more".
  const [expanded, setExpanded] = React.useState(false);
  const previewOpen = expanded || list.appended;
  const collapsed = !previewOpen && groups.finished.length > FINISHED_PREVIEW;
  return (
    <div className={styles.paged}>
      {drafts.length === 0 ? (
        <EmptyDrafts />
      ) : (
        <div className={styles.sections}>
          {groups.live.length > 0 && (
            <section aria-labelledby="dl-live">
              <SectionHead id="dl-live" title="Live now" />
              <FloorList aria-labelledby="dl-live">
                {groups.live.map((d) => (
                  <LiveDraftRow key={d.id} draft={d} />
                ))}
              </FloorList>
            </section>
          )}
          {groups.waiting.length > 0 && (
            <section aria-labelledby="dl-wait">
              <SectionHead id="dl-wait" title="Waiting to start" note="Nothing is dealt until the host presses Start." />
              <FloorList aria-labelledby="dl-wait">
                {groups.waiting.map((d) => (
                  <WaitingDraftRow key={d.id} draft={d} />
                ))}
              </FloorList>
            </section>
          )}
          {groups.finished.length > 0 && (
            <section aria-labelledby="dl-fin">
              <SectionHead id="dl-fin" title="Finished" note="Newest first" />
              <FinishedLedger items={groups.finished} labelledBy="dl-fin" showAll={previewOpen} onShowAll={() => setExpanded(true)} />
            </section>
          )}
        </div>
      )}
      {!collapsed && <LoadMore list={list} noun="drafts" />}
    </div>
  );
}
