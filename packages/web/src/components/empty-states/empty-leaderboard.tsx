import { SvButton } from "@/components/sheet";
import { EmptyHero } from "./empty-hero";
import { GhostLedger, GhostPreview } from "./ghost";
import { OPEN_ROUTES } from "./open-now-model";
import styles from "./empty-states.module.css";

/** The leaderboard before anyone is ranked. "Challenge someone" is the one primary, over a ghost ledger. */
export function EmptyLeaderboard({ busy }: { busy: boolean }) {
  return (
    <section aria-label="Leaderboard standings" aria-busy={busy} className={styles.stack}>
      <EmptyHero id="lb-none" title="No one is on the board yet" lede="Finish a ranked match to appear here. The first ranked match takes the top place.">
        <SvButton as="a" href={OPEN_ROUTES.challenge} variant="primary" big>Challenge someone</SvButton>
        <SvButton as="a" href={OPEN_ROUTES.tournaments} variant="ghost" big>See tournaments</SvButton>
      </EmptyHero>
      <GhostPreview><GhostLedger count={8} /></GhostPreview>
    </section>
  );
}
