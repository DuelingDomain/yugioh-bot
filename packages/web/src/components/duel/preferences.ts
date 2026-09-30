"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type DuelMotionPreference = "system" | "full" | "reduced";

/** How hard heavy summons shake the field. "off" keeps the slam without movement. */
export type DuelShakePreference = "off" | "low" | "medium" | "high";

export const DUEL_SHAKE_LEVELS: readonly DuelShakePreference[] = ["off", "low", "medium", "high"];

export type DuelPreferences = {
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  motion: DuelMotionPreference;
  setMotion: (value: DuelMotionPreference) => void;
  reducedMotion: boolean;
  shake: DuelShakePreference;
  setShake: (value: DuelShakePreference) => void;
};

const STORAGE_KEY = "yugidraft.duelPreferences.v1";
const STORAGE_VERSION = 1;

const DEFAULT_SOUND = false;
const DEFAULT_MOTION: DuelMotionPreference = "system";
const DEFAULT_SHAKE: DuelShakePreference = "medium";

type StoredPrefs = {
  v: number;
  soundEnabled: boolean;
  motion: DuelMotionPreference;
  /** Added after v1 shipped; missing means the default. */
  shake?: DuelShakePreference;
};

function isShake(value: unknown): value is DuelShakePreference {
  return value === "off" || value === "low" || value === "medium" || value === "high";
}

function isMotion(value: unknown): value is DuelMotionPreference {
  return value === "system" || value === "full" || value === "reduced";
}

function loadPrefs(): StoredPrefs | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const rec = parsed as Record<string, unknown>;
    if (rec.v !== STORAGE_VERSION) return null;
    if (typeof rec.soundEnabled !== "boolean" || !isMotion(rec.motion)) return null;
    return { v: STORAGE_VERSION, soundEnabled: rec.soundEnabled, motion: rec.motion, shake: isShake(rec.shake) ? rec.shake : undefined };
  } catch {
    return null;
  }
}

function savePrefs(soundEnabled: boolean, motion: DuelMotionPreference, shake: DuelShakePreference): void {
  try {
    const payload: StoredPrefs = { v: STORAGE_VERSION, soundEnabled, motion, shake };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // private mode / quota
  }
}

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

export function useDuelPreferences(): DuelPreferences {
  const [soundEnabled, setSoundEnabledState] = useState(DEFAULT_SOUND);
  const [motion, setMotionState] = useState<DuelMotionPreference>(DEFAULT_MOTION);
  const [shake, setShakeState] = useState<DuelShakePreference>(DEFAULT_SHAKE);
  const [loaded, setLoaded] = useState(false);
  const systemReduced = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  useEffect(() => {
    const stored = loadPrefs();
    if (stored) {
      setSoundEnabledState(stored.soundEnabled);
      setMotionState(stored.motion);
      if (stored.shake) setShakeState(stored.shake);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    savePrefs(soundEnabled, motion, shake);
  }, [loaded, motion, shake, soundEnabled]);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(Boolean(enabled));
  }, []);

  const setMotion = useCallback((value: DuelMotionPreference) => {
    if (!isMotion(value)) return;
    setMotionState(value);
  }, []);

  const setShake = useCallback((value: DuelShakePreference) => {
    if (!isShake(value)) return;
    setShakeState(value);
  }, []);

  const reducedMotion = motion === "reduced" || (motion === "system" && systemReduced);

  return { soundEnabled, setSoundEnabled, motion, setMotion, reducedMotion, shake, setShake };
}
