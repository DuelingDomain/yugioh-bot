import { SectionHead, TierName } from "@/components/sheet";
import styles from "./dashboard.module.css";

/** Shown when you are signed in but have no player yet. */
export function WelcomePanel() {
  return (
    <section className={styles.hello} aria-labelledby="db-hello-t">
      <SectionHead title="Your first match puts you on the board" id="db-hello-t" />
      <p>Join something here and this page fills in.</p>
      <ol className={styles.steps}>
        <li>
          Join a tournament
          <small>Open one from Tournaments</small>
        </li>
        <li>
          Join a draft
          <small>Pick one from Drafts</small>
        </li>
        <li>
          Challenge someone
          <small>Start a duel from Duels and send them the link</small>
        </li>
      </ol>
      <div className={styles.start}>
        <TierName tier="Silver" />
        <span className={styles.startElo}>1000</span>
        <p>Everyone starts at 1000 Elo, which is Silver. Gold starts at 1100.</p>
      </div>
    </section>
  );
}
