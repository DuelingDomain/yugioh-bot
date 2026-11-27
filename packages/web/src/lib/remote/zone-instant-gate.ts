import type { ZoneTier } from '@yugidraft/vision';
import { visionPaceFactor } from './send-health-store';

/**
 * Instant zone read (own seat, Auto-detect only): the machine gate. On by default for machines with 4 or more cores.
 * Phones and smaller devices use the light tier. Kill switches: NEXT_PUBLIC_REMOTE_ZONE_INSTANT=0 (build) or localStorage dd-zone-instant=0 (one browser).
 */
export const ZONE_INSTANT_STORAGE_KEY = 'dd-zone-instant';
let storageOff = false, storageReadAt = -Infinity;
/** The localStorage switch is read at most twice a second: the watcher asks for it on every camera frame. */
export const zoneInstantEnabled = () => {
  if (process.env.NEXT_PUBLIC_REMOTE_ZONE_INSTANT === '0') return false;
  const at = Date.now();
  if (at - storageReadAt > 500) {
    storageReadAt = at;
    try { storageOff = typeof localStorage !== 'undefined' && localStorage.getItem(ZONE_INSTANT_STORAGE_KEY) === '0'; } catch { storageOff = false; }
  }
  return !storageOff;
};
/** Stands down while the sent video is CPU limited (the encoder needs the cores): the same signal that slows the field passes. */
export const zoneInstantRunning = () => zoneInstantEnabled() && visionPaceFactor() === 1;

export interface ZoneInstantMachine { cores?: number; memoryGb?: number; userAgent?: string; touch?: boolean }
const machine = (): ZoneInstantMachine => typeof navigator === 'undefined' ? {} : {
  cores: navigator.hardwareConcurrency,
  memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  userAgent: navigator.userAgent,
  touch: navigator.maxTouchPoints > 1,
};
/** True for the full desktop rate. The light tier uses a lower duty budget. */
export function zoneInstantCapable(m: ZoneInstantMachine = machine()) {
  if ((m.cores ?? 0) < 4) return false;
  if (m.memoryGb !== undefined && m.memoryGb < 4) return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(m.userAgent ?? '')) return false;
  if (m.touch && /Macintosh/.test(m.userAgent ?? '')) return false; // iPadOS reports a Mac
  return true;
}

const LIGHT_READ_DUTY = .15;
const LOW_BATTERY_LEVEL = .20;
type BatteryStatus = { readonly charging: boolean; readonly level: number };
let battery: BatteryStatus | undefined;
let batteryRequested = false;

function startBatteryCheck() {
  if (batteryRequested || typeof navigator === 'undefined') return;
  batteryRequested = true;
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryStatus> };
  void nav.getBattery?.().then(value => { battery = value; }).catch(() => {});
}

const lightZoneInstantRunning = () =>
  zoneInstantRunning() && (!battery || battery.charging || battery.level > LOW_BATTERY_LEVEL);

/** The watcher option, or undefined when the path is off. `pick` is `pickZoneTier` from the vision package. */
export function zoneInstantOption(pick: (probe: { cores: number; gpu: boolean; embedMs: number; watchUs: number }) => ZoneTier, backend: 'webgpu' | 'wasm' | null | undefined, readMs: number | null | undefined, m: ZoneInstantMachine = machine()) {
  if (!zoneInstantEnabled()) return undefined;
  if (!zoneInstantCapable(m)) {
    startBatteryCheck();
    return {
      tier: { name: 'cpu4' as const, idleIntervalMs: 100, settleMs: 160, budget: .02, preRead: false, maxPreReads: 0 },
      enabled: lightZoneInstantRunning, maxPerSecond: 1, maxReadDuty: LIGHT_READ_DUTY,
    };
  }
  const tier = pick({ cores: m.cores ?? 4, gpu: backend === 'webgpu', embedMs: readMs && readMs > 0 ? readMs : 60, watchUs: 0 });
  return { tier, enabled: zoneInstantRunning, maxPerSecond: 4 };
}
