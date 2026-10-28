import { createPlayerService } from "@yugidraft/shared/services";
import { callBridgeHost } from "../bridges-api";
import { getDb } from "../db";
import { env } from "../env";
import { failed, notConfigured, ok, type SectionLoader } from "./section";
import type { BridgesData } from "./types";

export const loadBridges: SectionLoader<"bridges"> = async ({ userId, now }) => {
  const guildId = env.discordGuildId;
  if (!guildId) return notConfigured("The community is not configured.", now);
  const player = createPlayerService(getDb()).findByGuildAndUser(guildId, userId);
  if (!player) return failed("A community player account is required to read bridge feedback.", now);
  const response = await callBridgeHost({ userId, playerId: player.id, guildId }, { op: "review" });
  return response.ok ? ok(response.data as BridgesData, now) : failed("Bridge feedback could not be loaded.", now);
};
