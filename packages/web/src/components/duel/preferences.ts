"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type DuelMotionPreference = "system" | "full" | "reduced";

/** How hard heavy summons shake the field. "off" keeps the slam without movement. */
export type DuelShakePreference = "off" | "low" | "medium" | "high";

export const DUEL_SHAKE_LEVELS: readonly DuelShakePreference[] = ["off", "low", "medium", "high"];

export const DUEL_SHAKE_LABEL: Readonly<Record<DuelShakePreference, string>> = { off: "Off", low: "Low", medium: "Medium", high: "High" };

export type DuelPreferences = {
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  /** Master volume for duel sound, 0..1. */
  soundVolume: number;
  setSoundVolume: (volume: number) => void;
  motion: DuelMotionPreference;
  setMotion: (value: DuelMotionPreference) => void;
  reducedMotion: boolean;
  shake: DuelShakePreference;
  setShake: (value: DuelShakePreference) => void;
};

export const DEFAULT_SOUND_VOLUME = 0.7;

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
  /** Added after v1 shipped; missing means the default. */
  volume?: number;
};

function isShake(value: unknown): value is DuelShakePreference {
  return value === "off" || value === "low" || value === "medium" || value === "high";
}

/** Clamp to 0..1; anything that is not a finite number is dropped. */
export function normalizeVolume(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

function isMotion(value: unknown): value is DuelMotionPreference {
  return value === "system" || value === "full" || value === "reduced";
}

export function loadPrefs(): StoredPrefs | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const rec = parsed as Record<string, unknown>;
    if (rec.v !== STORAGE_VERSION) return null;
    if (typeof rec.soundEnabled !== "boolean" || !isMotion(rec.motion)) return null;
    return { v: STORAGE_VERSION, soundEnabled: rec.soundEnabled, motion: rec.motion, shake: isShake(rec.shake) ? rec.shake : undefined, volume: normalizeVolume(rec.volume) };
  } catch {
    return null;
  }
}

export function savePrefs(soundEnabled: boolean, motion: DuelMotionPreference, shake: DuelShakePreference, volume: number = DEFAULT_SOUND_VOLUME): void {
  try {
    const payload: StoredPrefs = { v: STORAGE_VERSION, soundEnabled, motion, shake, volume };
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
  const [soundVolume, setSoundVolumeState] = useState(DEFAULT_SOUND_VOLUME);
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
      if (stored.volume != null) setSoundVolumeState(stored.volume);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    savePrefs(soundEnabled, motion, shake, soundVolume);
  }, [loaded, motion, shake, soundEnabled, soundVolume]);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(Boolean(enabled));
  }, []);

  const setSoundVolume = useCallback((volume: number) => {
    const next = normalizeVolume(volume);
    if (next != null) setSoundVolumeState(next);
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

  return { soundEnabled, setSoundEnabled, soundVolume, setSoundVolume, motion, setMotion, reducedMotion, shake, setShake };
}
