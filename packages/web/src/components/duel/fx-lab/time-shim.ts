import { duelFxClock } from "../fx-clock";

/**
 * Review adapter for the same scoped clock used by the room. The continuous clock rebasing from
 * the original lab shim now lives in fx-clock.ts; no browser APIs or server countdowns are patched.
 * Speed changes are requested for the next presentation. The lab starts a fresh timeline after
 * remounting all layers, so old animations cannot be retimed halfway through.
 */
export type TimeShim = {
  setFactor(factor: number): void;
  factor(): number;
  resetTimeline(): void;
  realSetTimeout: (handler: () => void, ms: number) => number;
  realClearTimeout: (id: number) => void;
  uninstall(): void;
};

const KEY = "__fxLabTimeShim";
type Patched = Window & typeof globalThis & { [KEY]?: TimeShim };

export function installTimeShim(): TimeShim {
  const w = window as Patched;
  w[KEY]?.uninstall();
  const shim: TimeShim = {
    setFactor: (factor) => duelFxClock.setReviewSpeed(factor),
    factor: () => duelFxClock.factor(),
    resetTimeline: () => duelFxClock.resetReviewTimeline(),
    realSetTimeout: (handler, ms) => window.setTimeout(handler, ms),
    realClearTimeout: (id) => window.clearTimeout(id),
    uninstall() {
      duelFxClock.setReviewSpeed(null);
      if (w[KEY] === shim) delete w[KEY];
    },
  };
  w[KEY] = shim;
  return shim;
}
