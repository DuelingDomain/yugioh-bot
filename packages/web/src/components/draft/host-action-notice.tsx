"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./host-action-notice.module.css";

export type HostAction = "ended" | "cancelled";

// Neutral words: the host or an app owner can stop a draft, and the notice does not say which.
const COPY: Record<HostAction, { title: string; detail: (picks: boolean) => string }> = {
  ended: {
    title: "The draft was ended early",
    detail: (picks) => (picks ? "Everyone keeps their picks. Your pool is on this page." : "Everyone keeps their picks."),
  },
  cancelled: {
    title: "The draft was cancelled",
    detail: () => "No picks were kept.",
  },
};

/**
 * Tells a player that the draft was stopped early. It sits over the page, also over the draft room, which is why it is
 * a portal: the room locks the rest of the page, but a node added later is not locked. It stays until it is closed,
 * so it is still there when the room has handed over to the summary.
 */
export function HostActionNotice({ action, hasPicks, onClose }: { action: HostAction | null; hasPicks: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !action) return null;
  const copy = COPY[action];
  return createPortal(
    <div className={styles.notice} data-action={action} role="status" aria-live="polite">
      <div className={styles.text}>
        <b>{copy.title}</b>
        <span>{copy.detail(hasPicks)}</span>
      </div>
      <div className={styles.acts}>
        {action === "cancelled" ? <Link href="/drafts" className={styles.link}>All drafts</Link> : null}
        <button type="button" className={styles.close} onClick={onClose}>Dismiss</button>
      </div>
    </div>,
    document.body,
  );
}
