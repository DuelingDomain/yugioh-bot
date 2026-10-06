"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Plus, Trash2 } from "lucide-react";
import { FloorList, FloorRow, SectionHead, StatusLine, SvButton } from "@/components/sheet";
import { PageFrame } from "@/components/decks/page-frame";
import { createScenario, getScenario } from "@/components/sandbox/api";
import { copyName, FORMAT_LABELS, MODE_LABELS, playHref, shareUrl, updatedDay } from "../_lib/labels";
import type { ScenarioListItem } from "../_lib/load";
import styles from "./sandbox.module.css";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function SandboxList({ items: initial }: { items: ScenarioListItem[] }) {
  const router = useRouter();
  const [items, setItems] = React.useState(initial);
  const [confirmId, setConfirmId] = React.useState<number | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<{ id: number; url: string; ok: boolean } | null>(null);

  const mine = items.filter((item) => item.mine);
  const others = items.filter((item) => !item.mine);

  async function remove(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/sandbox/scenarios/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not delete this scenario.");
      }
      setItems((cur) => cur.filter((item) => item.id !== id));
      setConfirmId(null);
    } catch (e) {
      setError(messageOf(e, "Could not delete this scenario."));
    } finally {
      setBusyId(null);
    }
  }

  async function saveAsCopy(item: ScenarioListItem) {
    setBusyId(item.id);
    setError(null);
    try {
      const full = await getScenario(item.id);
      const copy = await createScenario({ name: copyName(item.name), board: full.board, run: full.run });
      router.push(`/sandbox/${copy.id}`);
    } catch (e) {
      setError(messageOf(e, "Could not save a copy."));
      setBusyId(null);
    }
  }

  async function copyLink(item: ScenarioListItem) {
    const url = shareUrl(window.location.origin, item.id);
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      ok = false;
    }
    setCopied({ id: item.id, url, ok });
  }

  function row(item: ScenarioListItem) {
    const busy = busyId === item.id;
    const facts = (
      <p className={styles.facts}>
        <span><b>{FORMAT_LABELS[item.format]}</b></span>
        <span>{MODE_LABELS[item.mode]}</span>
        {item.mine ? null : <span>by {item.ownerName}</span>}
        <span>Updated {updatedDay(item.updatedAt)}</span>
      </p>
    );
    return (
      <FloorRow key={item.id} className={styles.row}>
        <div className={styles.main}>
          <p className={styles.name}><Link href={`/sandbox/${item.id}`}>{item.name}</Link></p>
          {facts}
        </div>
        {confirmId === item.id ? (
          <div className={styles.confirm} role="alertdialog" aria-label={`Delete ${item.name}`}>
            <span>Delete {item.name}? Its share link stops working.</span>
            <span className={styles.confirmActs}>
              <SvButton variant="danger" disabled={busy} onClick={() => void remove(item.id)}>Delete</SvButton>
              <SvButton variant="ghost" disabled={busy} onClick={() => setConfirmId(null)}>Keep</SvButton>
            </span>
          </div>
        ) : (
          <div className={styles.acts}>
            <SvButton as="a" href={playHref(item.id)} variant="primary" aria-label={`Play ${item.name}`}>Play</SvButton>
            <SvButton as="a" href={`/sandbox/${item.id}`} variant="ghost" aria-label={`Open ${item.name}`}>Open</SvButton>
            {item.mine ? null : (
              <SvButton variant="ghost" disabled={busy} onClick={() => void saveAsCopy(item)} aria-label={`Save ${item.name} as copy`}>
                {busy ? "Saving…" : "Save as copy"}
              </SvButton>
            )}
            <button type="button" className={styles.iconBtn} aria-label={`Copy link to ${item.name}`} title="Copy share link" onClick={() => void copyLink(item)}>
              <Link2 size={18} aria-hidden="true" />
            </button>
            {item.mine ? (
              <button type="button" className={`${styles.iconBtn} ${styles.danger}`} aria-label={`Delete ${item.name}`} disabled={busy} onClick={() => setConfirmId(item.id)}>
                <Trash2 size={18} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        )}
      </FloorRow>
    );
  }

  return (
    <PageFrame
      title="Sandbox"
      sub={items.length > 0 ? `${items.length} ${items.length === 1 ? "scenario" : "scenarios"}` : undefined}
      actions={
        <SvButton as="a" href="/sandbox/new" variant="primary">
          <Plus size={16} aria-hidden="true" />
          New scenario
        </SvButton>
      }
    >
      <p className={styles.lede}>
        Set up any board, then play it at once against bots. Only you can change or delete your scenarios. Other admins can play them or save a copy.
      </p>

      {error ? <div role="alert"><StatusLine tone="block">{error}</StatusLine></div> : null}
      {copied ? (
        <div role="status" className={styles.notice}>
          <StatusLine tone={copied.ok ? "ready" : "warn"}>{copied.ok ? "Link copied. Any admin who opens it starts the duel at once." : "Could not copy. Copy the link below."}</StatusLine>
          {copied.ok ? null : <span className={styles.noticeLink}>{copied.url}</span>}
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="sbx-mine">
        <SectionHead id="sbx-mine" title="Your scenarios" note={mine.length > 0 ? String(mine.length) : undefined} />
        {mine.length === 0 ? (
          <div className={styles.empty}>
            <h2>No saved scenarios yet</h2>
            <p>Add the cards you want to try, press Start, and the duel opens. Save a board when you want it back later.</p>
            <SvButton as="a" href="/sandbox/new" variant="primary">New scenario</SvButton>
          </div>
        ) : (
          <FloorList aria-labelledby="sbx-mine">{mine.map(row)}</FloorList>
        )}
      </section>

      {others.length > 0 ? (
        <section className={styles.section} aria-labelledby="sbx-others">
          <SectionHead id="sbx-others" title="Other admins" note={String(others.length)} />
          <FloorList aria-labelledby="sbx-others">{others.map(row)}</FloorList>
        </section>
      ) : null}
    </PageFrame>
  );
}
