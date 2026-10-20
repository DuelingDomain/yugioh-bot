"use client";

import { count } from "@/lib/admin-console/format";
import { STAT_KEYS, type StatKey, type StatsData } from "@/lib/admin-console/types";
import { Sparkline } from "../sparkline";
import { SectionPanel } from "../section-panel";
import styles from "./stats-panel.module.css";

const LABEL: Record<StatKey, string> = {
  signups: "Sign-ups", activeUsers: "Active users", duelsStarted: "Duels started",
  duelsFinished: "Duels finished", draftsStarted: "Drafts started", draftsCompleted: "Drafts completed",
};

function Card({ stats, id }: { stats: StatsData; id: StatKey }) {
  const values = stats.series[id];
  return (
    <li className={styles.card}>
      <span className={styles.label}>{LABEL[id]}</span>
      <span className={styles.figure}>{count(stats.today[id])}</span>
      <span className={styles.week}>
        <Sparkline values={values} width={120} height={28} label={`${LABEL[id]} per day, ${stats.days[0]} to ${stats.days[stats.days.length - 1]} UTC: ${values.join(", ")}`} />
        <span className={styles.total}>{count(stats.last7Days[id])} in 7 days</span>
      </span>
    </li>
  );
}

export function StatsPanel() {
  return (
    <SectionPanel id="stats">
      {(data) => (
        <>
          <p className={styles.note}>Big numbers are today so far (UTC). The line is the last 7 days, today last.</p>
          <ul className={styles.grid} aria-label="Stats for today and the last 7 days, UTC">
            {STAT_KEYS.map((id) => <Card key={id} stats={data} id={id} />)}
          </ul>
          <p className={styles.note}>
            Active users: people who played a duel or draft that day, or who were last seen online that day.
            Only the latest visit is stored, so earlier days show returning visitors only through play.
          </p>
        </>
      )}
    </SectionPanel>
  );
}
