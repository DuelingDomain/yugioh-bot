"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { NewChip, SectionHead, Zone } from "@/components/sheet";
import {
  buildAchievements,
  formatDay,
  freshUnlocks,
  seenKey,
  type AchievementView,
  type Profile,
} from "./profile-model";
import styles from "./profile.module.css";

function Tile({ view }: { view: AchievementView }) {
  const { progress } = view;
  const pct = progress ? Math.round((progress.value / progress.goal) * 1000) / 10 : 0;
  return (
    <li data-a={view.state} className={styles.tile}>
      <span className={styles.tileCard}>
        {/* Won is a gold card, anything not yet earned is an outline. The words beside it carry the meaning. */}
        <Zone state={view.state === "off" ? "dashed" : "won"} />
      </span>
      <span className={styles.tileText}>
        <span className={styles.an}>
          {view.name}
          {view.state === "new" && <NewChip className="newchip">New</NewChip>}
        </span>
        <span className={styles.ac}>{view.criteria}</span>
        {view.unlockedAt ? (
          <span className={styles.ad}><Check className={styles.checkIc} aria-hidden />{formatDay(view.unlockedAt)}</span>
        ) : progress ? (
          <span className={styles.progressLine}>
            <span className={styles.ad}>
              {progress.close && <b className={styles.toGo}>{progress.toGo.toLocaleString()} to go, </b>}
              {progress.value.toLocaleString()} of {progress.goal.toLocaleString()}
            </span>
            <span className={styles.bar} role="img" aria-label={`${Math.floor((progress.value / progress.goal) * 100)} percent`}>
              <i style={{ transform: `scaleX(${pct / 100})` }} />
            </span>
          </span>
        ) : (
          <span className={view.isOwnerLocked ? styles.ad : `${styles.ad} ${styles.mobileOnly}`}>Not yet</span>
        )}
      </span>
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
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
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
    <section className={styles.achievements} aria-labelledby="pf-ach" data-expanded={expanded}>
      <SectionHead
        id="pf-ach"
        title="Achievements"
        note={
          <>
            {newCount > 0 && <span className={styles.newN}>{newCount} new</span>}
            <span>{unlocked} of {views.length} unlocked</span>
          </>
        }
      />
      <ul className={styles.tiles} id={listId}>
        {views.map((view) => <Tile key={view.key} view={view} />)}
      </ul>
      {views.length > 3 && (
        <button
          type="button"
          className={styles.expandLink}
          aria-controls={listId}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show fewer" : `Show all ${views.length}`}
        </button>
      )}
    </section>
  );
}
