import { Coins, Trophy } from "lucide-react";
import { HistoryRail, HistoryRow, HistoryTurn } from "@/components/sheet";
import { formatDay, groupAwards, type AwardEntry } from "./profile-model";
import styles from "./profile.module.css";

/** The duel-log style list of the last winnings earned, grouped by event. */
export function ProfileWinnings({ recent }: { recent: AwardEntry[] }) {
  if (recent.length === 0) {
    return (
      <section aria-labelledby="pf-win-empty">
        <div className={`empty ${styles.empty}`}>
          <Coins className="ic" aria-hidden />
          <h2 id="pf-win-empty">No winnings yet</h2>
          <p>Win a match or place in a tournament to earn some. Losses never cost winnings.</p>
        </div>
      </section>
    );
  }
  return (
    <HistoryRail title="Winnings earned" headingLevel={2} aside="The last 10, every season. Losses never take winnings away.">
      {groupAwards(recent).map((group, g) => (
        <GroupRows key={`${group.key}-${g}`} title={group.title} entries={group.entries} />
      ))}
    </HistoryRail>
  );
}

function GroupRows({ title, entries }: { title: string; entries: AwardEntry[] }) {
  return (
    <>
      <HistoryTurn>{title}</HistoryTurn>
      {entries.map((entry, i) => {
        const placing = entry.kind === "placement";
        return (
          <HistoryRow
            key={i}
            own={placing ? "me" : "none"}
            score={placing ? <Trophy className="ic sm" aria-hidden /> : "W"}
            meta={<><span className="up">+{entry.points}</span><small>{formatDay(entry.created_at)}</small></>}
          >
            {placing ? "Placing" : "Match win"}
            {placing && <small>placing award</small>}
          </HistoryRow>
        );
      })}
    </>
  );
}
