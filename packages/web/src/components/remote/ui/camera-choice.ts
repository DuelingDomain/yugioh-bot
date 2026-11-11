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

/** The field camera everywhere: prefer 16:9, 1080p, 30 fps. Unsupported sizes remain optional. */
export const FIELD_CAMERA = { width: 1920, height: 1080, aspectRatio: 16 / 9, frameRate: 30 } as const;
/** The same asks as `getUserMedia` video constraints. */
export const FIELD_CAMERA_CONSTRAINTS = {
  width: { ideal: FIELD_CAMERA.width }, height: { ideal: FIELD_CAMERA.height },
  aspectRatio: { ideal: FIELD_CAMERA.aspectRatio }, frameRate: { ideal: FIELD_CAMERA.frameRate },
} as const;

/**
 * The lobby leaves a mark when its webcam preview worked, so the table can turn the camera on by itself after Start.
 * The mark lives in the tab only and the table clears it when it reads it.
 */
const readyKey = (slug: string) => `dd-remote-cam-ready:${slug}`;
export function markCameraReady(slug: string, ready: boolean) {
  try { if (ready) sessionStorage.setItem(readyKey(slug), "1"); else sessionStorage.removeItem(readyKey(slug)); } catch { /* storage may be blocked */ }
}
export function takeCameraReady(slug: string): boolean {
  try { const ready = sessionStorage.getItem(readyKey(slug)) === "1"; if (ready) sessionStorage.removeItem(readyKey(slug)); return ready; } catch { return false; }
}

/**
 * Whether this tab had the table camera on. A reload clears the lobby mark above, so the table writes this one while the camera runs
 * and only the Camera off button clears it. A reload then turns the camera on again when the browser still allows it.
 */
const wantedKey = (slug: string) => `dd-remote-cam-want:${slug}`;
export function rememberCameraWanted(slug: string, on: boolean) {
  try { if (on) sessionStorage.setItem(wantedKey(slug), "1"); else sessionStorage.removeItem(wantedKey(slug)); } catch { /* storage may be blocked */ }
}
export function cameraWanted(slug: string): boolean {
  try { return sessionStorage.getItem(wantedKey(slug)) === "1"; } catch { return false; }
}
/** True only when the browser already allows the camera, so a restore never opens a permission prompt. */
export async function cameraPermissionGranted(): Promise<boolean> {
  try { return (await navigator.permissions.query({ name: "camera" as PermissionName })).state === "granted"; } catch { return false; }
}
