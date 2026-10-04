import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import {
  handleSelectMenu,
  type SelectMenuInteractionLike,
} from "../../src/interactions/select-menus.js";
import { createPlayerRepository } from "../../src/repositories/players.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { createDraftImageService } from "../../src/services/draft-images.js";
import { createDraftService } from "../../src/services/drafts.js";
import { createTournamentService } from "@yugidraft/shared/services";

type SelectMenuDependencies = Parameters<typeof handleSelectMenu>[1];
type _DraftSelectMenuDependencyChecks = [
  SelectMenuDependencies["drafts"],
  SelectMenuDependencies["cards"],
  SelectMenuDependencies["messenger"],
];

function seedDraftCatalog(app: ReturnType<typeof setup>, count: number) {
  const insertCard = app.db.prepare(
    `
      insert into card_catalog (
        ygoprodeck_id,
        name,
        type,
        frame_type,
        image_url,
        image_url_small,
        card_sets_json,
        cached_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  for (let id = 1; id <= count; id += 1) {
    insertCard.run(
      id,
      `Card ${id}`,
      "Spellcaster / Normal Monster",
      "normal",
      `https://img/full/${id}`,
      `https://img/small/${id}`,
      JSON.stringify([{ set_name: "Metal Raiders" }]),
      "2026-01-01T00:00:00Z",
    );
  }
}

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  const postStatusCalls: Array<{ draftId: number }> = [];
  const updateStatusCalls: Array<{ draftId: number }> = [];

  return {
    db,
    broadcaster: { draft: vi.fn().mockResolvedValue(undefined), tournament: vi.fn().mockResolvedValue(undefined) },
    players: createPlayerRepository(db),
    tournaments: createTournamentService(db),
    drafts: createDraftService(db),
    cards: createCardCatalogService(db),
    draftImages: createDraftImageService({ cacheDir: "./data/test-card-images" }),
    messenger: {
      async postStatus(draft: { id: number }) {
        postStatusCalls.push({ draftId: draft.id });
      },
      async updateStatus(draft: { id: number }) {
        updateStatusCalls.push({ draftId: draft.id });
      },
    },
    postStatusCalls,
    updateStatusCalls,
  };
}

function fakeSelectMenu(input: Partial<SelectMenuInteractionLike> = {}) {
  const replies: Array<{ content: string; ephemeral?: boolean; components?: readonly unknown[]; files?: readonly unknown[] }> = [];
  const modals: unknown[] = [];
  const interaction: SelectMenuInteractionLike = {
    customId: "dashboard_create_event_format",
    channelId: "channel-1",
    guildId: "guild-1",
    user: { id: "user-1", username: "Yugi" },
    values: ["round_robin"],
    showModal: (modal) => {
      modals.push(modal);
    },
    reply: (message) => {
      replies.push(message);
    },
    ...input,
  };

  return { interaction, modals, replies };
}

function cappedMenuDraft() {
  const app = setup();
  const player = app.players.upsert("guild-1", "user-7", "Yugi");
  const other = app.players.upsert("guild-1", "user-9", "Kaiba");
  seedDraftCatalog(app, 16);
  const draft = app.drafts.create("guild-1", "c", "cap messages", {
    packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8,
  }, "user-7", player.id);
  app.drafts.join(draft.id, other.id);
  app.drafts.start(draft.id);
  const pack = app.drafts.currentPackOptions(draft.id, player.id);
  let step = -1;
  const cap = (catalogId: number) => {
    for (let copy = 0; copy < 3; copy += 1) {
      const card = app.db.prepare("insert into draft_cards (draft_id, wave_number, catalog_card_id, position, picked_by_player_id) values (?, 0, ?, 0, ?)")
        .run(draft.id, catalogId, player.id);
      app.db.prepare("insert into draft_picks (draft_id, player_id, draft_card_id, wave_number, pick_step, pick_method, picked_at) values (?, ?, ?, 0, ?, 'manual', 't')")
        .run(draft.id, player.id, Number(card.lastInsertRowid), step--);
    }
  };
  const menu = () => fakeSelectMenu({
    customId: `draft_pick_card:${draft.id}`, user: { id: "user-7", username: "Yugi" }, values: [String(pack[0].id)],
  });
  return { app, draft, player, pack, cap, menu };
}

describe("select menu interactions", () => {
  beforeEach(() => {
    let counter = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      const result = counter / 16;
      counter = (counter + 1) % 16;
      return result;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows a forced pick from a fully capped pack", async () => {
    const { app, pack, cap, menu } = cappedMenuDraft();
    for (const card of pack) cap(card.catalogCardId);
    const { interaction, replies } = menu();
    await handleSelectMenu(interaction, app);
    expect(replies[0]).toEqual({ content: expect.stringMatching(/You picked Card/i), ephemeral: true });
    expect(replies[0].content).not.toMatch(/already picked/i);
    expect(replies[0].content).toContain("You have 3 of each card here. This pick stays in your pool only.");
    app.db.close();
  });

  it("does not add the forced-pick line to a normal pick", async () => {
    const { app, menu } = cappedMenuDraft();
    const { interaction, replies } = menu();
    await handleSelectMenu(interaction, app);
    expect(replies[0].content).toMatch(/You picked Card/i);
    expect(replies[0].content).not.toMatch(/stays in your pool only/);
    app.db.close();
  });

  it("explains a recorded pass without claiming the player picked", async () => {
    const { app, draft, player, menu } = cappedMenuDraft();
    app.db.prepare("insert into draft_passes (draft_id, player_id, wave_number, pick_step, passed_at) values (?, ?, 1, 1, 't')")
      .run(draft.id, player.id);
    const { interaction, replies } = menu();
    await handleSelectMenu(interaction, app);
    expect(replies[0]).toEqual({ content: expect.stringMatching(/passed.*nothing/i), ephemeral: true });
    expect(replies[0].content).not.toMatch(/already picked/i);
    app.db.close();
  });

  it("explains an empty pack without claiming the player picked", async () => {
    const { app, draft, player, pack, menu } = cappedMenuDraft();
    app.db.prepare("delete from draft_cards where draft_id = ? and id in (?,?,?,?)").run(draft.id, ...pack.map((c) => c.id));
    const { interaction, replies } = menu();
    await handleSelectMenu(interaction, app);
    expect(replies[0].content).toMatch(/no card.*next pack/i);
    expect(app.drafts.pool(draft.id, player.id)).toEqual([]);
    app.db.close();
  });

  it.each([
    { pickCount: 8, finishedAt: null },
    { pickCount: 9, finishedAt: null },
    { pickCount: 3, finishedAt: "t" },
  ])("tells a finished player to wait for others ($pickCount picks, finishedAt=$finishedAt)", async ({ pickCount, finishedAt }) => {
    const { app, draft, player, menu } = cappedMenuDraft();
    app.db.prepare("update draft_players set pick_count = ?, finished_at = ? where draft_id = ? and player_id = ?")
      .run(pickCount, finishedAt, draft.id, player.id);
    const other = app.drafts.players(draft.id).find((p) => p.playerId !== player.id)!;
    expect(app.drafts.findById(draft.id).status).toBe("active");
    expect(app.drafts.pickOptions(draft.id, other.playerId).length).toBeGreaterThan(0);
    const packOptions = vi.spyOn(app.drafts, "currentPackOptions");
    const { interaction, replies } = menu();

    await handleSelectMenu(interaction, app);

    expect(replies).toEqual([{ content: "You have finished drafting. Waiting for other players.", ephemeral: true }]);
    expect(packOptions).not.toHaveBeenCalled();
    expect(app.drafts.pool(draft.id, player.id)).toEqual([]);
    app.db.close();
  });

  it("reports a completed draft even when the player has finished", async () => {
    const { app, draft, player, menu } = cappedMenuDraft();
    app.db.prepare("update draft_players set pick_count = 8, finished_at = 't' where draft_id = ? and player_id = ?")
      .run(draft.id, player.id);
    app.db.prepare("update drafts set status = 'completed' where id = ?").run(draft.id);
    const { interaction, replies } = menu();

    await handleSelectMenu(interaction, app);

    expect(replies).toEqual([{ content: "This draft has completed.", ephemeral: true }]);
    app.db.close();
  });

  it("handles a stale capped selection while other cards remain takeable", async () => {
    const { app, draft, player, pack, cap, menu } = cappedMenuDraft();
    cap(pack[0].catalogCardId);
    const { interaction, replies } = menu();
    await expect(handleSelectMenu(interaction, app)).resolves.toBeUndefined();
    expect(replies[0]).toEqual({ content: expect.stringMatching(/already have 3.*choose another/i), ephemeral: true });
    expect(app.drafts.pool(draft.id, player.id)).toHaveLength(3);
    app.db.close();
  });
  it("opens a name-only create event modal after choosing a format", async () => {
    const app = setup();
    const { interaction, modals } = fakeSelectMenu({ values: ["single_elim"] });

    await handleSelectMenu(interaction, app);

    expect(JSON.stringify(modals[0])).toContain("dashboard_create_event:single_elim");
    expect(JSON.stringify(modals[0])).toContain("name");
    expect(JSON.stringify(modals[0])).not.toContain("format");
  });

  it("rejects unsupported format selections", async () => {
    const app = setup();
    const { interaction } = fakeSelectMenu({ values: ["swiss"] });

    await expect(handleSelectMenu(interaction, app)).rejects.toThrow("Unsupported tournament format");
  });

  it("records a draft pick from select menu and replies with card name", async () => {
    const app = setup();
    const yugi = app.players.upsert("guild-1", "user-7", "Yugi");
    const kaiba = app.players.upsert("guild-1", "user-9", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", {}, "user-7", yugi.id);
    app.drafts.join(draft.id, kaiba.id);
    seedDraftCatalog(app, 80);
    app.drafts.start(draft.id);
    const yugiOptions = app.drafts.pickOptions(draft.id, yugi.id);
    const { interaction, replies } = fakeSelectMenu({
      customId: `draft_pick_card:${draft.id}`,
      user: { id: "user-7", username: "Yugi" },
      values: [String(yugiOptions[0].id)],
    });

    await handleSelectMenu(interaction, app);

    const catalogCards = app.cards.findByIds([yugiOptions[0].catalogCardId]);
    const expectedCardName = catalogCards[0]?.name ?? "Unknown";
    expect(replies[0].content).toContain(`You picked ${expectedCardName}.`);
    expect(replies[0].ephemeral).toBe(true);
    expect(app.updateStatusCalls).toEqual([]);
  });

  it("updates status after the final player picks a step", async () => {
    const app = setup();
    const yugi = app.players.upsert("guild-1", "user-7", "Yugi");
    const kaiba = app.players.upsert("guild-1", "user-9", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", {}, "user-7", yugi.id);
    app.drafts.join(draft.id, kaiba.id);
    seedDraftCatalog(app, 80);
    app.drafts.start(draft.id);
    const yugiOptions = app.drafts.pickOptions(draft.id, yugi.id);
    const kaibaOptions = app.drafts.pickOptions(draft.id, kaiba.id);

    await handleSelectMenu(
      fakeSelectMenu({
        customId: `draft_pick_card:${draft.id}`,
        user: { id: "user-7", username: "Yugi" },
        values: [String(yugiOptions[0].id)],
      }).interaction,
      app,
    );

    expect(app.updateStatusCalls).toEqual([]);

    await handleSelectMenu(
      fakeSelectMenu({
        customId: `draft_pick_card:${draft.id}`,
        user: { id: "user-9", username: "Kaiba" },
        values: [String(kaibaOptions[0].id)],
      }).interaction,
      app,
    );

    expect(app.updateStatusCalls.length).toBe(1);
    expect(app.updateStatusCalls[0].draftId).toBe(draft.id);
  });

  it("records draft picks from direct message prompts", async () => {
    const app = setup();
    const yugi = app.players.upsert("guild-1", "user-7", "Yugi");
    const kaiba = app.players.upsert("guild-1", "user-9", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", {}, "user-7", yugi.id);
    app.drafts.join(draft.id, kaiba.id);
    seedDraftCatalog(app, 80);
    app.drafts.start(draft.id);
    const yugiOptions = app.drafts.pickOptions(draft.id, yugi.id);
    const { interaction, replies } = fakeSelectMenu({
      customId: `draft_pick_card:${draft.id}`,
      guildId: null,
      user: { id: "user-7", username: "Yugi" },
      values: [String(yugiOptions[0].id)],
    });

    await handleSelectMenu(interaction, app);

    const catalogCards = app.cards.findByIds([yugiOptions[0].catalogCardId]);
    const expectedCardName = catalogCards[0]?.name ?? "Unknown";
    expect(replies[0].content).toContain(`You picked ${expectedCardName}.`);
    expect(replies[0].ephemeral).toBe(true);
  });

  it("tells a player they already picked when they try again", async () => {
    const app = setup();
    const yugi = app.players.upsert("guild-1", "user-7", "Yugi");
    const kaiba = app.players.upsert("guild-1", "user-9", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", {}, "user-7", yugi.id);
    app.drafts.join(draft.id, kaiba.id);
    seedDraftCatalog(app, 80);
    app.drafts.start(draft.id);
    const yugiOptions = app.drafts.pickOptions(draft.id, yugi.id);

    await handleSelectMenu(
      fakeSelectMenu({
        customId: `draft_pick_card:${draft.id}`,
        user: { id: "user-7", username: "Yugi" },
        values: [String(yugiOptions[0].id)],
      }).interaction,
      app,
    );

    const { interaction, replies } = fakeSelectMenu({
      customId: `draft_pick_card:${draft.id}`,
      user: { id: "user-7", username: "Yugi" },
      values: [String(yugiOptions[1].id)],
    });

    await handleSelectMenu(interaction, app);

    expect(replies[0].content).toContain("already picked");
    expect(replies[0].ephemeral).toBe(true);
  });
});
