"use client";

import { peerVisionLabel, peerVisionTitle, type PeerVision } from "@/lib/remote/peer-vision";
import s from "./remote-ui.module.css";

/**
 * What another player's card reader does, on their feed: "GPU · 82 ms · 24 fps" or "Auto-detect off". The same style as the chip on my own feed.
 * Nothing shows until they send a summary, or while their reader has not started.
 */
export function PeerVisionChip({ stats, name }: { stats: PeerVision | undefined; name: string }) {
  const label = stats ? peerVisionLabel(stats) : null;
  if (!stats || !label) return null;
  return <span className={`${s.backendBadge} ${s.peerBadge} ${stats.backend === "gpu" && stats.detect === "auto" ? s.backendGpu : ""}`} title={peerVisionTitle(stats, name)} tabIndex={0}
    data-testid="peer-vision" data-backend={stats.backend} data-detect={stats.detect}>{label}</span>;
}
