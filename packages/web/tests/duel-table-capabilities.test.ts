import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { actor, host } = vi.hoisted(() => ({ actor: vi.fn(), host: vi.fn() }));
vi.mock("@/lib/duel-host", () => ({ requireDuelActor: actor, callDuelHost: host }));
vi.mock("@/components/duel/creator", () => ({ DuelCreator: () => null }));
import { duelCreatorCapabilities } from "@/lib/duel-table-capabilities";
import NewDuelPage, { dynamic } from "../app/(app)/duels/new/page";

beforeEach(() => {
  vi.stubEnv("MULTIPLAYER_TABLES", "1");
  actor.mockReset().mockResolvedValue({ ok: true, guildId: "g", playerId: 7 });
  host.mockReset().mockResolvedValue({ ok: true, data: { multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: true } });
});
afterEach(() => vi.unstubAllEnvs());

describe("creator core status from the real host protocol", () => {
  it("reads runtime flags and host status on each page request", () => {
    expect(dynamic).toBe("force-dynamic");
  });
  it("passes all host capabilities to the creator page", async () => {
    const page = await NewDuelPage({ searchParams: Promise.resolve({}) });
    expect(page.props).toEqual({ discordEnabled: false, focusOpponent: false, multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: true });
    expect(host).toHaveBeenCalledWith({ op: "capabilities", guildId: "g", playerId: 7 });
  });

  it("keeps challenge focus together with host capabilities", async () => {
    const page = await NewDuelPage({ searchParams: Promise.resolve({ challenge: "1" }) });
    expect(page.props).toEqual({ discordEnabled: false, focusOpponent: true, multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: true });
  });

  it.each(["1", "true", "on"])("uses the shared flag reader for %j", async (flag) => {
    vi.stubEnv("MULTIPLAYER_TABLES", flag);
    expect(await duelCreatorCapabilities()).toEqual({ discordEnabled: false, multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: true });
    expect(host).toHaveBeenCalledOnce();
  });

  it("keeps Standard tables available when only the Domain multi core is missing", async () => {
    host.mockResolvedValue({ ok: true, data: { multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: false } });
    expect(await duelCreatorCapabilities()).toEqual({ discordEnabled: false, multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: false });
  });

  it("reports a missing plain multi core even when the Domain core is installed", async () => {
    host.mockResolvedValue({ ok: true, data: { multiplayerTables: true, multiCoreReady: false, multiDomainCoreReady: true } });
    expect(await duelCreatorCapabilities()).toEqual({ discordEnabled: false, multiplayerTables: true, multiCoreReady: false, multiDomainCoreReady: true });
  });

  it.each(["0", "false", ""])("keeps multiplayer closed for flag value %j without a host request", async (flag) => {
    vi.stubEnv("MULTIPLAYER_TABLES", flag);
    expect(await duelCreatorCapabilities()).toEqual({ discordEnabled: false, multiplayerTables: false, multiCoreReady: false, multiDomainCoreReady: false });
    expect(host).not.toHaveBeenCalled();
  });

  it("keeps multiplayer closed when the host does not answer", async () => {
    host.mockResolvedValue({ ok: false, response: Response.json({}, { status: 503 }) });
    expect(await duelCreatorCapabilities()).toEqual({ discordEnabled: false, multiplayerTables: false, multiCoreReady: false, multiDomainCoreReady: false });
  });

  it("does not accept missing or string capabilities", async () => {
    for (const data of [null, {}, { multiplayerTables: "true", multiCoreReady: "true", multiDomainCoreReady: "true" }]) {
      host.mockResolvedValue({ ok: true, data });
      expect(await duelCreatorCapabilities()).toEqual({ discordEnabled: false, multiplayerTables: false, multiCoreReady: false, multiDomainCoreReady: false });
    }
  });

  it("does not send an unauthenticated host request", async () => {
    actor.mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) });
    expect(await duelCreatorCapabilities()).toEqual({ discordEnabled: false, multiplayerTables: false, multiCoreReady: false, multiDomainCoreReady: false });
    expect(host).not.toHaveBeenCalled();
  });
});

it.each([undefined, "0", "true", "1"])("passes Discord capability from the server for %s", async flag => {
  vi.resetModules();
  vi.stubEnv("DISCORD_BOT_ENABLED", flag);
  const { duelCreatorCapabilities: readCapabilities } = await import("@/lib/duel-table-capabilities");
  expect((await readCapabilities()).discordEnabled).toBe(flag === "1");
});
