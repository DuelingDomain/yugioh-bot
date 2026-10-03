"use client";

import fxStyles from "../battle-fx.module.css";
import { duelFontClasses } from "../fonts";
import { DUEL_SHAKE_LABEL, DUEL_SHAKE_LEVELS, type DuelPreferences } from "../preferences";
import { DuelSettingsSummary, DuelSoundControls } from "../room-settings";
import roomStyles from "../room.module.css";
import type { TableController } from "./types";

/** The Settings tab of the left column of a table. The match sheet log is shared with the room (../text-log). */

export function TableSettings({ controller, preferences }: { controller: TableController; preferences: DuelPreferences }) {
  const { room } = controller;
  return (
    <div className={roomStyles.options}>
      <DuelSettingsSummary session={room.session} />
      <h2>Presentation</h2>
      <DuelSoundControls
        enabled={preferences.soundEnabled}
        volume={preferences.soundVolume}
        onEnabledChange={preferences.setSoundEnabled}
        onVolumeChange={preferences.setSoundVolume}
      />
      <label className="flex flex-col gap-2">Motion
        <select value={preferences.motion} onChange={(event) => preferences.setMotion(event.target.value as typeof preferences.motion)}>
          <option value="system">Use device setting</option>
          <option value="reduced">Reduced motion</option>
          <option value="full">Full motion</option>
        </select>
      </label>
      <div className={`${fxStyles.shakeRow} ${duelFontClasses}`}>
        <span>Screen shake</span>
        <div className={fxStyles.segment} role="group" aria-label="Screen shake">
          {DUEL_SHAKE_LEVELS.map((level) => (
            <button key={level} type="button" aria-pressed={preferences.shake === level} onClick={() => preferences.setShake(level)}>
              {DUEL_SHAKE_LABEL[level]}
            </button>
          ))}
        </div>
        <p className={fxStyles.shakeNote}>How hard heavy summons rattle the field.</p>
      </div>
      <p>Effects never pause the duel or submit a response. Camera keys: Tab, P, H, O, F, S, A, K.</p>
    </div>
  );
}
