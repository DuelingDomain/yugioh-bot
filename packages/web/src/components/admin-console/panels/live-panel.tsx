"use client";

import { FloorList, FloorRow, LiveDot } from "@/components/sheet";
import { ago } from "@/lib/admin-console/format";
import type { LiveDraft, LiveDuel } from "@/lib/admin-console/types";
import { EmptyNote, SectionPanel } from "../section-panel";
import styles from "./live-panel.module.css";

const ROW_COLS = "minmax(0,1.3fr) minmax(0,1.1fr) minmax(0,1.6fr) 150px 56px";
const ROW_PHONE_COLS = "minmax(0,1fr) auto";
const ROW_PHONE_AREAS = '"nm tm" "kind kind" "pl pl"';

function playersText(players: string[]) {
  return players.length > 0 ? players.join(", ") : "No players yet";
}

function DuelRow({ duel, now }: { duel: LiveDuel; now: number }) {
  const running = duel.status === "active";
  const kind = [duel.formatLabel, running ? (duel.ranked ? "Ranked" : "Casual") : "Lobby", duel.genesys ? "Genesys" : null].filter(Boolean).join(" · ");
  const since = running ? `Started ${ago(duel.startedAt, now)}` : `Opened ${ago(duel.createdAt, now)}`;
  return (
    <FloorRow href={duel.watchHref} cols={ROW_COLS} phoneCols={ROW_PHONE_COLS} phoneAreas={ROW_PHONE_AREAS} aria-label={`${running ? "Watch" : "Open"} ${duel.name}`}>
      <span className={running ? styles.name : styles.nameIdle}>{running ? <LiveDot className="" /> : null} {duel.name}</span>
      <span className={styles.kind}>{kind}</span>
      <span className={styles.players}>{playersText(duel.players)}</span>
      <span className={styles.time}>{since}</span>
      <span className={styles.go}>{running ? "Watch" : "Open"}</span>
    </FloorRow>
  );
}

function DraftRow({ draft, now }: { draft: LiveDraft; now: number }) {
  const running = draft.status === "active";
  const since = running ? `Started ${ago(draft.startedAt, now)}` : `Opened ${ago(draft.createdAt, now)}`;
  return (
    <FloorRow href={draft.href} cols={ROW_COLS} phoneCols={ROW_PHONE_COLS} phoneAreas={ROW_PHONE_AREAS} aria-label={`Open ${draft.name}`}>
      <span className={running ? styles.name : styles.nameIdle}>{running ? <LiveDot className="" /> : null} {draft.name}</span>
      <span className={styles.kind}>{running ? (draft.progress ?? "Running") : "Lobby"}</span>
      <span className={styles.players}>{playersText(draft.players)}</span>
      <span className={styles.time}>{since}</span>
      <span className={styles.go}>Open</span>
    </FloorRow>
  );
}

export function LivePanel() {
  return (
    <SectionPanel id="live">
      {(data) => {
        const now = Date.now();
        const playing = data.duels.filter((duel) => duel.status === "active").length;
        const waiting = data.duels.length - playing;
        return (
          <>
            <div className={styles.group}>
              <div className={styles.top}>
                <span className={styles.big}>{playing}</span>
                <h3 className={styles.heading}>Duels playing now{waiting > 0 ? `, ${waiting} waiting in a lobby` : ""}</h3>
              </div>
              {playing === 0 ? <EmptyNote>No live duels right now.</EmptyNote> : null}
              {data.duels.length > 0 ? (
                <FloorList aria-label="Duels">
                  {data.duels.map((duel) => <DuelRow key={duel.slug} duel={duel} now={now} />)}
                </FloorList>
              ) : null}
            </div>
            <div className={styles.group}>
              <div className={styles.top}>
                <span className={styles.big}>{data.drafts.length}</span>
                <h3 className={styles.heading}>Drafts open</h3>
              </div>
              {data.drafts.length === 0 ? <EmptyNote>No live drafts right now.</EmptyNote> : (
                <FloorList aria-label="Drafts">
                  {data.drafts.map((draft) => <DraftRow key={draft.slug} draft={draft} now={now} />)}
                </FloorList>
              )}
            </div>
          </>
        );
      }}
    </SectionPanel>
  );
}
