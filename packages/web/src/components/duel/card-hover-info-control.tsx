"use client";

import fxStyles from "./battle-fx.module.css";
import { CARD_HOVER_INFO_LABEL, CARD_HOVER_INFO_VALUES, setCardHoverInfo, useCardHoverInfo } from "./card-hover-info";
import { duelFontClasses } from "./fonts";

/** Settings > Presentation: whether hovering a card opens the card info drawer. Saved for this browser. */
export function DuelCardHoverInfoControl() {
  const value = useCardHoverInfo();
  return (
    <div className={`${fxStyles.shakeRow} ${duelFontClasses}`}>
      <span>Card info on hover</span>
      <div className={fxStyles.segment} role="group" aria-label="Card info on hover">
        {CARD_HOVER_INFO_VALUES.map((option) => (
          <button key={option} type="button" aria-pressed={value === option} onClick={() => setCardHoverInfo(option)}>
            {CARD_HOVER_INFO_LABEL[option]}
          </button>
        ))}
      </div>
      <p className={fxStyles.shakeNote}>Drawer opens the card info when you hover a card. Off opens it only after a click on a card. Esc or a right click closes an open drawer first; the next press goes to the prompt.</p>
    </div>
  );
}
