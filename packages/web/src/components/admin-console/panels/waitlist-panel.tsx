"use client";

import { useState } from "react";
import { FloorList, FloorRow, StatusLine, SvButton } from "@/components/sheet";
import { ago } from "@/lib/admin-console/format";
import type { WaitlistData, WaitlistEntry } from "@/lib/admin-console/types";
import { EmptyNote, SectionPanel } from "../section-panel";
import { refreshSection } from "../use-admin-section";
import styles from "./waitlist-panel.module.css";

const SHOWN = 25;
type Action = "approve" | "reject";
type RowState = { kind: "confirm" | "pending"; action: Action } | { kind: "failed"; action: Action };

/** "ann@example.com" -> "a**@example.com". */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}${"*".repeat(Math.min(at - 1, 6))}${email.slice(at)}`;
}

async function send(id: string, action: Action): Promise<boolean> {
  try {
    const res = await fetch(`/api/admin/console/waitlist/${encodeURIComponent(id)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
    });
    return res.ok;
  } catch { return false; }
}

function WaitlistBody({ data }: { data: WaitlistData }) {
  const [reveal, setReveal] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const now = Date.now();
  const shown = data.entries.slice(0, SHOWN);
  const busy = Object.values(rows).some((r) => r.kind === "pending");

  const set = (id: string, state: RowState | null) =>
    setRows((prev) => { const next = { ...prev }; if (state) next[id] = state; else delete next[id]; return next; });

  async function run(entry: WaitlistEntry, action: Action) {
    set(entry.id, { kind: "pending", action });
    setNotice(null);
    if (await send(entry.id, action)) {
      set(entry.id, null);
      setNotice(`${action === "approve" ? "Approved" : "Rejected"} ${maskEmail(entry.email)}.`);
      refreshSection("waitlist");
    } else {
      set(entry.id, { kind: "failed", action });
    }
  }

  return (
    <>
      <div className={styles.top}>
        <p className={styles.count}><span className={styles.big}>{data.pending}</span><span className={styles.muted}>waiting</span></p>
        {data.entries.length > 0 ? (
          <SvButton variant="quiet" aria-pressed={reveal} onClick={() => setReveal((v) => !v)}>{reveal ? "Hide emails" : "Show emails"}</SvButton>
        ) : null}
      </div>
      {notice ? <StatusLine tone="ready">{notice}</StatusLine> : null}
      {shown.length === 0 ? <EmptyNote>Nobody is waiting.</EmptyNote> : (
        <FloorList aria-label="Pending waitlist">
          {shown.map((entry) => {
            const state = rows[entry.id];
            const label = reveal ? entry.email : maskEmail(entry.email);
            const pending = state?.kind === "pending";
            return (
              <FloorRow key={entry.id}>
              <div className={styles.line}>
                <span className={styles.email} title={reveal ? entry.email : undefined}>{label}</span>
                <span className={styles.when}>{ago(entry.createdAt, now)}</span>
                <div className={styles.actions}>
                  {state?.kind === "confirm" || pending ? (
                    <>
                      <span className={styles.ask} role="status">
                        {pending ? (state.action === "approve" ? "Approving" : "Rejecting") : `${state.action === "approve" ? "Approve" : "Reject"} ${label}?`}
                      </span>
                      <SvButton variant="quiet" disabled={pending} onClick={() => set(entry.id, null)} autoFocus>Cancel</SvButton>
                      <SvButton variant={state.action === "approve" ? "primary" : "danger"} disabled={pending || busy}
                        onClick={() => void run(entry, state.action)}>{state.action === "approve" ? "Approve" : "Reject"}</SvButton>
                    </>
                  ) : (
                    <>
                      <SvButton variant="primary" disabled={busy} onClick={() => set(entry.id, { kind: "confirm", action: "approve" })} aria-label={`Approve ${label}`}>Approve</SvButton>
                      <SvButton variant="ghost" disabled={busy} onClick={() => set(entry.id, { kind: "confirm", action: "reject" })} aria-label={`Reject ${label}`}>Reject</SvButton>
                    </>
                  )}
                  {state?.kind === "failed" ? <p className={styles.fail} role="alert">Could not {state.action} this person. Try again.</p> : null}
                </div>
              </div>
              </FloorRow>
            );
          })}
        </FloorList>
      )}
      {data.pending > shown.length ? <p className={styles.more}>and {data.pending - shown.length} more, oldest not shown</p> : null}
    </>
  );
}

export function WaitlistPanel() {
  return <SectionPanel id="waitlist">{(data) => <WaitlistBody data={data} />}</SectionPanel>;
}
