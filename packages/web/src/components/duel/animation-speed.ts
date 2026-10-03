/** Browser-local presentation preference. Never sent to the duel server. */
export const ANIMATION_SPEED_KEY = "yugidraft.duelAnimationSpeed.v1";
export const MIN_ANIMATION_SPEED = 0.5;
export const MAX_ANIMATION_SPEED = 2;
export const ANIMATION_SPEED_STEP = 0.05;

export function normalizeAnimationSpeed(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.round(Math.min(MAX_ANIMATION_SPEED, Math.max(MIN_ANIMATION_SPEED, value)) * 20) / 20;
}

export function loadAnimationSpeed(): number {
  try {
    const raw = window.localStorage.getItem(ANIMATION_SPEED_KEY);
    return raw == null ? 1 : normalizeAnimationSpeed(JSON.parse(raw));
  } catch { return 1; }
}

export function saveAnimationSpeed(value: number): void {
  try { window.localStorage.setItem(ANIMATION_SPEED_KEY, JSON.stringify(normalizeAnimationSpeed(value))); }
  catch { /* The preference still works for this tab when storage is unavailable. */ }
}

// Read before the opening deal's layout effects; the server snapshot stays at 1x for hydration.
let speed = loadAnimationSpeed();
const listeners = new Set<() => void>();
export const getAnimationSpeed = (): number => speed;
export function subscribeAnimationSpeed(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setAnimationSpeed(value: number): void {
  speed = normalizeAnimationSpeed(value);
  saveAnimationSpeed(speed);
  for (const listener of listeners) listener();
}
