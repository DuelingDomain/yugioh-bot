"use client";

import { FloorList, FloorRow, LiveDot } from "@/components/sheet";
import { ago } from "@/lib/admin-console/format";
import { EmptyNote, SectionPanel } from "../section-panel";
import styles from "../admin-console.module.css";

const SHOWN = 12;

export function OnlinePanel() {
  return (
    <SectionPanel id="online">
      {(data) => {
        const now = Date.now();
        const rows = data.users.slice(0, SHOWN);
        return (
          <>
            <div className={styles.onlineTop}>
              <span className={styles.big}>{data.count}</span>
              {data.bySection.length > 0 ? (
                <ul className={styles.chips} aria-label="People by section">
                  {data.bySection.map((s) => <li key={s.label}>{s.label} <b>{s.count}</b></li>)}
                </ul>
              ) : null}
            </div>
            {rows.length === 0 ? <EmptyNote>Nobody is online.</EmptyNote> : (
              <FloorList aria-label="People online">
                {rows.map((u) => (
                  <FloorRow key={u.userId} cols="minmax(0,1fr) minmax(0,1fr) 84px" phoneCols="minmax(0,1fr) auto" phoneAreas={'"nm seen" "sec sec"'}>
                    <span className={styles.rowName}><LiveDot className="" /> {u.name}</span>
                    <span className={styles.rowSection}>{u.label}</span>
                    <span className={styles.rowSeen}>{ago(u.lastSeenAt, now)}</span>
                  </FloorRow>
                ))}
              </FloorList>
            )}
            {data.users.length > SHOWN ? <p className={styles.muted}>and {data.users.length - SHOWN} more</p> : null}
          </>
        );
      }}
    </SectionPanel>
  );
}
