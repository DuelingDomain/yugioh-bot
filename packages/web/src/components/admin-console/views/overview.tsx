"use client";

import { plural } from "@/lib/admin-console/format";
import type { ConsoleActions } from "../admin-console";
import { LineChart } from "../charts";
import { alertsFor, delta, liveCounts, okData, shortDay, weekAverage, type Snapshots } from "../model";
import { Avatar, Icon, SectionHead, Since, StatusIcon, Tag, WatchLink, useNow } from "../parts";
import styles from "../admin-console.module.css";

const ONLINE_SHOWN = 12;
const LIVE_SHOWN = 6;

function Delta({ value, suffix }: { value: ReturnType<typeof delta>; suffix: string }) {
  return <span className={styles.delta}><b data-dir={value.dir}>{value.text}</b> {suffix}</span>;
}

export function OverviewView({ s, actions }: { s: Snapshots; actions: ConsoleActions }) {
  const now = useNow();
  const online = okData(s.online);
  const liveData = okData(s.live);
  const live = liveCounts(liveData);
  const stats = okData(s.stats);
  const alerts = alertsFor(s, now);
  const inDuel = online?.users.filter((u) => u.current?.kind === "duel").length ?? 0;
  const drafting = online?.users.filter((u) => u.current?.kind === "draft").length ?? 0;
  const dash = "–";
  const days = stats?.days.map(shortDay) ?? [];

  return (
    <>
      <div className={styles.hero}>
        <div className={styles.stat}>
          <div className={styles.statLabel}><span className={styles.pulse} />Online now</div>
          <div className={styles.statNum}>{online ? online.count : dash}</div>
          <div className={styles.statFoot}><span className={styles.delta}>{online ? `${inDuel} in a duel · ${drafting} drafting` : "Loading"}</span></div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Live now</div>
          <div className={styles.statNum}>{liveData ? live.duels.length : dash}<small>{live.duels.length === 1 ? "duel" : "duels"}</small></div>
          <div className={styles.statFoot}>
            <span className={styles.delta}>{liveData ? `+ ${plural(live.drafts.length, "draft", "drafts")} · ${plural(live.lobbies, "lobby", "lobbies")} open` : "Loading"}</span>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Duels today</div>
          <div className={styles.statNum}>{stats ? stats.today.duelsStarted : dash}</div>
          <div className={styles.statFoot}>
            {stats ? <Delta value={delta(stats.today.duelsStarted, weekAverage(stats, "duelsStarted"), true)} suffix="vs 7-day avg" /> : <span />}
            {stats ? <LineChart className={styles.spark} labels={days} series={[{ name: "Duels started", color: "var(--t2)", values: stats.series.duelsStarted }]} label="Duels started per day, last 7 days" /> : null}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Sign-ups, 7 days</div>
          <div className={styles.statNum}>{stats ? stats.last7Days.signups : dash}</div>
          <div className={styles.statFoot}>
            {stats?.previous7Days ? <Delta value={delta(stats.last7Days.signups, stats.previous7Days.signups)} suffix="vs last week" /> : <span />}
            {stats ? <LineChart className={styles.spark} labels={days} series={[{ name: "Sign-ups", color: "var(--t2)", values: stats.series.signups }]} label="Sign-ups per day, last 7 days" /> : null}
          </div>
        </div>
      </div>

      <SectionHead title="Needs attention" n={alerts.length} />
      <div className={styles.alerts}>
        {alerts.length === 0 ? (
          <div className={styles.alert}><StatusIcon tone="good" /><div><div className={styles.alertTitle}>Nothing needs a look right now</div><div className={styles.alertDetail}>New errors, service problems, disk space and waitlist requests show here.</div></div></div>
        ) : alerts.map((a) => (
          <div key={a.key} className={styles.alert}>
            <StatusIcon tone={a.tone} />
            <div className={styles.minw}><div className={styles.alertTitle}>{a.title}</div><div className={styles.alertDetail}>{a.detail}</div></div>
            <span className={styles.alertTime}>{a.at ? <Since at={a.at} suffix=" ago" /> : null}</span>
            {a.action.view ? <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={() => actions.go(a.action.view!)}>{a.action.label}</button> : null}
          </div>
        ))}
      </div>

      <div className={styles.now}>
        <div>
          <SectionHead title="Online" n={online?.count ?? 0} aside={<button type="button" className={styles.link} onClick={() => actions.go("people")}>All people <Icon name="chev" /></button>} />
          {online && online.users.length > 0 ? (
            <div className={styles.onlineGrid}>
              {online.users.slice(0, ONLINE_SHOWN).map((u) => (
                <button key={u.userId} type="button" className={styles.uChip} onClick={() => actions.openPerson(u.userId)}>
                  <Avatar name={u.name} url={u.avatarUrl} online />
                  <span className={styles.minw}><span className={styles.uName}>{u.name}</span><span className={styles.uSec}>{u.label}</span></span>
                  <span className={styles.uTime}><Since at={u.onlineSince ?? u.lastSeenAt} /></span>
                </button>
              ))}
            </div>
          ) : <div className={`${styles.empty} ${styles.emptySm}`}>{online ? "Nobody is online right now." : "Loading"}</div>}
          {online && online.users.length > ONLINE_SHOWN ? <p className={styles.aside} style={{ marginTop: 12 }}>and {online.users.length - ONLINE_SHOWN} more</p> : null}
        </div>
        <div>
          <SectionHead title="Live" n={`${plural(live.duels.length, "duel", "duels")} · ${plural(live.drafts.length, "draft", "drafts")}`}
            aside={<button type="button" className={styles.link} onClick={() => actions.go("duels")}>All tables <Icon name="chev" /></button>} />
          {live.duels.length + live.drafts.length === 0 ? (
            <div className={`${styles.empty} ${styles.emptySm}`}>{liveData ? "No duel or draft is running." : "Loading"}</div>
          ) : null}
          {live.duels.slice(0, LIVE_SHOWN).map((d) => (
            <div key={d.slug} className={styles.liveRow}>
              <div className={styles.fmt}>{d.formatLabel.replace(" duel", "")}<Tag tone={d.ranked ? "gold" : undefined}>{d.ranked ? "Ranked" : "Casual"}</Tag></div>
              <div className={styles.liveMeta}>
                <div className={styles.names}>{d.players.join(d.players.length === 2 ? " vs " : ", ")}</div>
                {d.turn != null ? `Turn ${d.turn}` : "Starting"}{d.genesys ? " · Genesys" : ""}
              </div>
              <div className={styles.when}><Since at={d.startedAt} /></div>
              <WatchLink href={d.watchHref} />
            </div>
          ))}
          {live.drafts.slice(0, Math.max(0, LIVE_SHOWN - live.duels.length) || 1).map((d) => (
            <div key={d.slug} className={styles.liveRow}>
              <div className={styles.fmt}>Draft<Tag>{d.modeLabel ?? "Draft"}</Tag></div>
              <div className={styles.liveMeta}>
                <div className={styles.names}>{d.name} · {d.players.join(", ")}</div>
                {d.progress ?? "Lobby"}
              </div>
              <div className={styles.when}><Since at={d.startedAt ?? d.createdAt} /></div>
              <WatchLink href={d.href} label="Open" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
