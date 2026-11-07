/** How many frames per second this browser sends of the table webcam. 30 is the default; 15 is the lighter choice. Saved per browser. */
export type VideoRate = 15 | 30;
export const VIDEO_RATES: readonly VideoRate[] = [30, 15];
export const DEFAULT_VIDEO_RATE: VideoRate = 30;
const KEY = "dd-remote-video-fps:v1";
/** Blocked storage still holds the choice for this page. */
let choice: VideoRate | null = null;
/** The saved choice, or null while the player has made none (the offer may ask only then). */
export function readVideoChoice(): VideoRate | null {
  if (choice) return choice;
  try { const value = localStorage.getItem(KEY); return value === "15" ? 15 : value === "30" ? 30 : null; } catch { return null; }
}
export const readVideoRate = (): VideoRate => readVideoChoice() ?? DEFAULT_VIDEO_RATE;
export function saveVideoRate(rate: VideoRate) {
  choice = rate;
  try { localStorage.setItem(KEY, String(rate)); } catch { /* Memory-only fallback. */ }
}
/** The "Switch to 15 fps?" offer shows once per page and has its own state, apart from the Tap to identify offer. */
let offered = false;
export const videoOfferShown = () => offered;
export const markVideoOfferShown = () => { offered = true; };
export const VIDEO_OFFER_MS = 20_000;
