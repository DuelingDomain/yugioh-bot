import type { SandboxScenario } from "@yugidraft/shared/services";
import type { DuelFormat, DuelMode, SandboxBoard, SandboxRun } from "@yugidraft/shared/duels";
import { getDb } from "@/lib/db";

/** The list row. No board: the list can hold 200 scenarios. */
export interface ScenarioListItem {
  id: number;
  name: string;
  format: DuelFormat;
  mode: DuelMode;
  ownerName: string;
  updatedAt: string;
  mine: boolean;
}

/** A full scenario for the editor and the share link. */
export interface ScenarioData extends ScenarioListItem {
  board: SandboxBoard;
  run: SandboxRun;
}

function ownerNames(guildId: string, ids: number[]): Map<number, string> {
  const names = new Map<number, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return names;
  const rows = getDb()
    .prepare(`select id, display_name from players where guild_id = ? and id in (${unique.map(() => "?").join(",")})`)
    .all(guildId, ...unique) as { id: number; display_name: string }[];
  for (const row of rows) names.set(row.id, row.display_name);
  return names;
}

export function toListItems(guildId: string, playerId: number, scenarios: SandboxScenario[]): ScenarioListItem[] {
  const names = ownerNames(guildId, scenarios.map((s) => s.ownerPlayerId));
  return scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    format: s.format,
    mode: s.mode,
    ownerName: names.get(s.ownerPlayerId) ?? "An admin",
    updatedAt: s.updatedAt,
    mine: s.ownerPlayerId === playerId,
  }));
}

export function toScenarioData(guildId: string, playerId: number, scenario: SandboxScenario): ScenarioData {
  return { ...toListItems(guildId, playerId, [scenario])[0], board: scenario.board, run: scenario.run };
}
