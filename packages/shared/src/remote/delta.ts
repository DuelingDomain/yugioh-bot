/**
 * Small update messages for a Remote Duel room. The ws server sends `remote:patch` with a RoomPatch;
 * a browser that holds sequence `base` applies it and then holds sequence `seq`. Any other browser repairs with one GET.
 */
export type PatchOp = { p: (string | number)[]; v?: unknown; d?: true };
export type RoomPatch = { seq: number; base: number; ops: PatchOp[] };

const isBox = (value: unknown): value is Record<string, unknown> | unknown[] => typeof value === "object" && value !== null;

function setAt(node: unknown, path: (string | number)[], depth: number, op: PatchOp): unknown {
  if (depth === path.length) return op.d ? undefined : op.v;
  if (!isBox(node)) throw new Error(`Patch path leaves the view at ${path.slice(0, depth).join(".")}`);
  const key = path[depth];
  if (Array.isArray(node)) {
    if (typeof key !== "number" || !Number.isInteger(key) || key < 0 || key > node.length) throw new Error(`Bad array index ${String(key)}`);
    const copy = node.slice();
    if (depth === path.length - 1 && op.d) { copy.splice(key, 1); return copy; }
    copy[key] = setAt(node[key], path, depth + 1, op); return copy;
  }
  const copy = { ...node };
  if (depth === path.length - 1 && op.d) { delete copy[key]; return copy; }
  copy[key] = setAt(node[key], path, depth + 1, op); return copy;
}

/**
 * Pure: returns a new view and never changes `view`. Only objects and arrays on a changed path are copied, so the rest keeps its identity.
 * `v` sets the value at `p` (an empty `p` replaces the whole view); `d` deletes the key, or removes the array element. Throws on a path that does not fit the view.
 */
export function applyPatch<T>(view: T, ops: readonly PatchOp[]): T {
  let next: unknown = view;
  for (const op of ops) next = setAt(next, op.p, 0, op);
  return next as T;
}
