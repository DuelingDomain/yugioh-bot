"use client";

import { useRef, useState } from "react";
import { plural } from "@/lib/admin-console/format";
import { formatDayMonth } from "@/lib/admin-console/time";
import type { CreatorSummary } from "@/lib/admin-console/creators-types";
import type { ConsoleActions } from "../admin-console";
import { AddCreatorSheet, CreatorSheet } from "../creators-sheet";
import { okData, type Snapshots } from "../model";
import { Icon, Notice, StatusIcon } from "../parts";
import styles from "../admin-console.module.css";

type Sheet = { kind: "add" } | { kind: "creator"; id: number };

const day = (ms: number | null) => (ms === null ? "-" : formatDayMonth(ms));

function host(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

/** Creators: who brings people in past the waitlist, with their links, invites and sign-ups. */
export function CreatorsView({ s, actions }: { s: Snapshots; actions: ConsoleActions }) {
  const result = s.creators.result;
  const data = okData(s.creators);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // The row or button that opened the sheet gets focus back when it closes.
  const opener = useRef<HTMLElement | null>(null);

  const open = (next: Sheet, from: HTMLElement | null) => { opener.current = from; setSheet(next); };
  const close = () => {
    setSheet(null);
    const el = opener.current;
    if (el?.isConnected) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  };

  if (result && result.state !== "ok") {
    return <Notice tone={result.state === "error" ? "warn" : "info"} title={result.state === "error" ? "Creators did not load" : "Creators are not set up"}>{result.message}</Notice>;
  }
  const creators = data?.creators ?? [];
  const selected = sheet?.kind === "creator" ? creators.find((c) => c.id === sheet.id) ?? null : null;

  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.aside}>
          {data ? `${plural(data.sendBudgetLeft, "invite send", "invite sends")} left this hour` : s.creators.failure ? "Could not load. Retrying." : "Loading"}
        </span>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.toolbarEnd}`} onClick={(e) => open({ kind: "add" }, e.currentTarget)}>
          <Icon name="plus" />Add creator
        </button>
      </div>

      {creators.length === 0 ? (
        <div className={styles.empty}>
          <StatusIcon tone="info" />
          <span>{data ? "No creators yet. Add one to make invite links for their community." : "Loading"}</span>
        </div>
      ) : (
        <div className={styles.crTbl} role="table" aria-label="Creators">
          <div className={styles.tblHead} role="row">
            <span role="columnheader">Creator</span>
            <span role="columnheader">Open links</span>
            <span role="columnheader">Invites sent</span>
            <span role="columnheader">Signed up</span>
            <span role="columnheader">Active, 7 d</span>
            <span role="columnheader">Last sign-up</span>
            <span />
          </div>
          {creators.map((c) => <Row key={c.id} c={c} selected={selected?.id === c.id} onOpen={(el) => open({ kind: "creator", id: c.id }, el)} />)}
        </div>
      )}

      {sheet?.kind === "add" ? (
        <AddCreatorSheet actions={actions} onClose={close} onCreated={(creator) => setSheet({ kind: "creator", id: creator.id })} />
      ) : sheet?.kind === "creator" ? (
        <CreatorSheet key={sheet.id} id={sheet.id} summary={selected} budgetLeft={data?.sendBudgetLeft ?? null} actions={actions} onClose={close} />
      ) : null}
    </>
  );
}

function Row({ c, selected, onOpen }: { c: CreatorSummary; selected: boolean; onOpen: (el: HTMLElement) => void }) {
  const site = host(c.channelUrl);
  return (
    <div role="row" tabIndex={0} aria-selected={selected} className={`${styles.tblRow} ${styles.click}`}
      onClick={(e) => onOpen(e.currentTarget)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(e.currentTarget); } }}>
      <div className={styles.minw} role="cell">
        <div className={styles.crNm}>{c.name}</div>
        {site ? <div className={styles.hd}>{site}</div> : null}
        <div className={`${styles.mOnly} ${styles.crStats}`}>
          {plural(c.openLinks, "open link", "open links")} · {c.sent} sent · {c.signedUp} signed up · {c.active7d} active
        </div>
      </div>
      <div className={`${styles.num} ${styles.crN}`} role="cell"><b>{c.openLinks}</b></div>
      <div className={`${styles.num} ${styles.crN}`} role="cell"><b>{c.sent}</b></div>
      <div className={`${styles.num} ${styles.crN}`} role="cell"><b>{c.signedUp}</b></div>
      <div className={`${styles.num} ${styles.crN}`} role="cell"><b>{c.active7d}</b></div>
      <div className={`${styles.num} ${styles.crLast}`} role="cell">{day(c.lastSignUpAt)}</div>
      <div className={styles.chev} role="cell"><Icon name="chev" /></div>
    </div>
  );
}
