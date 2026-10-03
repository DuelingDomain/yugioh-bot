import { SvButton } from "@/components/sheet";
import type { RejoinDraft } from "@/lib/rejoin-drafts";
import styles from "./rejoin-draft.module.css";

/**
 * A strip that sends a player back into a draft they are in: "Rejoin draft" when it is dealing,
 * "Back to your draft" while it is a lobby. Renders nothing when the player has no such draft.
 */
export function RejoinDraftBanner({ drafts }: { drafts: RejoinDraft[] }) {
  if (drafts.length === 0) return null;
  return (
    <section className={styles.strip} aria-label="Your draft">
      {drafts.map((draft) => (
        <div key={draft.slug} className={styles.item} data-live={draft.status === "active" ? "" : undefined}>
          <div className={styles.text}>
            <p className={styles.kicker}>{draft.status === "active" ? "Your draft is live" : "You are in a draft lobby"}</p>
            <p className={styles.name}>{draft.name}</p>
          </div>
          <SvButton as="a" href={`/draft/${draft.slug}`} variant="primary">
            {draft.status === "active" ? "Rejoin draft" : "Back to your draft"}
          </SvButton>
        </div>
      ))}
    </section>
  );
}
