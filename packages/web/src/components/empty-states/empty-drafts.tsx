"use client";

import { Plus } from "lucide-react";
import { SectionHead, SvButton } from "@/components/sheet";
import { useOpenNow } from "@/lib/hooks/use-open-now";
import { EmptyHero } from "./empty-hero";
import { GhostDraftRows, GhostLabel, GhostPreview } from "./ghost";
import { OpenNowList } from "./open-now-list";
import { OPEN_ROUTES, hasOpenRows, openNowRows } from "./open-now-model";
import styles from "./empty-states.module.css";

/**
 * The Drafts page when you have joined none. Open draft lobbies and running duels lead, the top
 * lobby holding the primary button. With none open, "New draft" is the one primary over a ghost of
 * the filled page. (The page bar's own button is secondary meanwhile.)
 */
export function EmptyDrafts() {
  const { settled, data } = useOpenNow();
  const rows = openNowRows(data, ["drafts"]);
  const open = hasOpenRows(rows);
  const leads = rows.join.length > 0;
  return (
    <>
      <section aria-labelledby="dl-none">
        <EmptyHero id="dl-none" title="No drafts yet" lede="Start one and share the link. Drafts you join show up on this page.">
          {settled && !leads && (
            <SvButton as="a" href={OPEN_ROUTES.newDraft} variant="primary" big>
              <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
              New draft
            </SvButton>
          )}
        </EmptyHero>
      </section>
      {settled && (open ? (
        <OpenNowList className={styles.settle} rows={rows} id="dl-open-now" note="Nothing is dealt until the host presses Start." />
      ) : (
        <GhostPreview className={styles.settle}>
          <GhostLabel>Once you join one</GhostLabel>
          <div className={styles.gtop}>
            <SectionHead title="Live now" />
            <GhostDraftRows count={1} kind="live" />
          </div>
          <div className={styles.gtop}>
            <SectionHead title="Waiting to start" note="Nothing is dealt until the host presses Start." />
            <GhostDraftRows count={3} from={1} kind="wait" />
          </div>
        </GhostPreview>
      ))}
    </>
  );
}
