import { cardImageUrl } from "@/lib/card-image-url";
import Image from "next/image";
import styles from "./login.module.css";

/**
 * Three cards in a fan, the front one raised, inside two gold rings and a faint hexagram.
 * Dark Magician and Blue-Eyes Ultimate Dragon sit behind Blue-Eyes White Dragon. The fan box is
 * square, so the ring centre is the box centre and the fan is centred on it by geometry.
 * All of it is decoration, so the group is hidden from assistive tech and the cards have no alt.
 */
const CARDS = [
  { id: 46986418, className: styles.dm },
  { id: 23995346, className: styles.ud },
  { id: 89631146, className: styles.be },
] as const;

export function LoginRing() {
  return (
    <div className={styles.fan} aria-hidden="true">
      <span className={styles.rings}>
        <span className={styles.dots}>
          <svg viewBox="0 0 100 100" focusable="false">
            <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="0.8" strokeDasharray="1.6 3.4" pathLength={240} />
          </svg>
        </span>
        <svg viewBox="0 0 100 100" focusable="false">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="0.6" />
        </svg>
      </span>
      <span className={styles.hex}>
        <svg viewBox="0 0 100 100" focusable="false">
          <path d="M50 12 L83 69 L17 69 Z M50 88 L17 31 L83 31 Z" fill="none" stroke="currentColor" strokeWidth="0.6" />
        </svg>
      </span>
      <span className={styles.deck}>
        {CARDS.map((card) => (
          <Image
            key={card.id}
            className={`${styles.fc} ${card.className}`}
            src={cardImageUrl(card.id)}
            unoptimized
            alt=""
            width={212}
            height={309}
            sizes="(max-width: 640px) 35vw, 212px"
            priority
          />
        ))}
      </span>
    </div>
  );
}
