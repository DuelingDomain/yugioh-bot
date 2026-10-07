import { FileUp } from "lucide-react";
import { SectionHead, SvButton } from "@/components/sheet";
import { EmptyHero } from "./empty-hero";
import { GhostDeckRows, GhostLabel, GhostPreview } from "./ghost";
import { OPEN_ROUTES } from "./open-now-model";
import styles from "./empty-states.module.css";

/** The Decks page with no saved deck. "Import YDK files" is the one primary; the page bar's buttons are secondary meanwhile. */
export function EmptyDecks({ onImport }: { onImport: () => void }) {
  return (
    <>
      <section aria-labelledby="decks-none">
        <EmptyHero id="decks-none" title="No saved decks yet" lede="Import a YDK file or build a list, then pick it when you sit down at a table. A deck you draft saves here when the draft ends.">
          <SvButton variant="primary" big onClick={onImport}>
            <FileUp size={16} aria-hidden="true" />
            Import YDK files
          </SvButton>
          <SvButton as="a" href={OPEN_ROUTES.newDeck} variant="ghost" big>Create a deck</SvButton>
        </EmptyHero>
        <p className={`${styles.drop} ${styles.dropGap}`}>
          <FileUp size={20} aria-hidden="true" />
          <span>
            Drop .ydk files anywhere on this page
            <small>Each file becomes one saved deck.</small>
          </span>
        </p>
      </section>
      <GhostPreview className={styles.settle}>
        <GhostLabel>Once you have some</GhostLabel>
        <div className={styles.gtop}>
          <SectionHead title="Saved decks" />
          <GhostDeckRows count={4} />
        </div>
      </GhostPreview>
    </>
  );
}
