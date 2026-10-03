import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCommand, type CommandInteractionLike } from "../src/commands/handlers.js";
import { handleButton } from "../src/interactions/buttons.js";
import { handleSelectMenu } from "../src/interactions/select-menus.js";
import { createDraftTimerService } from "../src/services/draft-timer.js";

const { createTournamentFromDraft } = vi.hoisted(() => ({ createTournamentFromDraft: vi.fn() }));
vi.mock("@yugidraft/shared/services", () => ({
  createDraftTournamentService: () => ({ createTournamentFromDraft }),
}));

function setup() {
  const draft = {
    id: 1, guildId: "guild", channelId: "channel", name: "Draft", webSlug: "draft-cup",
    createdByUserId: "creator", status: "pending", config: {}, currentPackRound: 1, currentPickStep: 1,
  };
  const tournament = {
    id: 2, guildId: "guild", name: "Cup", webSlug: "cup", createdByUserId: "creator", status: "pending",
  };
  const match = { id: 3, tournamentId: 2 };
  return {
    draft, tournament,
    deps: {
      players: { upsert: vi.fn(() => ({ id: 7, displayName: "Yugi" })) },
      drafts: {
        findByName: vi.fn(() => draft), findById: vi.fn(() => draft), join: vi.fn(),
        start: vi.fn(() => ({ ...draft, status: "active" })), cancel: vi.fn(),
        pickOptions: vi.fn(() => [{ id: 10, catalogCardId: 20 }]), pickCard: vi.fn(),
        listActive: vi.fn(), expireCurrentPickStep: vi.fn(),
      },
      tournaments: {
        findByName: vi.fn(() => tournament), findById: vi.fn(() => tournament),
        start: vi.fn(), cancelWithChanges: vi.fn(() => ({ changedDuelSlugs: [] })),
        report: vi.fn(() => match),
      },
      matches: {
        latestPendingForOpponent: vi.fn(() => match), approve: vi.fn(() => match), deny: vi.fn(() => match),
        claimTournamentCompletionAnnouncement: vi.fn(() => false),
      },
      cards: { syncDraftPool: vi.fn(), findByIds: vi.fn(() => [{ name: "Card" }]) },
      messenger: { postStatus: vi.fn(), updateStatus: vi.fn() },
      broadcaster: { draft: vi.fn().mockResolvedValue(undefined), tournament: vi.fn().mockResolvedValue(undefined) },
      db: { prepare: vi.fn(() => ({ get: vi.fn(() => ({ id: 1, created_by_user_id: "creator", status: "completed" })) })) },
      announceTournamentCompleted: vi.fn(),
    },
  };
}

function command(commandName: string, subcommand: string): CommandInteractionLike {
  return {
    commandName, guildId: "guild", channelId: "channel", user: { id: "creator", username: "Yugi" },
    options: {
      getSubcommand: () => subcommand, getSubcommandGroup: () => null,
      getString: (name) => name === "result" ? "win" : "Cup",
      getUser: () => ({ id: "opponent", username: "Kaiba" }), getInteger: () => null, getRole: () => null,
    },
    reply: vi.fn(),
  };
}

describe("state change broadcasts", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["event", "start", "tournament", { kind: "started", slug: "cup" }],
    ["event", "cancel", "tournament", { kind: "cancelled", slug: "cup" }],
    ["event", "report", "tournament", { kind: "match-updated", slug: "cup" }],
    ["approve", "", "tournament", { kind: "match-updated", slug: "cup" }],
    ["deny", "", "tournament", { kind: "match-updated", slug: "cup" }],
    ["draft", "join", "draft", { kind: "seats", slug: "draft-cup" }],
    ["draft", "start", "draft", { kind: "status", slug: "draft-cup", status: "active" }],
    ["draft", "cancel", "draft", { kind: "status", slug: "draft-cup", status: "cancelled" }],
  ] as const)("/%s %s broadcasts the web event", async (name, subcommand, room, payload) => {
    const { deps } = setup();
    await handleCommand(command(name, subcommand), deps as unknown as Parameters<typeof handleCommand>[1]);
    expect(deps.broadcaster[room]).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it.each([
    ["join_draft:1", "draft", { kind: "seats", slug: "draft-cup" }],
    ["draft_start:1", "draft", { kind: "status", slug: "draft-cup", status: "active" }],
    ["dashboard_start:2", "tournament", { kind: "started", slug: "cup" }],
    ["dashboard_cancel:2", "tournament", { kind: "cancelled", slug: "cup" }],
  ] as const)("%s broadcasts the web event", async (customId, room, payload) => {
    const { deps } = setup();
    await handleButton({ ...command("", ""), customId }, deps as unknown as Parameters<typeof handleButton>[1]);
    expect(deps.broadcaster[room]).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it.each(["approve", "deny"])("/%s sends no tournament event for casual reports", async (name) => {
    const { deps } = setup();
    deps.matches.latestPendingForOpponent.mockReturnValue({ id: 3, tournamentId: null } as never);
    deps.matches.approve.mockReturnValue({ id: 3, tournamentId: null } as never);
    await handleCommand(command(name, ""), deps as unknown as Parameters<typeof handleCommand>[1]);
    expect(deps.broadcaster.tournament).not.toHaveBeenCalled();
  });

  it("does not broadcast a rejected draft join", async () => {
    const { deps } = setup();
    deps.drafts.join.mockImplementation(() => { throw new Error("You have already joined this draft"); });
    await handleCommand(command("draft", "join"), deps as unknown as Parameters<typeof handleCommand>[1]);
    expect(deps.broadcaster.draft).not.toHaveBeenCalled();
  });

  it.each(["unchanged", "advanced", "completed"])("a Discord pick broadcasts %s progress", async (progress) => {
    const { draft, deps } = setup();
    draft.status = "active";
    deps.drafts.findById.mockReturnValueOnce(draft).mockReturnValueOnce(draft).mockReturnValue({
      ...draft, currentPickStep: progress === "advanced" ? 2 : 1, status: progress === "completed" ? "completed" : "active",
    });
    await handleSelectMenu({
      ...command("", ""), customId: "draft_pick_card:1", values: ["10"], showModal: vi.fn(),
    }, deps as unknown as Parameters<typeof handleSelectMenu>[1]);
    expect(deps.broadcaster.draft).toHaveBeenNthCalledWith(1, {
      kind: "pick", slug: "draft-cup", playerId: 7, packRound: 1, pickStep: 1,
    });
    if (progress === "advanced") {
      expect(deps.broadcaster.draft).toHaveBeenNthCalledWith(2, { kind: "resync", slug: "draft-cup", packRound: 1, pickStep: 2 });
    } else if (progress === "completed") {
      expect(deps.broadcaster.draft).toHaveBeenNthCalledWith(2, { kind: "complete", slug: "draft-cup" });
    }
    expect(deps.broadcaster.draft).toHaveBeenCalledTimes(progress === "unchanged" ? 1 : 2);
  });

  it("creating a tournament from a Discord draft refreshes the linked draft", async () => {
    const { deps } = setup();
    createTournamentFromDraft.mockReturnValue({ tournamentId: 2, tournamentName: "Cup", webSlug: "cup" });
    await handleSelectMenu({
      ...command("", ""), customId: "draft:tournament-format:draft-cup", values: ["round_robin"], showModal: vi.fn(),
    }, deps as unknown as Parameters<typeof handleSelectMenu>[1]);
    expect(deps.broadcaster.draft).toHaveBeenCalledExactlyOnceWith({ kind: "seats", slug: "draft-cup" });
  });

  it.each(["active", "completed"])("the draft timer broadcasts %s progress", async (status) => {
    const { draft, deps } = setup();
    deps.drafts.listActive.mockReturnValue([{ ...draft, status: "active", pickDeadlineAt: "2026-01-01T00:00:00Z" }]);
    deps.drafts.findById.mockReturnValue({ ...draft, status, currentPickStep: 2 });
    const timer = createDraftTimerService(deps as unknown as Parameters<typeof createDraftTimerService>[0]);
    await timer.tick(new Date("2026-01-01T00:01:00Z"));
    expect(deps.broadcaster.draft).toHaveBeenCalledExactlyOnceWith(status === "completed"
      ? { kind: "complete", slug: "draft-cup" }
      : { kind: "resync", slug: "draft-cup", packRound: 1, pickStep: 2 });
  });

  it.each(["active", "completed"])("a Discord message failure cannot swallow the timer's %s broadcast", async (status) => {
    const { draft, deps } = setup();
    deps.drafts.listActive.mockReturnValue([{ ...draft, status: "active", pickDeadlineAt: "2026-01-01T00:00:00Z" }]);
    deps.drafts.findById.mockReturnValue({ ...draft, status, currentPickStep: 2 });
    deps.messenger.updateStatus.mockRejectedValue(new Error("Discord unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const timer = createDraftTimerService(deps as unknown as Parameters<typeof createDraftTimerService>[0]);
      await timer.tick(new Date("2026-01-01T00:01:00Z"));
      expect(deps.broadcaster.draft).toHaveBeenCalledExactlyOnceWith(status === "completed"
        ? { kind: "complete", slug: "draft-cup" }
        : { kind: "resync", slug: "draft-cup", packRound: 1, pickStep: 2 });
    } finally {
      warn.mockRestore();
    }
  });
});
