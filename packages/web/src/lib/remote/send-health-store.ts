"use client";

import { useSyncExternalStore } from "react";

/**
 * What the camera sender tells the rest of the page. One small store, so the video controller (writer) never needs the React hub:
 * the card reader reads `slowFactor`, the own-camera hint and the Debug view read the rest.
 */
export type SendHealth = {
  /** Measured capture frames per second of my webcam (WebRTC media-source), when known. */
  captureFps?: number;
  /** The camera has delivered fewer than 20 frames per second for a while: the player may add light. */
  slowCamera: boolean;
  /** Card vision runs at a lower rate because the browser video encoder is CPU limited. Shown in Debug only. */
  visionSlowed: boolean;
};

/** How much longer the card reader waits between camera samples while the video encoder is CPU limited. */
export const VISION_SLOW_FACTOR = 3;

const IDLE: SendHealth = { slowCamera: false, visionSlowed: false };
let state = IDLE;
const listeners = new Set<() => void>();

export const getSendHealth = () => state;
/** The multiplier for the card reader's pace: 1 normally, `VISION_SLOW_FACTOR` while the encoder is CPU limited. */
export const visionPaceFactor = () => state.visionSlowed ? VISION_SLOW_FACTOR : 1;
export function setSendHealth(patch: Partial<SendHealth>) {
  const next = { ...state, ...patch };
  if ((Object.keys(next) as (keyof SendHealth)[]).every(key => next[key] === state[key])) return;
  state = next;
  for (const listener of listeners) listener();
}
export function resetSendHealth() { setSendHealth({ captureFps: undefined, slowCamera: false, visionSlowed: false }); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useSendHealth(): SendHealth { return useSyncExternalStore(subscribe, getSendHealth, () => IDLE); }
