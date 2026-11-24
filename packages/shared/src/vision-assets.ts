import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';

export const VISION_CODE_DIR_DEFAULT = '/app/vision-code';

export function visionCodeDirectory(): string {
  return resolve(process.env.VISION_CODE_DIR || VISION_CODE_DIR_DEFAULT);
}

export function visionDataDirectory(fallback = '../../data/vision'): string {
  return resolve(process.env.VISION_DATA_DIR || fallback);
}

/** A regular manifest file marks the complete Current index baked into the image. */
export function pinnedVisionIndexDirectory(): string | undefined {
  const directory = resolve(visionCodeDirectory(), '../vision-index');
  try {
    if (lstatSync(resolve(directory, 'index-manifest.json')).isFile()) return directory;
  } catch {
    // Local and pre-pin images use the volume.
  }
}
