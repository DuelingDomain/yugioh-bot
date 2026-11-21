import type { ZoneTier } from '@yugidraft/vision';

/**
 * Instant zone read (own seat, Auto-detect only): the machine gate. On by default for machines with 4 or more cores.
 * Phones and low-memory devices get it off. Kill switches: NEXT_PUBLIC_REMOTE_ZONE_INSTANT=0 (build) or localStorage dd-zone-instant=0 (one browser).
 */
export const ZONE_INSTANT_STORAGE_KEY = 'dd-zone-instant';
export const zoneInstantEnabled = () => {
  if (process.env.NEXT_PUBLIC_REMOTE_ZONE_INSTANT === '0') return false;
  try { return !(typeof localStorage !== 'undefined' && localStorage.getItem(ZONE_INSTANT_STORAGE_KEY) === '0'); } catch { return true; }
};

export interface ZoneInstantMachine { cores?: number; memoryGb?: number; userAgent?: string; touch?: boolean }
const machine = (): ZoneInstantMachine => typeof navigator === 'undefined' ? {} : {
  cores: navigator.hardwareConcurrency,
  memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  userAgent: navigator.userAgent,
  touch: navigator.maxTouchPoints > 1,
};
/** True when this machine may run the instant path. Unknown values do not block (a desktop browser without deviceMemory is fine). */
export function zoneInstantCapable(m: ZoneInstantMachine = machine()) {
  if ((m.cores ?? 0) < 4) return false;
  if (m.memoryGb !== undefined && m.memoryGb < 4) return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(m.userAgent ?? '')) return false;
  if (m.touch && /Macintosh/.test(m.userAgent ?? '')) return false; // iPadOS reports a Mac
  return true;
}

/** The watcher option, or undefined when the path is off. `pick` is `pickZoneTier` from the vision package. */
export function zoneInstantOption(pick: (probe: { cores: number; gpu: boolean; embedMs: number; watchUs: number }) => ZoneTier, backend: 'webgpu' | 'wasm' | null | undefined, readMs: number | null | undefined, m: ZoneInstantMachine = machine()) {
  if (!zoneInstantEnabled() || !zoneInstantCapable(m)) return undefined;
  const tier = pick({ cores: m.cores ?? 4, gpu: backend === 'webgpu', embedMs: readMs && readMs > 0 ? readMs : 60, watchUs: 0 });
  return { tier, enabled: zoneInstantEnabled, maxPerSecond: 4 };
}
