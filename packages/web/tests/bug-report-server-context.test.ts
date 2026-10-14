import { afterEach, expect, it, vi } from "vitest";
import type { DuelService } from "@yugidraft/shared/services";

const { host } = vi.hoisted(() => ({ host: vi.fn() }));
vi.mock("@/lib/duel-host", () => ({ callDuelHost: host }));
import { buildReportContext } from "../src/lib/bug-reports/server-context";

afterEach(() => host.mockReset());

it("checks report access without loading the stored board", async () => {
  const room = vi.fn(() => ({
    session: { format: "1v1", mode: "normal", kind: "play" }, mySeat: 0,
  } as ReturnType<DuelService["room"]>));
  host.mockResolvedValue({ ok: true, data: { turn: 8, log: ["Public log"] } });
  const result = await buildReportContext({ guildId: "fixture-guild", playerId: 7, duelSlug: "fixture-duel", duels: { room }, client: {} });
  expect(room).toHaveBeenCalledExactlyOnceWith("fixture-duel", "fixture-guild", 7, { includeStoredBoard: false });
  expect(result).toMatchObject({ duelVerified: true, context: { format: "1v1", seat: 0, turn: 8, log: ["Public log"] } });
});
