"use client";

import { SectionHead, SvButton } from "@/components/sheet";
import { useOpenNow } from "@/lib/hooks/use-open-now";
import { EmptyHero } from "./empty-hero";
import { GhostLabel, GhostPreview, GhostTournamentRows } from "./ghost";
import { OpenNowList } from "./open-now-list";
import { OPEN_ROUTES, hasOpenRows, openNowRows } from "./open-now-model";
import styles from "./empty-states.module.css";

/**
 * The Tournaments page when the server has none. When a draft is open or duels are running, the
 * list leads and its top row holds the primary button. Otherwise "New tournament" is the one
 * primary, over a ghost of the filled page. (The page bar's own button is secondary meanwhile.)
 */
export function EmptyTournaments() {
  const { settled, data } = useOpenNow();
  // There are no tournaments here to join, so only drafts and duels can be open.
  const rows = openNowRows(data, ["drafts"]);
  const open = hasOpenRows(rows);
  const leads = rows.join.length > 0;
  return (
    <>
      <section aria-labelledby="tl-none">
        <EmptyHero id="tl-none" title="No tournaments yet" lede="Create one and share the link. It lists here, with its rounds, as players join.">
          {settled && !leads && <SvButton as="a" href={OPEN_ROUTES.newTournament} variant="primary" big>New tournament</SvButton>}
        </EmptyHero>
      </section>
      {settled && (open ? (
        <OpenNowList className={styles.settle} rows={rows} id="tl-open-now" />
      ) : (
        <GhostPreview className={styles.settle}>
          <GhostLabel>Once there is one</GhostLabel>
          <div className={styles.gtop}>
            <SectionHead title="Open to join" note="Nothing starts until the organizer presses Start." />
            <GhostTournamentRows count={2} strip={false} />
          </div>
          <div className={styles.gtop}>
            <SectionHead title="In progress" />
            <GhostTournamentRows count={3} from={2} />
          </div>
        </GhostPreview>
      ))}
    </>
  );
}
