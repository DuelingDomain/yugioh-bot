"use client";

import { useRef } from "react";
import Link from "next/link";
import { LightRule, LiveDot, Tip } from "@/components/sheet";
import { DURATION, usePresence } from "@/lib/motion";
import { liveRowModel, type LiveNow } from "./shell-model";
import type { NavSize } from "./nav-item";
import styles from "./shell.module.css";

interface LiveNowRowProps {
  live: LiveNow | null;
  size: NavSize;
  onNavigate?: () => void;
}

/**
 * The "Live now" row under Dashboard, with a light line above and below. Only renders when
 * something is live. Your own duel wins: "Your duel" with the opponent and "Open duel". Otherwise
 * "Live now" with the count, linking to /duels. In the rail it is the dot alone, with a tooltip.
 * It grows open when something goes live and collapses when it ends, so the rows below ease down and
 * back instead of jumping (grid rows and opacity, 300ms). While it collapses it shows what it showed.
 */
export function LiveNowRow({ live, size, onNavigate }: LiveNowRowProps) {
  const model = liveRowModel(live);
  const kept = useRef(model);
  if (model) kept.current = model;
  const { mounted, state } = usePresence(model !== null, DURATION.flip);
  const row = model ?? kept.current;
  if (!mounted || !row) return null;
  const you = row.kind === "you";

  const link =
    size === "rail" ? (
      <Link className={styles.liveTile} href={row.href} aria-label={row.name} onClick={onNavigate}>
        <LiveDot you={you} className={styles.liveDot} />
      </Link>
    ) : (
      <Link className={styles.liveRow} data-size={size} href={row.href} aria-label={row.name} onClick={onNavigate}>
        <LiveDot you={you} className={styles.liveDot} />
        <span className={styles.liveText}>
          <span className={styles.liveTitle}>{row.title}</span>
          <span className={styles.liveSub}>{row.sub}</span>
        </span>
        {row.action ? <span className={styles.liveAction}>{row.action}</span> : null}
      </Link>
    );

  return (
    <div className={styles.liveGrow} data-mo="grow" data-state={state} inert={model === null}>
      <div className={styles.liveClip}>
        <div className={styles.liveWrap} data-kind={row.kind} data-size={size}>
      <LightRule />
      {size === "rail" ? (
        <Tip label={row.tip} side="right" className={styles.railTip}>
          {link}
        </Tip>
      ) : (
        link
      )}
      {/* The rail's next group starts with its own divider, so the tile keeps only the top line. */}
      {size === "rail" ? null : <LightRule />}
        </div>
      </div>
    </div>
  );
}
