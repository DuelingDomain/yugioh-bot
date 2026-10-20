"use client";

import { useState } from "react";
import { maskEmail } from "@/lib/admin-console/format";
import type { WaitlistEntry } from "@/lib/admin-console/types";
import type { ConsoleActions } from "../admin-console";
import { okData, type Snapshots } from "../model";
import { Avatar, Icon, Notice, SectionHead, Since, StatusIcon } from "../parts";
import { refreshSection } from "../use-admin-section";
import styles from "../admin-console.module.css";

const SHOWN = 50;
type Action = "approve" | "reject";
type RowState = { kind: "confirm" | "pending" | "failed"; action: Action };

async function send(id: string, action: Action): Promise<boolean> {
  try {
    const res = await fetch(`/api/admin/console/waitlist/${encodeURIComponent(id)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
    });
    return res.ok;
  } catch { return false; }
}

const DECISION_WORD = { invited: "Invited", rejected: "Rejected", completed: "Signed up" } as const;

export function WaitlistView({ s, actions }: { s: Snapshots; actions: ConsoleActions }) {
  const [reveal, setReveal] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const result = s.waitlist.result;
  const data = okData(s.waitlist);
  const busy = Object.values(rows).some((r) => r.kind === "pending");
  const set = (id: string, state: RowState | null) =>
    setRows((prev) => { const next = { ...prev }; if (state) next[id] = state; else delete next[id]; return next; });
  const shown = (email: string) => (reveal ? email : maskEmail(email));

  async function run(entry: WaitlistEntry, action: Action) {
    set(entry.id, { kind: "pending", action });
    if (await send(entry.id, action)) {
      set(entry.id, null);
      actions.toast(action === "approve" ? `${maskEmail(entry.email)} is approved. Invite sent.` : `${maskEmail(entry.email)} is rejected.`);
      refreshSection("waitlist");
    } else {
      set(entry.id, { kind: "failed", action });
    }
  }

  if (result && result.state !== "ok") {
    return <Notice tone={result.state === "error" ? "warn" : "info"} title={result.state === "error" ? "The waitlist did not load" : "The waitlist is not set up"}>{result.message}</Notice>;
  }
  const entries = data?.entries.slice(0, SHOWN) ?? [];

  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.aside}>{data ? `${data.pending} pending in Clerk` : "Loading"}</span>
        {entries.length > 0 ? (
          <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.toolbarEnd}`} aria-pressed={reveal} onClick={() => setReveal((v) => !v)}>
            <Icon name="eye" />{reveal ? "Hide emails" : "Show emails"}
          </button>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <div className={styles.empty}><StatusIcon tone="good" />{data ? "Nobody is waiting. New requests show here and in the left menu." : "Loading"}</div>
      ) : (
        <ul aria-label="Pending waitlist" style={{ listStyle: "none" }}>
          {entries.map((entry) => {
            const state = rows[entry.id];
            const label = shown(entry.email);
            const asking = state?.kind === "confirm" || state?.kind === "pending";
            const pending = state?.kind === "pending";
            return (
              <li key={entry.id} className={styles.wlRow}>
                <Avatar name={entry.email.split("@")[0] ?? "?"} size="lg" />
                <div className={styles.minw}>
                  <div className={styles.wlName} title={reveal ? entry.email : undefined}>{label}</div>
                  <div className={styles.wlMail}>Asked to join {entry.createdAt ? <Since at={entry.createdAt} suffix=" ago" /> : "at an unknown time"}</div>
                </div>
                <div className={`${styles.cAgo} ${styles.num}`}>{entry.createdAt ? new Date(entry.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</div>
                <div className={`${styles.cAct} ${styles.wlAct}`}>
                  {asking ? (
                    <>
                      <span className={styles.wlAsk} role="status">{pending ? (state.action === "approve" ? "Approving" : "Rejecting") : `${state.action === "approve" ? "Approve" : "Reject"} ${label}?`}</span>
                      <button type="button" className={styles.btn} disabled={pending} onClick={() => set(entry.id, null)} autoFocus>Cancel</button>
                      <button type="button" className={`${styles.btn} ${state.action === "approve" ? styles.btnPrimary : styles.btnDanger}`} disabled={pending || busy}
                        onClick={() => void run(entry, state.action)}>{state.action === "approve" ? "Approve" : "Reject"}</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={styles.btn} disabled={busy} onClick={() => set(entry.id, { kind: "confirm", action: "reject" })} aria-label={`Reject ${label}`}><Icon name="x" />Reject</button>
                      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => set(entry.id, { kind: "confirm", action: "approve" })} aria-label={`Approve ${label}`}><Icon name="check" />Approve</button>
                    </>
                  )}
                  {state?.kind === "failed" ? <p className={styles.wlFail} role="alert">Could not {state.action} this person. Try again.</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data && data.pending > entries.length ? <p className={styles.aside} style={{ marginTop: 14 }}>and {data.pending - entries.length} more, oldest not shown</p> : null}

      {data?.decided ? (
        <>
          <SectionHead title="Recent decisions" n={data.decided.length} />
          {data.decided.length === 0 ? <div className={`${styles.empty} ${styles.emptySm}`}>No decisions yet.</div> : data.decided.map((d) => (
            <div key={d.id} className={styles.decRow}>
              <StatusIcon tone={d.status === "rejected" ? "crit" : "good"} />
              <span className={styles.minw}><b>{shown(d.email)}</b> · {DECISION_WORD[d.status]}</span>
              <span className={styles.num}>{d.at ? <Since at={d.at} suffix=" ago" /> : ""}</span>
            </div>
          ))}
        </>
      ) : null}
    </>
  );
}
