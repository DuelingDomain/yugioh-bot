"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { plural } from "@/lib/admin-console/format";
import { listReleases } from "@/lib/updates/admin-client";
import { shortDate } from "@/lib/updates/model";
import type { AdminRelease, AdminReleasesResponse, EmailSendState } from "@/lib/updates/types";
import type { ConsoleActions } from "../admin-console";
import { Icon, Notice, StatusIcon, Tag, type Tone } from "../parts";
import { ReleaseSheet } from "../updates-sheet";
import styles from "../admin-console.module.css";
import own from "../updates-admin.module.css";

type Sheet = { kind: "new" } | { kind: "release"; id: string };

type Load = { state: "loading" } | { state: "failed"; status: number } | { state: "ok"; data: AdminReleasesResponse };

/** The one-line email state of a release, for the list. */
export function emailWord(release: AdminRelease, configured: boolean): { word: string; tone: Tone } {
  if (release.status === "draft") return { word: "Not published", tone: "quiet" };
  const e: EmailSendState = release.email;
  switch (e.state) {
    case "done": return { word: `Sent to ${e.sent.toLocaleString("en-US")}`, tone: "good" };
    case "needs_review": return { word: "Sent, needs a look", tone: "warn" };
    case "queued": case "sending": return { word: `Sending, ${e.sent + e.failed} of ${e.total}`, tone: "info" };
    case "not_configured": return { word: "Email not set up", tone: "quiet" };
    default: return configured ? { word: "Not sent", tone: "quiet" } : { word: "Email not set up", tone: "quiet" };
  }
}

/** Updates: the release notes players read in the Updates chip, and the one email for each release. */
export function UpdatesView({ actions }: { actions: ConsoleActions }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const result = await listReleases();
    if (!alive.current) return;
    if (result.ok) setLoad({ state: "ok", data: result.data });
    else setLoad((prev) => (prev.state === "ok" ? prev : { state: "failed", status: result.status }));
  }, []);
  useEffect(() => {
    alive.current = true;
    void reload();
    return () => { alive.current = false; };
  }, [reload]);

  const open = (next: Sheet, from: HTMLElement | null) => { opener.current = from; setSheet(next); };
  const close = () => {
    setSheet(null);
    const el = opener.current;
    if (el?.isConnected) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  };

  if (load.state === "failed") {
    return (
      <Notice tone="warn" title="Updates did not load">
        {load.status === 403 || load.status === 404 ? "Only an owner can open this view." : "The server did not answer."}{" "}
        <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={() => void reload()}>Try again</button>
      </Notice>
    );
  }
  const data = load.state === "ok" ? load.data : null;
  const releases = data?.releases ?? [];
  const selected = sheet?.kind === "release" ? releases.find((r) => r.id === sheet.id) ?? null : null;

  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.aside}>
          {data ? (data.emailConfigured ? "Email is set up." : "Email is not set up. Nothing can be sent yet.") : "Loading"}
        </span>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.toolbarEnd}`} onClick={(e) => open({ kind: "new" }, e.currentTarget)}>
          <Icon name="plus" />New release
        </button>
      </div>

      {data && !data.emailConfigured ? (
        <Notice tone="info" title="Email is not set up">
          Publishing still works. Add {data.missingConfig.length ? data.missingConfig.join(", ") : "the mail settings"} on the server to send the release email.
        </Notice>
      ) : null}

      {data && releases.length === 0 ? (
        <div className={styles.empty}>
          <StatusIcon tone="info" />
          <span>No releases yet. Make one to show notes to players.</span>
        </div>
      ) : data ? (
        <div className={own.tbl} role="table" aria-label="Releases">
          <div className={`${styles.tblHead} ${own.row}`} role="row">
            <span role="columnheader">Version</span>
            <span role="columnheader">Title</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Email</span>
            <span role="columnheader">Date</span>
            <span />
          </div>
          {releases.map((r) => <Row key={r.id} release={r} configured={data.emailConfigured} selected={selected?.id === r.id} onOpen={(el) => open({ kind: "release", id: r.id }, el)} />)}
        </div>
      ) : null}

      {sheet && data ? (
        <ReleaseSheet
          key={sheet.kind === "new" ? "new" : sheet.id}
          release={selected}
          configured={data.emailConfigured}
          missingConfig={data.missingConfig}
          actions={actions}
          onChanged={reload}
          onCreated={(created) => setSheet({ kind: "release", id: created.id })}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function Row({ release, configured, selected, onOpen }: { release: AdminRelease; configured: boolean; selected: boolean; onOpen: (el: HTMLElement) => void }) {
  const email = emailWord(release, configured);
  const changes = release.highlights.length;
  return (
    <div role="row" tabIndex={0} aria-selected={selected} className={`${styles.tblRow} ${styles.click} ${own.row}`}
      onClick={(e) => onOpen(e.currentTarget)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(e.currentTarget); } }}>
      <div role="cell" className={own.ver}>v{release.version}</div>
      <div role="cell" className={styles.minw}>
        <div className={styles.crNm}>{release.title}</div>
        <div className={own.sub}>{plural(changes, "highlight", "highlights")}{release.major ? " · major update" : ""}</div>
      </div>
      <div role="cell" className={own.status}>
        <Tag tone={release.status === "published" ? "gold" : undefined}>{release.status === "published" ? "Published" : "Draft"}</Tag>
        {release.major ? <Tag>Major</Tag> : null}
      </div>
      <div role="cell" className={own.email} data-tone={email.tone}>{email.word}</div>
      <div role="cell" className={`${styles.num} ${own.date}`}>{release.publishedAt ? shortDate(release.publishedAt) : "-"}</div>
      <div className={styles.chev} role="cell"><Icon name="chev" /></div>
    </div>
  );
}
