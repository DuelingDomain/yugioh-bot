"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "dd-remote-mic:v1";

/** The microphone this person picked last. Storage can be blocked (private mode), so every access is guarded. */
export function readSavedMic(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export function saveMic(deviceId: string) {
  try { if (deviceId) localStorage.setItem(KEY, deviceId); else localStorage.removeItem(KEY); } catch { /* not remembered */ }
}

/**
 * The microphones this computer has, and the one in use. An empty id is the system default.
 * Labels are empty until the browser has given mic permission; the list refreshes when a device is plugged in or out.
 */
export function useMicChoice() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const refresh = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter(device => device.kind === "audioinput" && device.deviceId !== "communications"));
    } catch { setDevices([]); }
  }, []);
  useEffect(() => {
    setMicId(readSavedMic());
    if (!navigator.mediaDevices?.enumerateDevices) return;
    void refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
  }, [refresh]);
  const pickMic = useCallback((id: string) => { setMicId(id); saveMic(id); }, []);
  // A saved microphone that is no longer plugged in falls back to the default.
  const current = micId && (devices.length === 0 || devices.some(device => device.deviceId === micId)) ? micId : "";
  return { devices, micId: current, pickMic };
}
