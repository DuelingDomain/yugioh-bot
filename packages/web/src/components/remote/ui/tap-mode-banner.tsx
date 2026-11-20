"use client";

import { useSyncExternalStore } from "react";
import { readTapReason } from "@/lib/remote/tap-offer";
import { useCardDetection } from "@/lib/remote/zone-grid";
import s from "./remote-ui.module.css";

/**
 * My own feed while Auto-detect is off: the board follows no card, so nothing is placed until I tap one.
 * It stays on the feed until I turn Auto-detect on, so a long Tap period cannot go unseen.
 */
export function TapModeBanner() {
  const detection = useCardDetection();
  const reason = useSyncExternalStore(() => () => undefined, readTapReason, () => null);
  if (!detection || detection.autoDetect) return null;
  return <div className={s.tapBanner} role="status" data-testid="tap-off-banner">
    <span className={s.tapBannerText}>
      <b>Auto-detect off — cards are read only when you tap</b>
      {reason ? <span>{reason === "slow" ? "Switched because this computer looked slow." : "You turned it off on this computer."}</span> : null}
    </span>
    <button type="button" className={s.tapBannerBtn} onClick={() => detection.set(true)} data-testid="tap-off-turn-on">Turn on</button>
  </div>;
}

/** Another player's feed, for me or a spectator: their Auto-detect is off, so their board may not follow their mat. */
export function TapModeChip({ name }: { name: string }) {
  return <span className={`${s.ctag} ${s.tapChip}`} title={`${name} has Auto-detect off: their cards are read only when someone taps them.`} tabIndex={0} data-testid="feed-tap-tag">Tap mode — auto-detect off</span>;
}
