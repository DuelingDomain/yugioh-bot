import { fileURLToPath } from "node:url";
import { players } from "../stack/env.mjs";

export type PlayerKey = "p1" | "p2" | "p3" | "p4";

export function authFile(key: string): string {
  return fileURLToPath(new URL(`../.auth/${key}.json`, import.meta.url));
}

export function playerName(key: PlayerKey): string {
  const player = players.find((candidate) => candidate.key === key);
  if (!player) throw new Error(`Unknown player ${key}`);
  return player.name;
}
