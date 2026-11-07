/**
 * Small patches of one viewer's projected table view.
 *
 * The server diffs two views that were both projected for the same viewer, so a patch can never hold more than that
 * viewer may see. The client applies the patch to the view it holds, and only when `base` equals the sequence number
 * it holds. Any other case is a gap: the client repairs with one GET.
 */
export type PatchPath = (string | number)[];
/**
 * One change.
 * - `{ p, v }` sets the value at path `p`. An empty path replaces the whole view. A number step is an array index (an index equal
 *   to the array length appends). The key `length` on an array cuts the array to `v` items.
 * - `{ p, d: true }` deletes the object key at `p`, or removes the array item at that index.
 * - `{ p, x: [start, deleteCount, items] }` replaces a span of the array at `p`.
 */
export type PatchOp = { p: PatchPath; v?: unknown; d?: true; x?: [number, number, unknown[]] };
/** `base` is the sequence number the patch applies to. `seq` is the sequence number after it. */
export type RoomPatch = { seq: number; base: number; ops: PatchOp[] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Deep equality for JSON data. A key with the value `undefined` counts as missing, as it does after JSON. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameJson(a[i], other[i])) return false;
    return true;
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  for (const key in left) if (left[key] !== undefined && !sameJson(left[key], right[key])) return false;
  for (const key in right) if (right[key] !== undefined && left[key] === undefined) return false;
  return true;
}

function diffInto(prev: unknown, next: unknown, path: PatchPath, ops: PatchOp[]) {
  if (prev === next) return;
  if (isObject(prev) && isObject(next)) {
    for (const key in prev) if (prev[key] !== undefined && next[key] === undefined) ops.push({ p: [...path, key], d: true });
    for (const key in next) {
      const value = next[key];
      if (value === undefined) continue;
      if (prev[key] === undefined) ops.push({ p: [...path, key], v: value });
      else diffInto(prev[key], value, [...path, key], ops);
    }
    return;
  }
  if (Array.isArray(prev) && Array.isArray(next)) {
    let old: unknown[] = prev;
    // A window that slides (the event list): items that carry an `id` are aligned by it, so dropping the oldest items is one splice.
    const first = next[0];
    if (old.length && isObject(first) && typeof first.id === "string" && !(isObject(old[0]) && old[0].id === first.id)) {
      const dropped = old.findIndex(item => isObject(item) && item.id === first.id);
      if (dropped > 0) { ops.push({ p: path, x: [0, dropped, []] }); old = old.slice(dropped); }
    }
    if (old.length === next.length) {
      for (let i = 0; i < next.length; i++) diffInto(old[i], next[i], [...path, i], ops);
      return;
    }
    // Different length: replace only the span between the common head and the common tail. A sliding window costs one splice.
    let head = 0;
    const max = Math.min(old.length, next.length);
    while (head < max && sameJson(old[head], next[head])) head++;
    let tail = 0;
    while (tail < max - head && sameJson(old[old.length - 1 - tail], next[next.length - 1 - tail])) tail++;
    ops.push({ p: path, x: [head, old.length - head - tail, next.slice(head, next.length - tail)] });
    return;
  }
  if (!sameJson(prev, next)) ops.push({ p: path, v: next });
}

/** The ops that turn `prev` into `next`. An empty list means no change. */
export function diffView(prev: unknown, next: unknown): PatchOp[] {
  const ops: PatchOp[] = [];
  diffInto(prev, next, [], ops);
  return ops;
}

const bad = (message: string): never => { throw new Error(`Bad patch: ${message}`); };

function index(step: string | number, length: number, allowEnd: boolean): number {
  if (typeof step !== "number" || !Number.isInteger(step) || step < 0 || step > length || (step === length && !allowEnd)) bad("array index");
  return step as number;
}

function applyAt(node: unknown, path: PatchPath, depth: number, op: PatchOp): unknown {
  const last = depth === path.length;
  if (last) {
    if (op.x) {
      if (!Array.isArray(node)) return bad("splice target");
      const [start, count, items] = op.x;
      if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0 || start + count > node.length || !Array.isArray(items)) bad("splice range");
      return [...node.slice(0, start), ...items, ...node.slice(start + count)];
    }
    return bad("path");
  }
  const step = path[depth];
  const finalStep = depth === path.length - 1 && !op.x;
  if (Array.isArray(node)) {
    if (finalStep) {
      if (step === "length") {
        if (op.d || typeof op.v !== "number" || !Number.isInteger(op.v) || op.v < 0 || op.v > node.length) bad("array length");
        return node.slice(0, op.v as number);
      }
      const at = index(step, node.length, !op.d);
      const copy = node.slice();
      if (op.d) copy.splice(at, 1); else copy[at] = op.v;
      return copy;
    }
    const at = index(step, node.length, false);
    const copy = node.slice(); copy[at] = applyAt(node[at], path, depth + 1, op);
    return copy;
  }
  if (isObject(node)) {
    if (typeof step !== "string" || UNSAFE_KEYS.has(step)) return bad("key");
    const copy: Record<string, unknown> = { ...node };
    if (finalStep) { if (op.d) delete copy[step]; else copy[step] = op.v; }
    else {
      if (!Object.hasOwn(node, step)) bad("missing parent");
      copy[step] = applyAt(node[step], path, depth + 1, op);
    }
    return copy;
  }
  return bad("parent is not a container");
}

/**
 * The view after `ops`. It does not change `view`: only the objects along each changed path are copied.
 * It throws on any op that does not fit the view. The caller treats a throw as a bad patch and repairs with one GET.
 */
export function applyPatch<T>(view: T, ops: readonly PatchOp[]): T {
  let current: unknown = view;
  for (const op of ops) {
    if (!op || !Array.isArray(op.p)) bad("op");
    if (op.p.length === 0 && !op.x) {
      if (op.d) bad("root delete");
      current = op.v; continue;
    }
    current = applyAt(current, op.p, 0, op);
  }
  return current as T;
}

/**
 * A patch from `prev` to `next`, or null when a full view is the better message: no previous view, or the ops are larger than
 * `maxRatio` of the view. The cheap size test runs first, so a small patch never serializes the full view.
 */
export function makePatch(prev: unknown, next: unknown, base: number, seq: number, opts: { maxRatio?: number; freeBytes?: number } = {}): RoomPatch | null {
  if (prev === undefined || prev === null) return null;
  const ops = diffView(prev, next);
  const bytes = JSON.stringify(ops).length;
  if (bytes > (opts.freeBytes ?? 2048) && bytes > JSON.stringify(next).length * (opts.maxRatio ?? 0.5)) return null;
  return { seq, base, ops };
}
