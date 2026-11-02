const KEY = "dd-remote-camera:v1";

/** The camera this person picked last. Storage can be blocked (private mode), so every access is guarded. */
export function readSavedCamera(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export function saveCamera(deviceId: string) {
  try { if (deviceId) localStorage.setItem(KEY, deviceId); else localStorage.removeItem(KEY); } catch { /* not remembered */ }
}

/** The saved camera, only while it is still plugged in. A gone id would make the camera request fail instead of falling back. */
export async function savedCameraIfPresent(): Promise<string | undefined> {
  const id = readSavedCamera();
  if (!id) return undefined;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(device => device.kind === "videoinput" && device.deviceId === id) ? id : undefined;
  } catch { return undefined; }
}
