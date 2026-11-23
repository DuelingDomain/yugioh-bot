import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { stackDir } from "../stack/env.mjs";

/** Raw PNG output of a screenshot run: packages/e2e/.stack-N/screenshots (or .stack without a slot). */
export function shotDir(name: string): string {
  const dir = resolve(process.env.SHOT_DIR ?? resolve(stackDir, "screenshots"));
  mkdirSync(dir, { recursive: true });
  return resolve(dir, name);
}
