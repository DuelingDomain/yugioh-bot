"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { SectionHead, SvButton } from "@/components/sheet";
import { EmptyHero } from "@/components/empty-states/empty-hero";
import { GhostDraftRows, GhostPreview, GhostTournamentRows } from "@/components/empty-states/ghost";
import { OpenNowList } from "@/components/empty-states/open-now-list";
import { OPEN_ROUTES, hasOpenRows, openNowRows } from "@/components/empty-states/open-now-model";
import empty from "@/components/empty-states/empty-states.module.css";
import { useOpenNow } from "@/lib/hooks/use-open-now";
import styles from "./dashboard.module.css";

/**
 * The dashboard for a player with nothing yet: no player row, or one with no matches and nothing
 * joined. `standing` is the server-built "Your standing" block with the starting numbers.
 * When something is open, the list leads and its top row holds the primary button. When nothing
 * is, "Challenge someone" is the one primary and faded rows show what the page becomes.
 */
export function WelcomePanel({ standing }: { standing: ReactNode }) {
  const { settled, data } = useOpenNow();
  const rows = openNowRows(data);
  const open = hasOpenRows(rows);
  const leads = rows.join.length > 0;
  return (
    <>
      <section aria-labelledby="db-hello-t">
        <EmptyHero id="db-hello-t" title="Your first match puts you on the board" lede="Join something and this page fills in.">
          {settled && !leads && (
            <>
              <SvButton as="a" href={OPEN_ROUTES.challenge} variant="primary" big>Challenge someone</SvButton>
              <SvButton as="a" href={OPEN_ROUTES.newTournament} variant="ghost" big>New tournament</SvButton>
              <SvButton as="a" href={OPEN_ROUTES.newDraft} variant="ghost" big>New draft</SvButton>
            </>
          )}
        </EmptyHero>
      </section>
      <div className={styles.cols}>
        {settled && (open ? (
          <OpenNowList className={`${styles.tournaments} ${empty.settle}`} rows={rows} id="db-open-now" />
        ) : (
          <section className={`${styles.tournaments} ${empty.settle}`} aria-labelledby="db-tournaments">
            <SectionHead title="Your tournaments" id="db-tournaments" action={<Link className="link" href="/tournaments">All tournaments</Link>} />
            <p className={empty.none}>You are not in a tournament yet. One you join shows here with your next round.</p>
            <GhostPreview><GhostTournamentRows count={3} /></GhostPreview>
          </section>
        ))}
        <div className={styles.standing}>
          {standing}
          <p className={empty.startNote}>Everyone starts at 1000 Elo, which is Silver. Gold starts at 1100.</p>
        </div>
        {settled && !open && (
          <section className={`${styles.drafts} ${empty.settle}`} aria-labelledby="db-drafts">
            <SectionHead title="Your drafts" id="db-drafts" action={<Link className="link" href="/drafts">All drafts</Link>} />
            <p className={empty.none}>You are not in a draft yet.</p>
            <GhostPreview>
              <GhostDraftRows count={1} kind="live" />
              <GhostDraftRows count={1} from={1} kind="wait" />
            </GhostPreview>
          </section>
        )}
      </div>
    </>
  );
}
