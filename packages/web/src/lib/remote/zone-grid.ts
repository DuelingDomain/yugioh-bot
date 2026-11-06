"use client";

import { useSyncExternalStore } from "react";
import { normalizeZoneSpacing, fieldZoneCells, createFieldCalibration, fieldMatPoint, onMat, zoneCellAt, type FieldCalibration, type FieldDebug, type FieldFormat, type FieldTrack, type PlayerSide, type ZoneOverrides } from "@yugidraft/vision";

type Point = { x: number; y: number };
/** One zone of the Master Rule mat, in mat units (0..1 across and down, seen from the owner's seat). */
export interface GridCell { zone: string; label: string; x: number; y: number; w: number; h: number }

/** Master Rule zones: Field, M1-M5, Banished/GY on top; Extra, S1-S5, Deck below; two EMZ above M2 and M4 when the format has them. */
export {normalizeZoneSpacing};
export type { ZoneOverrides };
/**
 * The one zone geometry for the overlay, the lobby view, the calibration editor and the zone assignment (which reads
 * the same cells in `@yugidraft/vision`). Pass a calibration to include its spacing and per-zone rectangles.
 */
export function fieldGridCells(format: FieldFormat = "normal", spacing: number | Pick<FieldCalibration, "zoneSpacing" | "zones"> = 1, zones?: ZoneOverrides): GridCell[] {
  return typeof spacing === "number" ? fieldZoneCells(format, spacing, zones) : fieldZoneCells(format, spacing.zoneSpacing, zones ?? spacing.zones);
}
/** Draw order for overlapping cells: largest first, so the cell on top is the one a card in the overlap is assigned to. */
export const byAreaDesc = <T extends { w: number; h: number }>(cells: readonly T[]): T[] => [...cells].sort((a, b) => b.w * b.h - a.w * a.h);
/** The grid shown before the player calibrates: most of the picture, as in the calibration dialog's first guess. */
export const DEFAULT_GRID_CORNERS: Point[] = [{ x: .08, y: .08 }, { x: .92, y: .08 }, { x: .92, y: .92 }, { x: .08, y: .92 }];
let defaultGrid: FieldCalibration | undefined;
export const defaultGridCalibration = () => defaultGrid ??= createFieldCalibration(DEFAULT_GRID_CORNERS);
/** Legacy records have no saved flag: they count as placed when the corners left the first guess. */
export const isPlacedCalibration = (calibration?: FieldCalibration) => !!calibration?.orientation
  && calibration.corners.some((corner, i) => Math.abs(corner.x - DEFAULT_GRID_CORNERS[i].x) > .002 || Math.abs(corner.y - DEFAULT_GRID_CORNERS[i].y) > .002);
/** Webcams usually face the player across the table (flipped); a phone is held from the player's own side. */
export const defaultSideFor = (kind: "webcam" | "phone"): PlayerSide => kind === "phone" ? "bottom" : "top";
const guessed = new Map<PlayerSide, FieldCalibration>(); const guessedFrom = new WeakMap<FieldCalibration, Map<PlayerSide, FieldCalibration>>();
/**
 * What a feed draws and the controls show. A saved calibration with a side is used as is; without one, the grid
 * is drawn on the likely side only as a guess. The watcher still waits until the player confirms it.
 */
export function displayCalibration(calibration: FieldCalibration | undefined, defaultSide: PlayerSide = "bottom"): FieldCalibration {
  if (calibration?.orientation) return calibration;
  const cache = calibration ? guessedFrom.get(calibration) ?? guessedFrom.set(calibration, new Map()).get(calibration)! : guessed;
  let value = cache.get(defaultSide);
  if (!value) { value = createFieldCalibration(calibration?.corners ?? DEFAULT_GRID_CORNERS, { playerSide: defaultSide, mirrored: false }); cache.set(defaultSide, value); }
  return value;
}

/** Cell corners and centre in normalized picture coordinates, through the calibration's homography. */
export function projectCell(cell: GridCell, calibration: FieldCalibration) {
  const at = (x: number, y: number) => fieldMatPoint({ x, y }, calibration);
  return { corners: [at(cell.x, cell.y), at(cell.x + cell.w, cell.y), at(cell.x + cell.w, cell.y + cell.h), at(cell.x, cell.y + cell.h)], center: at(cell.x + cell.w / 2, cell.y + cell.h / 2) };
}

/**
 * The two zones a card lies across, or null when it sits in one zone.
 * A 5 by 5 sample inside the card outline is mapped onto the mat; a second zone holding a quarter or more of the samples counts.
 */
export function straddledZones(quad: readonly Point[], calibration: FieldCalibration, cells: readonly GridCell[]): [string, string] | null {
  if (quad.length !== 4) return null;
  const counts = new Map<string, number>(); let inside = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const u = .1 + .2 * i, v = .1 + .2 * j;
    const top = { x: quad[0].x + (quad[1].x - quad[0].x) * u, y: quad[0].y + (quad[1].y - quad[0].y) * u };
    const bottom = { x: quad[3].x + (quad[2].x - quad[3].x) * u, y: quad[3].y + (quad[2].y - quad[3].y) * u };
    const mat = onMat({ x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v }, calibration);
    const cell = zoneCellAt(mat, cells);
    if (!cell) continue; inside++; counts.set(cell.zone, (counts.get(cell.zone) ?? 0) + 1);
  }
  if (inside < 12) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if(ranked.length>1&&/^[MS][1-5]$/.test(ranked[0][0])&&ranked[0][0][0]===ranked[1][0][0])return null;
  return ranked.length > 1 && ranked[1][1] >= inside * .25 ? [ranked[0][0], ranked[1][0]] : null;
}

/** What the field watcher shares with the camera feeds: the saved calibration and the cards it sees. */
export interface ZoneGridState {
  ownSeat: number | null; format: FieldFormat; calibration?: FieldCalibration;
  /** The own zones were placed on the mat (the shared "calibrated" rule), not only a side saved. */
  placed?: boolean;
  /** Side to guess for the own feed until the player confirms one. */
  defaultSide?: PlayerSide;
  tracks: readonly { id: string; zone: string; quad: readonly Point[] }[];
  /** Opens the calibration dialog. Missing when the watcher is not running. */
  calibrate?: () => void;
  setCalibration?: (value:FieldCalibration) => void;
}
const empty: ZoneGridState = { ownSeat: null, format: "normal", tracks: [] };
let current = empty;
export const currentZoneGrid = () => current;
/** Own Deck/Extra piles the camera sees off the mat (dimmed on the board). Local only. */
let missingPiles: { seat: number | null; zones: readonly string[] } = { seat: null, zones: [] };
const missingListeners = new Set<() => void>();
export function publishMissingPiles(seat: number, zones: readonly string[]) {
  if (missingPiles.seat === seat && missingPiles.zones.join() === zones.join()) return;
  missingPiles = { seat, zones: [...zones] }; for (const listener of missingListeners) listener();
}
export function useMissingPiles(seat: number): readonly string[] {
  const value = useSyncExternalStore(listener => { missingListeners.add(listener); return () => { missingListeners.delete(listener); }; }, () => missingPiles, () => missingPiles);
  return value.seat === seat ? value.zones : [];
}
/** "Scan field" beside the virtual board: the field watcher re-syncs the board at once. Local only. `ready` is false while the camera is off. */
export interface FieldScanState { seat: number | null; scanning: boolean; enabled: boolean; ready: boolean; scan?: () => void }
let fieldScan: FieldScanState = { seat: null, scanning: false, enabled: false, ready: false };
const scanListeners = new Set<() => void>();
export function publishFieldScan(next: FieldScanState) {
  if (fieldScan.seat === next.seat && fieldScan.scanning === next.scanning && fieldScan.enabled === next.enabled && fieldScan.ready === next.ready && fieldScan.scan === next.scan) return;
  fieldScan = next; for (const listener of scanListeners) listener();
}
/** Starts a field scan for my seat when the camera is on and auto-detect is watching; the S key calls it. Returns false when it did nothing. */
export function runFieldScan(): boolean {
  if (!fieldScan.enabled || !fieldScan.ready || fieldScan.scanning || !fieldScan.scan) return false;
  fieldScan.scan(); return true;
}
/** The scan state of my seat while auto-detect is on; null for any other seat. */
export function useFieldScan(seat: number): FieldScanState | null {
  const value = useSyncExternalStore(listener => { scanListeners.add(listener); return () => { scanListeners.delete(listener); }; }, () => fieldScan, () => fieldScan);
  return value.seat === seat && value.enabled && value.scan ? value : null;
}
const listeners = new Set<() => void>();
export function publishZoneGrid(next: ZoneGridState) { current = next; for (const listener of listeners) listener(); }
export const clearZoneGrid = () => publishZoneGrid(empty);
export function useZoneGrid(): ZoneGridState {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current, () => empty);
}

/** "Show zone grid": on by default for the player's own feed, off for opponents, remembered per device. */
const prefKey = (own: boolean) => `dd-zone-grid:${own ? "own" : "opponent"}`;
export function readGridPref(own: boolean): boolean {
  try { const value = localStorage.getItem(prefKey(own)); return value === null ? own : value === "1"; } catch { return own; }
}
export function writeGridPref(own: boolean, on: boolean) { try { localStorage.setItem(prefKey(own), on ? "1" : "0"); } catch { /* storage may be blocked */ } }

/** Owner debug overlay: what the field watcher saw on its last scan. Own feed only, never sent to other seats. */
export interface FieldDebugView { /** Track id → text, for a track whose board card shows the other face. */ faces?: Readonly<Record<string, string>>; /** Frame sharpness vs its baseline and whether removals hold for blur. */ blur?: { ratio: number; hold: boolean }; /** Shadow over the mat and whether removals hold for it. */ shadow?: { share: number; hold: boolean }; debug?: FieldDebug; tracks: readonly FieldTrack[]; status: string; detectorMs: number; dutyPercent: number; intervalMs: number; writeError?: string; backend?: string }
/** Debug tools are for developers only: the server says so (`room.isDeveloper`); the saved switch alone never turns them on. */
let debugPref = false, developer = false, debugOn = false, debugView: FieldDebugView | null = null;
const debugListeners = new Set<() => void>();
const debugNotify = () => { for (const listener of debugListeners) listener(); };
try { debugPref = typeof localStorage !== "undefined" && localStorage.getItem("dd-field-debug") === "1"; } catch { /* storage may be blocked */ }
export const fieldDebugEnabled = () => debugOn;
export function setFieldDeveloper(on: boolean) { if (developer === on) return; developer = on; debugOn = developer && debugPref; if (!debugOn) debugView = null; debugNotify(); }
export const useFieldDeveloper = () => useSyncExternalStore(subscribeDebug, () => developer, () => false);
export function setFieldDebugEnabled(on: boolean) { debugPref = on; debugOn = developer && on; if (!debugOn) debugView = null; try { localStorage.setItem("dd-field-debug", on ? "1" : "0"); } catch { /* storage may be blocked */ } debugNotify(); }
export function publishFieldDebug(next: FieldDebugView | null) { if (!debugOn && next) return; debugView = next; debugNotify(); }
const subscribeDebug = (listener: () => void) => { debugListeners.add(listener); return () => { debugListeners.delete(listener); }; };
export const useFieldDebugEnabled = () => useSyncExternalStore(subscribeDebug, () => debugOn, () => false);
export const useFieldDebug = () => useSyncExternalStore(subscribeDebug, () => debugView, () => null);
