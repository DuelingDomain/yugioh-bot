import { resolve } from "node:path";
import { authDir, players } from "../stack/env.mjs";

export type PlayerKey = "p1" | "p2" | "p3" | "p4" | "p5";

export function authFile(key: string): string {
  return resolve(authDir, `${key}.json`);
}

export function playerName(key: PlayerKey): string {
  const player = players.find((candidate) => candidate.key === key);
  if (!player) throw new Error(`Unknown player ${key}`);
  return player.name;
}
