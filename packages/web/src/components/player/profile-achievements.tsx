"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Coins, Crown, Flame, Medal, Swords, Trophy, type LucideIcon } from "lucide-react";
import { NewChip, SummonCircle } from "@/components/sheet";
import {
  buildAchievements,
  formatDay,
  freshUnlocks,
  seenKey,
  type AchievementView,
  type Profile,
} from "./profile-model";
import styles from "./profile.module.css";


const ICONS: Record<string, LucideIcon> = {
  trophy: Trophy, flame: Flame, swords: Swords, coins: Coins, crown: Crown, medal: Medal,
};

function Tile({ view }: { view: AchievementView }) {
  const Icon = ICONS[view.icon] ?? Trophy;
  const { progress } = view;
  return (
    <li data-a={view.state} className={[view.state !== "off" ? styles.earned : "", progress?.close ? "close" : ""].filter(Boolean).join(" ") || undefined}>
      {view.state === "new" && <NewChip className="newchip">New</NewChip>}
      <span className="medal">
        {view.state === "new" && <SummonCircle />}
        <Icon className="ic" aria-hidden />
      </span>
      <span className="an">{view.name}</span>
      <span className="ac">{view.criteria}</span>
      {view.unlockedAt ? (
        <span className="ad"><Check className="ic sm" aria-hidden />{formatDay(view.unlockedAt)}</span>
      ) : progress ? (
        <>
          <span className="ad">
            {progress.close && <b>{progress.toGo.toLocaleString()} to go</b>}
            {progress.close ? " · " : ""}{progress.value.toLocaleString()} of {progress.goal.toLocaleString()}
          </span>
          <span
            className="meter"
            style={{ gridColumn: 2 }}
            role="img"
            aria-label={`${Math.floor((progress.value / progress.goal) * 100)} percent`}
          >
            <i style={{ width: `${Math.round((progress.value / progress.goal) * 1000) / 10}%` }} />
          </span>
        </>
      ) : view.isOwnerLocked ? (
        <span className="ad">Not yet</span>
      ) : null}
    </li>
  );
}

export function ProfileAchievements({ playerId, isMe, achievements, careerWinnings }: {
  playerId: number;
  isMe: boolean;
  achievements: Profile["achievements"];
  careerWinnings: number;
}) {
  const [fresh, setFresh] = useState<string[]>([]);
  const unlockedKeys = useMemo(() => achievements.map((a) => a.achievement_key), [achievements]);

  // "New" is decided on this device, on your own profile only. The first visit
  // just records the list, so old unlocks never all light up at once.
  useEffect(() => {
    if (!isMe) return;
    const key = seenKey(playerId);
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      return;
    }
    setFresh(freshUnlocks(stored, unlockedKeys));
    try {
      window.localStorage.setItem(key, JSON.stringify(unlockedKeys));
    } catch {
      // ignore write failures
    }
  }, [isMe, playerId, unlockedKeys]);

  const views = useMemo(
    () => buildAchievements({ unlocked: achievements, careerWinnings, fresh, isOwner: isMe }),
    [achievements, careerWinnings, fresh, isMe],
  );
  const unlocked = views.filter((v) => v.state !== "off").length;
  const newCount = views.filter((v) => v.state === "new").length;

  return (
    <section aria-labelledby="pf-ach">
      <div className="sec-h">
        <h2 className="sec-t" id="pf-ach">Achievements</h2>
        <span className="sec-aux">
          {newCount > 0 && <><b className="new-n">{newCount} new</b> · </>}
          {unlocked} of {views.length} unlocked
        </span>
      </div>
      <ul className="ach">
        {views.map((view) => <Tile key={view.key} view={view} />)}
      </ul>
    </section>
  );
}
