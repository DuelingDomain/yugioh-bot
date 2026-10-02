"use client";

import { useEffect, useRef } from "react";
import type { DuelEngineView } from "@yugidraft/shared/duels";
import fxStyles from "../battle-fx.module.css";
import { duelFontClasses } from "../fonts";
import { DUEL_SHAKE_LEVELS, type DuelPreferences } from "../preferences";
import { DuelSettingsSummary, DuelSoundControls } from "../room-settings";
import roomStyles from "../room.module.css";
import { phaseTitle } from "./table-labels";
import type { TableController } from "./types";

/** The text log and the Settings tab of the left column of a table. */

const LOG_PHASE_KEYS: ReadonlySet<string> = new Set([
  "draw", "standby", "main1", "battle_start", "battle_step", "damage", "damage_cal", "battle", "main2", "end",
]);
type LogKind = "turn" | "phase" | "loss" | "gain" | "chain" | "result" | "line";

function logKind(text: string): LogKind {
  if (/^Turn \d+/.test(text)) return "turn";
  if (LOG_PHASE_KEYS.has(text)) return "phase";
  if (/ wins \(|^Draw \(/.test(text)) return "result";
  if (/ takes \d+ damage| pays \d+ LP/.test(text)) return "loss";
  if (/ gains \d+ LP/.test(text)) return "gain";
  if (/ is activating$|^A chain link was negated$|^Chain ended$/.test(text)) return "chain";
  return "line";
}

/** The engine log names seats "Player N"; a table of up to four seats shows the display names. */
function logText(text: string, kind: LogKind, nameOf: (seat: number) => string): string {
  if (kind === "phase") return phaseTitle(text);
  return text.replace(/\bPlayer ([1-4])\b/g, (_match, seat: string) => nameOf(Number(seat) - 1));
}

export function TableTextLog({ entries, nameOf, players }: {
  entries: DuelEngineView["log"];
  nameOf: (seat: number) => string;
  players: string;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const lastId = entries[entries.length - 1]?.id;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastId, entries.length]);
  return (
    <div className={roomStyles.sheet}>
      <div className={roomStyles.sheetHead}>
        <h2>Match sheet</h2>
        <span>{players}</span>
      </div>
      <ol ref={listRef} className={roomStyles.log} aria-label="Duel log">
        {entries.map((entry) => {
          const kind = logKind(entry.text);
          return <li key={entry.id} data-kind={kind}>{logText(entry.text, kind, nameOf)}</li>;
        })}
      </ol>
    </div>
  );
}

const SHAKE_LABEL = { off: "Off", low: "Low", medium: "Medium", high: "High" } as const;

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
              {SHAKE_LABEL[level]}
            </button>
          ))}
        </div>
        <p className={fxStyles.shakeNote}>How hard heavy summons rattle the field.</p>
      </div>
      <p>Effects never pause the duel or submit a response. Camera keys: Tab, P, H, O, F, S, A, K.</p>
    </div>
  );
}
