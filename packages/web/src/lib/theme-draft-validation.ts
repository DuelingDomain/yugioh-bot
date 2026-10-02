import type Database from "better-sqlite3";
import type { DraftConfig } from "@yugidraft/shared/types";

export function hostThemeAssignmentError(
  db: Database.Database,
  guildId: string,
  config: DraftConfig,
  playerIds: number[],
): string | undefined {
  if (config.mode !== "theme" || config.themeSelection !== "host_assigned") return;

  const allowed = config.allowedCubeIds ?? [];
  const assignments = config.themeAssignments ?? {};
  // Creation joins the creator; other entry points pass the current lobby's players.
  const assignedCubeIds = playerIds.map((playerId) => assignments[String(playerId)]);
  const validAssignment = (cubeId: number) => typeof cubeId === "number" && Number.isInteger(cubeId) && allowed.includes(cubeId);
  if (!assignedCubeIds.every(validAssignment)) {
    return "Host-assigned themes require an allowed theme assignment for every player. Choose Random or Players pick instead.";
  }

  const findCube = db.prepare("select id from cubes where id = ? and guild_id = ?");
  // Match startThemeDraft: unused allowed cubes do not affect host assignments.
  if (assignedCubeIds.some((cubeId) => !findCube.get(cubeId, guildId))) {
    return "Host-assigned themes must exist in the draft's guild. Choose valid themes or switch to Random or Players pick.";
  }

  if ((config.uniqueThemes ?? true) && new Set(assignedCubeIds).size !== assignedCubeIds.length) {
    return "Host-assigned themes must be distinct when uniqueThemes is enabled.";
  }
}
