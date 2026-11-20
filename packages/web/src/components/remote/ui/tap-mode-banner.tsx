"use client";

import { useSyncExternalStore } from "react";
import { readTapReason } from "@/lib/remote/tap-offer";
import { useCardDetection } from "@/lib/remote/zone-grid";
import s from "./remote-ui.module.css";

/**
 * My own feed while Auto-detect is off: the board follows no card, so nothing is placed until I tap one.
 * It is a strip under the video box, never over it: a tap on the feed is the only way to read a card.
 * It stays until I turn Auto-detect on, so a long Tap period cannot go unseen.
 * In a tournament the choice on this computer does not say why the mode is on, so no reason shows there.
 */
export function TapModeBanner({ tournament = false }: { tournament?: boolean }) {
  const detection = useCardDetection();
  const stored = useSyncExternalStore(() => () => undefined, readTapReason, () => null);
  if (!detection || detection.autoDetect) return null;
  const reason = tournament ? null : stored === "slow" ? "Switched because this computer looked slow." : stored === "player" ? "You turned it off on this computer." : null;
  const main = "Auto-detect off — cards are read only when you tap";
  return <div className={s.tapBanner} role="status" data-testid="tap-off-banner" title={reason ? `${main}. ${reason}` : main}>
    <span className={s.tapBannerText}><b>{main}</b>{reason ? <span data-testid="tap-off-reason"> {reason}</span> : null}</span>
    <button type="button" className={s.tapBannerBtn} onClick={() => detection.set(true)} data-testid="tap-off-turn-on">Turn on</button>
  </div>;
}

/**
 * Another player's feed, for me or a spectator: their Auto-detect is off, so their board may not follow their mat.
 * While they switch back to auto-detect the board is still catching up, and the chip says that instead.
 */
export function TapModeChip({ name, syncing = false }: { name: string; syncing?: boolean }) {
  return <span className={`${s.ctag} ${s.tapChip}`} title={syncing ? `${name} turned Auto-detect on: their board is catching up.` : `${name} has Auto-detect off: their cards are read only when someone taps them.`} tabIndex={0} data-testid="feed-tap-tag">{syncing ? "Syncing board…" : "Tap mode — auto-detect off"}</span>;
}
