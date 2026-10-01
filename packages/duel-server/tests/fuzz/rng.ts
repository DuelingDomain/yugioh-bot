/** Small seeded PRNG (mulberry32). Deterministic across platforms. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x1234567;
    for (let i = 0; i < 4; i++) this.next();
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick from empty list");
    return items[this.int(items.length)] as T;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }

  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, count);
  }

  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const item of items) total += Math.max(0, weight(item));
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, weight(item));
      if (roll < 0) return item;
    }
    return items[items.length - 1] as T;
  }

  /** Child generator whose stream does not depend on how much the parent was used afterwards. */
  fork(salt: number): Rng {
    return new Rng((Math.floor(this.next() * 4294967296) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
  }
}

/** Four nonzero decimal uint64 strings for the engine seed. */
export function engineSeed(seed: number): string[] {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    const hi = BigInt(Math.floor(rng.next() * 4294967296));
    const lo = BigInt(Math.floor(rng.next() * 4294967296));
    const value = (hi << 32n) | lo;
    out.push((value === 0n ? 1n : value).toString());
  }
  return out;
}
