"use client";

import fxStyles from "./battle-fx.module.css";
import { DICE_SKINS, setDiceSkin, useDiceSkin } from "./dice-skins";
import { duelFontClasses } from "./fonts";

/** Settings > Presentation: the look of the dice in the 3-way and 4-way opening. Saved for this browser; it draws every die on this screen. */
export function DuelDiceSkinControl() {
  const skin = useDiceSkin();
  return (
    <div className={`${fxStyles.shakeRow} ${duelFontClasses}`}>
      <span>Dice</span>
      <div className={fxStyles.segment} role="group" aria-label="Dice">
        {DICE_SKINS.map((option) => (
          <button key={option.id} type="button" aria-pressed={skin === option.id} disabled={option.state === "locked"} onClick={() => setDiceSkin(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
      <p className={fxStyles.shakeNote}>How the dice look in the 3-way and 4-way opening roll. Only your screen changes.</p>
    </div>
  );
}
