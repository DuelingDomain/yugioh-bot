import { fieldZoneAt, fieldZoneBounds, isLikelyFaceDown, onMat, type FieldCalibration, type FieldFormat } from "@yugidraft/vision";
import { currentZoneGrid, tapToIdentifyNow } from "./zone-grid";

/**
 * Tap to identify: what this browser saw at each spot of a camera, so a click on a card that is now face down can still name it.
 * This memory stays in this browser. Nothing here goes to the server, to the data channel or to the board.
 */
/** `x` and `y` are 0..1 in the frame. `r` is in frame heights, so it means the same across and down. `off` = outside the calibrated mat. */
export type TapSpot = { x: number; y: number; r: number; cell?: string; off?: boolean };
export type TapEntry = TapSpot & { cardId: number; name: string; at: number };
type SeatMemory = { calibration?: string; camera?: string; entries: TapEntry[] };
type TableMemory = Record<string, SeatMemory>;
type Point = { x: number; y: number };

const MAX_ENTRIES = 40;
/** About half of a card's width, in frame heights, for a read with no outline. */
const DEFAULT_RADIUS = .1;
/** A pile always shows a back or its top card: a name kept there would be wrong. */
const PILE_CELLS = new Set(["DECK", "EXTRA"]);
const storageKey = (slug: string) => `dd-remote-tap-memory:v2:${slug}`;
/** Holds the memory for this page when storage is blocked. */
const pageMemory = new Map<string, TableMemory>();

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isEntry = (value: unknown): value is TapEntry => {
  const entry = value as Partial<TapEntry> | null;
  return !!entry && typeof entry === "object" && finite(entry.x) && finite(entry.y) && finite(entry.r) && finite(entry.cardId) && finite(entry.at) && typeof entry.name === "string" && (entry.cell === undefined || typeof entry.cell === "string");
};
/** Stored text can be anything: only well formed seats and entries are kept. */
function parseMemory(raw: string | null): TableMemory {
  const value = JSON.parse(raw ?? "{}") as unknown, table: TableMemory = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return table;
  for (const [seat, stored] of Object.entries(value)) {
    const memory = stored as Partial<SeatMemory> | null;
    if (!memory || typeof memory !== "object" || !Array.isArray(memory.entries)) continue;
    table[seat] = { entries: memory.entries.filter(isEntry).slice(-MAX_ENTRIES), ...(typeof memory.calibration === "string" ? { calibration: memory.calibration } : {}), ...(typeof memory.camera === "string" ? { camera: memory.camera } : {}) };
  }
  return table;
}
function load(slug: string): TableMemory {
  const held = pageMemory.get(slug); if (held) return held;
  let value: TableMemory = {};
  try { value = parseMemory(sessionStorage.getItem(storageKey(slug))); } catch { /* Memory-only fallback. */ }
  pageMemory.set(slug, value); return value;
}
function save(slug: string, value: TableMemory) {
  try { sessionStorage.setItem(storageKey(slug), JSON.stringify(value)); } catch { /* Memory-only fallback. */ }
}
/** Width / height of each camera's frame, from its last click. Distances are measured in frame heights. */
const frameAspect = new Map<number, number>();
export const noteTapFrame = (seat: number, width: number, height: number) => { if (width > 0 && height > 0) frameAspect.set(seat, width / height); };
const distanceIn = (aspect: number) => (a: Point, b: Point) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

/** The pixels of this card show a back. The detector's face-down class alone is not enough: a dark front can get it. Art sleeves stay undecided. */
export function faceDownInFrame(frame: HTMLCanvasElement | undefined, quad: readonly Point[]): boolean {
  if (!frame || quad.length !== 4) return false;
  try {
    const xs = quad.map(point => point.x * frame.width), ys = quad.map(point => point.y * frame.height);
    const left = Math.max(0, Math.floor(Math.min(...xs))), top = Math.max(0, Math.floor(Math.min(...ys)));
    const width = Math.min(frame.width, Math.ceil(Math.max(...xs))) - left, height = Math.min(frame.height, Math.ceil(Math.max(...ys))) - top;
    if (width < 24 || height < 24) return false;
    const image = frame.getContext("2d")?.getImageData(left, top, width, height);
    return !!image && isLikelyFaceDown({ width, height, data: image.data });
  } catch { return false; }
}

/**
 * The memory of one camera, or null when that camera is not in Tap to identify: Auto-detect neither reads nor writes it.
 * Runs only on a click. New zones or another camera device on this seat clear its entries here.
 */
export function tapMemoryFor(slug: string, seat: number, format: FieldFormat, hub: { tapMode(seat: number): boolean; trackedCalibration?(seat: number): FieldCalibration | undefined; cameraId?: string }) {
  if (!tapToIdentifyNow(seat) && !hub.tapMode(seat)) return null;
  const grid = currentZoneGrid(), own = grid.ownSeat === seat;
  const calibration = own ? grid.calibration : hub.trackedCalibration?.(seat);
  const zones = calibration?.orientation ? JSON.stringify([calibration.corners, calibration.orientation, calibration.zoneSpacing, calibration.zones]) : undefined;
  const camera = own ? hub.cameraId || undefined : undefined;
  const table = load(slug), memory = table[seat] ??= { entries: [] };
  const distance = distanceIn(frameAspect.get(seat) ?? 16 / 9);
  /** The same calibrated cell, or the same place in the frame when one of the two has no cell. */
  const sameSpot = (a: TapSpot, b: TapSpot) => a.cell && b.cell ? a.cell === b.cell : distance(a, b) <= Math.max(a.r, b.r);
  const write = () => save(slug, table);
  if ((zones && zones !== memory.calibration) || (camera && memory.camera && camera !== memory.camera)) memory.entries = [];
  if ((zones && zones !== memory.calibration) || (camera && camera !== memory.camera)) { memory.calibration = zones ?? memory.calibration; memory.camera = camera ?? memory.camera; write(); }
  return {
    spot(x: number, y: number, quad?: readonly Point[]): TapSpot {
      const mat = calibration?.orientation ? onMat({ x, y }, calibration) : undefined;
      const bounds = mat && calibration ? fieldZoneBounds(calibration, format) : undefined;
      const off = !!mat && !!bounds && (mat.x < bounds.minX || mat.x > bounds.maxX || mat.y < bounds.minY || mat.y > bounds.maxY);
      const cell = mat && calibration && !off ? fieldZoneAt(mat, calibration, format) : undefined;
      // The short side of the card: a longer radius reaches the next column.
      const r = quad?.length === 4 ? Math.min(distance(quad[0], quad[1]), distance(quad[1], quad[2])) / 2 : DEFAULT_RADIUS;
      return { x, y, r, ...(cell ? { cell } : {}), ...(off ? { off } : {}) };
    },
    recall(spot: TapSpot): TapEntry | undefined {
      if (spot.cell && PILE_CELLS.has(spot.cell)) return undefined;
      return memory.entries.filter(entry => sameSpot(entry, spot)).sort((a, b) => distance(a, spot) - distance(b, spot))[0];
    },
    /** The card replaces what this spot held. The oldest entries go first. */
    remember(spot: TapSpot, card: { cardId: number; name?: string }) {
      if (spot.cell && PILE_CELLS.has(spot.cell)) return;
      memory.entries = [...memory.entries.filter(entry => !sameSpot(entry, spot)), { ...spot, cardId: card.cardId, name: card.name ?? `Card ${card.cardId}`, at: Date.now() }].slice(-MAX_ENTRIES);
      write();
    },
    /** The click found no card here, so the card that was here left. */
    forget(spot: TapSpot) {
      if (spot.off) return;
      const kept = memory.entries.filter(entry => !sameSpot(entry, spot));
      if (kept.length !== memory.entries.length) { memory.entries = kept; write(); }
    },
  };
}
