"use client";

import { FloorList, SectionHead } from "@/components/sheet";
import { LiveDraftRow, WaitingDraftRow } from "./draft-rows";
import { FinishedLedger } from "./finished-ledger";
import { EmptyDrafts } from "@/components/empty-states/empty-drafts";
import { groupDrafts, type DraftListItem } from "./drafts-list-model";
import styles from "./drafts-list.module.css";

export interface DraftsListProps {
  initialItems: DraftListItem[];
  nextCursor: string | null;
}
/** First page is server rendered. nextCursor is reserved for the subsequent paging UI. */
export function DraftsList({ initialItems, nextCursor: _nextCursor }: DraftsListProps) {
  const drafts = initialItems;
  const groups = groupDrafts(drafts);
  return (
    <>
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
              <FinishedLedger items={groups.finished} labelledBy="dl-fin" />
            </section>
          )}
        </div>
      )}
    </>
  );
}
