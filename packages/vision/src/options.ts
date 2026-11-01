import type { RecognizeOptions } from './types';
export function validateOptions(opts: RecognizeOptions): void {
  if (opts.clickPoint && (![opts.clickPoint.x, opts.clickPoint.y].every(Number.isFinite) || opts.clickPoint.x < 0 || opts.clickPoint.x > 1 || opts.clickPoint.y < 0 || opts.clickPoint.y > 1)) throw new Error('clickPoint must be normalized to [0,1]');
  if (opts.k !== undefined && (!Number.isInteger(opts.k) || opts.k < 1 || opts.k > 100)) throw new Error('k must be an integer from 1 to 100');
}
