import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SheetRoot } from "@/components/sheet";
import styles from "@/components/draft/create/create.module.css";

/** Fixed, well-known cards for the fans. They load through the existing card image route. */
const CUBE_FAN = [55144522, 77585513, 44095762];
const THEME_FAN = [62962630, 44362883, 87746184];

function Fan({ ids }: { ids: number[] }) {
  return (
    <span className={styles.fan} aria-hidden="true">
      {ids.map((id) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={id} src={`/api/cards/${id}/image?size=small`} alt="" loading="lazy" width={70} height={102} />
      ))}
    </span>
  );
}

export default function NewDraftPage() {
  return (
    <SheetRoot>
      <Link className="crumb" href="/drafts">
        <ChevronLeft className="ic sm" aria-hidden="true" />
        All drafts
      </Link>
      <header className="t-head sheet-head">
        <div>
          <h1 className="t-title">New draft</h1>
          <p className="page-sub">Pick how cards reach the players. You can&apos;t switch after the draft is made.</p>
        </div>
      </header>
      <div className={styles.choose}>
        <Link className={styles.kind} href="/drafts/new/cube">
          <Fan ids={CUBE_FAN} />
          <span className={styles.kt}>Cube draft</span>
          <span className={styles.kp}>
            Everyone opens packs from one shared pool and passes them around the table. A classic booster draft.
          </span>
          <ul className={styles.facts}>
            <li>One pool, built from sets, archetypes and passcodes</li>
            <li>Packs pass left, then right</li>
            <li>40 to 60 cards each</li>
          </ul>
          <span className={styles.go}>
            Set up a cube draft
            <ChevronRight className="ic sm" aria-hidden="true" />
          </span>
        </Link>
        <Link className={styles.kind} data-k="theme" href="/drafts/new/theme">
          <Fan ids={THEME_FAN} />
          <span className={styles.kt}>Theme draft</span>
          <span className={styles.kp}>
            Each player drafts alone from their own archetype. Every pick offers a few cards from your theme, so decks
            come out like structure decks.
          </span>
          <ul className={styles.facts}>
            <li>One theme per player, claimed in the lobby or dealt at random</li>
            <li>No passing, everyone picks at once</li>
            <li>Main deck first, then the Extra deck</li>
          </ul>
          <span className={styles.go}>
            Set up a theme draft
            <ChevronRight className="ic sm" aria-hidden="true" />
          </span>
        </Link>
      </div>
    </SheetRoot>
  );
}
