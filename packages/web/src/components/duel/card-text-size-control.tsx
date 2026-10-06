"use client";

import fxStyles from "./battle-fx.module.css";
import { CARD_TEXT_SIZES, CARD_TEXT_SIZE_LABEL, setCardTextSize, useCardTextSize } from "./card-text-size";
import { duelFontClasses } from "./fonts";

/** Settings > Presentation: the text size of the card info panel (1v1, Tag, 3-way, 4-way). Saved for this browser. */
export function DuelCardTextSizeControl() {
  const size = useCardTextSize();
  return (
    <div className={`${fxStyles.shakeRow} ${duelFontClasses}`}>
      <span>Card text size</span>
      <div className={fxStyles.segment} role="group" aria-label="Card text size">
        {CARD_TEXT_SIZES.map((level) => (
          <button key={level} type="button" aria-pressed={size === level} onClick={() => setCardTextSize(level)}>
            {CARD_TEXT_SIZE_LABEL[level]}
          </button>
        ))}
      </div>
      <p className={fxStyles.shakeNote}>Name, type and effect text in the card info panel.</p>
    </div>
  );
}
