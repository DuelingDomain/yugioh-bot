import { createUserService } from "@yugidraft/shared/services";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { CommandReplyLike } from "../../src/commands/handlers.js";
import { migrate } from "../../src/db/schema.js";
import { handleModal, type ModalInteractionLike } from "../../src/interactions/modals.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { createDraftImageService } from "../../src/services/draft-images.js";
import { createDraftService } from "../../src/services/drafts.js";
import { createPlayerRepository } from "../../src/repositories/players.js";
import { createCubeService, createTournamentService } from "@yugidraft/shared/services";

type ModalDependencies = Parameters<typeof handleModal>[1];
type _DraftModalDependencyChecks = [
  ModalDependencies["drafts"],
  ModalDependencies["cards"],
  ModalDependencies["templates"],
  ModalDependencies["draftImages"],
];

function setup() {
  const db = new Database(":memory:");
  migrate(db);

  return {
    db,
    tournaments: createTournamentService(db),
    drafts: createDraftService(db),
    cards: createCardCatalogService(db),
    templates: createCubeService(db, createCardCatalogService(db)),
    draftImages: createDraftImageService({ cacheDir: "./data/test-card-images" }),
    players: createPlayerRepository(db),
  };
}

function fakeModal(input: {
  customId?: string;
  fields?: Record<string, string>;
  guildId?: string | null;
  user?: { id: string; username: string };
}) {
  const replies: CommandReplyLike[] = [];
  const fields = input.fields ?? {};
  const interaction: ModalInteractionLike = {
    customId: input.customId ?? "dashboard_create_event",
    channelId: "channel-1",
    guildId: input.guildId === undefined ? "guild-1" : input.guildId,
    user: input.user ?? { id: "900000000000000112", username: "Yugi" },
    fields: {
      getTextInputValue: (name) => fields[name] ?? "",
    },
    reply: (message) => {
      replies.push(message);
    },
  };

  return { interaction, replies };
}

describe("modal interactions", () => {
  it("creates an event from the dashboard modal", async () => {
    const app = setup();
    const { interaction, replies } = fakeModal({
      customId: "dashboard_create_event:round_robin",
      fields: { name: "locals" },
    });

    await handleModal(interaction, app);

    expect(app.tournaments.findByName("guild-1", "locals")?.createdByUserId).toBe(createUserService(app.db).findByDiscordId("900000000000000112")!.id);
    expect(app.db.prepare("select count(*) as count from players").get()).toEqual({ count: 0 });
    expect(app.db.prepare("select count(*) as count from users").get()).toEqual({ count: 1 });
    expect(replies[0]).toMatchObject({
      content: expect.stringContaining(
        "Signups are open for locals (round_robin). Click Join Tournament to enter."
      ),
    });
    expect(replies[0]).not.toHaveProperty("ephemeral", true);
    expect(JSON.stringify(replies[0])).toContain("join_tournament");
  });

  it("rejects unsupported dashboard modal formats", async () => {
    const app = setup();
    const { interaction, replies } = fakeModal({
      customId: "dashboard_create_event:swiss",
      fields: { name: "locals" },
    });

    await handleModal(interaction, app);

    expect(app.tournaments.findByName("guild-1", "locals")).toBeUndefined();
    expect(replies[0]).toEqual({
      content: "Format must be round_robin or single_elim.",
      ephemeral: true,
    });
  });

  it("rejects duplicate pending dashboard modal event names", async () => {
    const app = setup();
    app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const { interaction } = fakeModal({
      customId: "dashboard_create_event:single_elim",
      fields: { name: "locals" },
    });

    await expect(handleModal(interaction, app)).rejects.toThrow(
      "An active or pending tournament already uses that name",
    );
  });

  it("creates a draft from the dashboard modal, auto-joins the creator, and replies with a join button", async () => {
    const app = setup();
    const creator = app.players.upsert("guild-1", "900000000000000112", "Yugi");
    const { interaction, replies } = fakeModal({
      customId: "draft_create_modal",
      fields: {
        name: "cube night",
        sets: "Metal Raiders, Pharaoh's Servant",
        includes: "Dark Magician\nBlue-Eyes White Dragon",
        excludes: "Pot of Greed",
      },
    });

    await handleModal(interaction, app as Parameters<typeof handleModal>[1]);

    const draft = app.drafts.findByName("guild-1", "cube night");

    expect(draft).toMatchObject({
      channelId: "channel-1",
      name: "cube night",
      status: "pending",
      createdByUserId: createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id,
      config: {
        setNames: ["Metal Raiders", "Pharaoh's Servant"],
        includeNames: ["Dark Magician", "Blue-Eyes White Dragon"],
        excludeNames: ["Pot of Greed"],
      },
    });
    expect(app.drafts.players(draft!.id)).toEqual([{ playerId: creator.id, displayName: "Yugi" }]);
    expect(replies[0]).toMatchObject({
      content: expect.stringContaining("Signups are open for cube night"),
    });
    expect(replies[0]).not.toHaveProperty("ephemeral", true);
    expect(JSON.stringify(replies[0])).toContain("join_draft");
  });

  it("creates a draft from a template when template field is provided", async () => {
    const app = setup();
    const creator = app.players.upsert("guild-1", "900000000000000112", "Yugi");
    app.templates.save("guild-1", "Classic", { setNames: ["Metal Raiders"], includeNames: ["Dark Magician"], excludeNames: ["Pot of Greed"] }, createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);

    const { interaction, replies } = fakeModal({
      customId: "draft_create_modal",
      fields: {
        name: "cube night",
        template: "Classic",
        sets: "",
        includes: "",
        excludes: "",
      },
    });

    await handleModal(interaction, app as Parameters<typeof handleModal>[1]);

    const draft = app.drafts.findByName("guild-1", "cube night");

    expect(draft).toMatchObject({
      name: "cube night",
      config: {
        setNames: ["Metal Raiders"],
        includeNames: ["Dark Magician"],
        excludeNames: ["Pot of Greed"],
      },
    });
    expect(replies[0]).toMatchObject({
      content: expect.stringContaining("Signups are open for cube night"),
    });
  });

  it("rejects draft creation when template is not found", async () => {
    const app = setup();
    app.players.upsert("guild-1", "900000000000000112", "Yugi");

    const { interaction, replies } = fakeModal({
      customId: "draft_create_modal",
      fields: {
        name: "cube night",
        template: "Missing",
        sets: "",
        includes: "",
        excludes: "",
      },
    });

    await handleModal(interaction, app as Parameters<typeof handleModal>[1]);

    expect(app.drafts.findByName("guild-1", "cube night")).toBeUndefined();
    expect(replies[0]).toEqual({
      content: "Template not found: Missing.",
      ephemeral: true,
    });
  });
});
