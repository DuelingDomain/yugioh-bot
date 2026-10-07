import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createPlayerRepository } from "../../src/repositories/players.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { createDraftImageService } from "../../src/services/draft-images.js";
import { createDraftService } from "../../src/services/drafts.js";
import { createDraftTimerService } from "../../src/services/draft-timer.js";
import { createTournamentService } from "@yugidraft/shared/services";
import { recordingTransport, createBroadcaster } from "@yugidraft/shared/notify";

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
  db.exec(`
    create table if not exists card_sets (
      set_name text primary key not null,
      synced_at text not null,
      card_count integer,
      set_code text
    );
  `);
  migrate(db);
  const updateStatusCalls: Array<{ draftId: number }> = [];

  return {
    db,
    players: createPlayerRepository(db),
    tournaments: createTournamentService(db),
    drafts: createDraftService(db),
    cards: createCardCatalogService(db),
    draftImages: createDraftImageService({ cacheDir: "./data/test-card-images" }),
    messenger: {
      async postStatus(_draft: { id: number }) {
        // no-op
      },
      async updateStatus(draft: { id: number }) {
        updateStatusCalls.push({ draftId: draft.id });
      },
    },
    updateStatusCalls,
  };
}

describe("draft timer service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires overdue picks and updates status", async () => {
    const app = setup();
    const yugi = app.players.upsert("guild-1", "user-7", "Yugi");
    const kaiba = app.players.upsert("guild-1", "user-9", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", {}, "user-7", yugi.id);
    app.drafts.join(draft.id, kaiba.id);
    seedDraftCatalog(app, 80);
    app.drafts.start(draft.id);

    const rec = recordingTransport();
    const broadcaster = createBroadcaster(rec.transport);
    const timer = createDraftTimerService({ drafts: app.drafts, messenger: app.messenger, broadcaster, lobby: { tick: () => ({ started: [], changedSlugs: [] }) } });
    const now = new Date(Date.now() + 60000); // 60s after start, past default 45s deadline

    await timer.tick(now);

    const updatedDraft = app.drafts.findById(draft.id);
    expect(updatedDraft.currentPickStep).toBe(2);
    expect(app.updateStatusCalls.length).toBeGreaterThanOrEqual(1);
    expect(rec.calls.length).toBeGreaterThanOrEqual(1);
    expect(rec.calls[0].path).toBe("/internal/draft/resync");
  });

  it("does not expire picks before deadline", async () => {
    const app = setup();
    const yugi = app.players.upsert("guild-1", "user-7", "Yugi");
    const kaiba = app.players.upsert("guild-1", "user-9", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", {}, "user-7", yugi.id);
    app.drafts.join(draft.id, kaiba.id);
    seedDraftCatalog(app, 80);
    app.drafts.start(draft.id);

    const rec = recordingTransport();
    const broadcaster = createBroadcaster(rec.transport);
    const timer = createDraftTimerService({ drafts: app.drafts, messenger: app.messenger, broadcaster, lobby: { tick: () => ({ started: [], changedSlugs: [] }) } });
    const now = new Date(Date.now() + 1000); // 1s after start, before 45s deadline

    await timer.tick(now);

    const updatedDraft = app.drafts.findById(draft.id);
    expect(updatedDraft.currentPickStep).toBe(1);
    expect(app.updateStatusCalls).toEqual([]);
    expect(rec.calls).toEqual([]);
  });

  it("recovers drafts on startup tick", async () => {
    const app = setup();
    const yugi = app.players.upsert("guild-1", "user-7", "Yugi");
    const kaiba = app.players.upsert("guild-1", "user-9", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", {}, "user-7", yugi.id);
    app.drafts.join(draft.id, kaiba.id);
    seedDraftCatalog(app, 80);
    app.drafts.start(draft.id);

    // Simulate bot being offline by not ticking
    const rec = recordingTransport();
    const broadcaster = createBroadcaster(rec.transport);
    const timer = createDraftTimerService({ drafts: app.drafts, messenger: app.messenger, broadcaster, lobby: { tick: () => ({ started: [], changedSlugs: [] }) } });
    const now = new Date(Date.now() + 300000); // 5 minutes after start

    await timer.tick(now);

    const updatedDraft = app.drafts.findById(draft.id);
    expect(updatedDraft.currentPickStep).toBeGreaterThan(1);
    expect(app.updateStatusCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("checks overdue drafts every second while running", () => {
    const app = setup();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    const rec = recordingTransport();
    const broadcaster = createBroadcaster(rec.transport);
    const timer = createDraftTimerService({ drafts: app.drafts, messenger: app.messenger, broadcaster, lobby: { tick: () => ({ started: [], changedSlugs: [] }) } });
    timer.start();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);

    timer.stop();
    setIntervalSpy.mockRestore();
  });
});


describe("pending lobby timer sweep", () => {
  it("sweeps with the injected clock before active expiry and announces only returned transitions", async () => {
    const app = setup();
    const host = app.players.upsert("guild-1", "user-7", "Yugi");
    const draft = app.drafts.create("guild-1", "channel-1", "Scheduled", {}, "user-7", host.id);
    const committed = { ...draft, status: "active" as const };
    const order: string[] = [];
    const instant = new Date("2026-10-07T15:00:00Z");
    const lobby = { tick: vi.fn(() => { order.push("lobby"); return { started: [committed], changedSlugs: [draft.webSlug!, "held-slug"] }; }) };
    vi.spyOn(app.drafts, "listActive").mockImplementation(() => { order.push("active"); return []; });
    const rec = recordingTransport();
    const onDraftStarted = vi.fn(async () => {});
    const timer = createDraftTimerService({ ...app, lobby, broadcaster: createBroadcaster(rec.transport), onDraftStarted, now: () => instant });

    await timer.tick();
    expect(lobby.tick).toHaveBeenCalledWith(instant);
    expect(order).toEqual(["lobby", "active"]);
    expect(rec.calls.map(c => [c.path, JSON.parse(c.body)])).toEqual([
      ["/internal/draft/seats", { slug: "held-slug" }],
      ["/internal/draft/status", { slug: draft.webSlug, status: "active" }],
    ]);
    expect(onDraftStarted).toHaveBeenCalledWith(draft.id);
    expect(app.updateStatusCalls).toEqual([{ draftId: draft.id }]);
    lobby.tick.mockReturnValue({ started: [], changedSlugs: [] });
    await timer.tick();
    expect(onDraftStarted).toHaveBeenCalledTimes(1);
    app.db.close();
  });

  it("still announces a committed start and expires picks when Discord status fails", async () => {
    const app = setup();
    const host = app.players.upsert("guild-1", "user-7", "Yugi");
    const draft = app.drafts.create("guild-1", "channel-1", "Scheduled", {}, "user-7", host.id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listActive = vi.spyOn(app.drafts, "listActive").mockReturnValue([]);
    const onDraftStarted = vi.fn(async () => {});
    const timer = createDraftTimerService({ ...app,
      lobby: { tick: () => ({ started: [{ ...draft, status: "active" }], changedSlugs: [] }) },
      messenger: { postStatus: vi.fn(), updateStatus: vi.fn().mockRejectedValue(new Error("Discord offline")) },
      broadcaster: createBroadcaster(recordingTransport().transport), onDraftStarted,
    });
    await timer.tick();
    expect(onDraftStarted).toHaveBeenCalledWith(draft.id);
    expect(listActive).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    app.db.close();
  });

  it("continues interval sweeps while an earlier notification is pending", async () => {
    const app = setup();
    const host = app.players.upsert("guild-1", "user-7", "Yugi");
    const draft = app.drafts.create("guild-1", "channel-1", "Scheduled", {}, "user-7", host.id);
    let finish!: () => void;
    let entered!: () => void;
    const statusEntered = new Promise<void>(resolve => { entered = resolve; });
    const lobby = { tick: vi.fn().mockReturnValueOnce({ started: [{ ...draft, status: "active" as const }], changedSlugs: [] }).mockReturnValue({ started: [], changedSlugs: [] }) };
    const timer = createDraftTimerService({ ...app, lobby,
      messenger: { postStatus: vi.fn(), updateStatus: () => new Promise<void>(resolve => { finish = resolve; entered(); }) },
      broadcaster: createBroadcaster(recordingTransport().transport),
    });
    const first = timer.tick();
    await statusEntered;
    await timer.tick();
    expect(lobby.tick).toHaveBeenCalledTimes(2);
    finish();
    await first;
    app.db.close();
  });
  it("continues overdue active picks after a pending sweep failure", async () => {
    const app = setup();
    const host = app.players.upsert("guild-1", "user-7", "Yugi");
    const guest = app.players.upsert("guild-1", "user-9", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "Active", {}, "user-7", host.id);
    app.drafts.join(draft.id, guest.id);
    seedDraftCatalog(app, 80);
    app.drafts.start(draft.id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const timer = createDraftTimerService({ ...app,
        lobby: { tick: () => { throw new Error("Pending preflight unavailable"); } },
        broadcaster: createBroadcaster(recordingTransport().transport),
      });
      await timer.tick(new Date(Date.now() + 60_000));
      expect(app.drafts.findById(draft.id).currentPickStep).toBe(2);
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); app.db.close(); }
  });

  it("bounds stalled delivery and expires active picks before transport I/O", async () => {
    vi.useFakeTimers();
    const app = setup();
    const host = app.players.upsert("guild-1", "user-7", "Yugi");
    const guest = app.players.upsert("guild-1", "user-9", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "Active", {}, "user-7", host.id);
    app.drafts.join(draft.id, guest.id);
    seedDraftCatalog(app, 80);
    app.drafts.start(draft.id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const timer = createDraftTimerService({ ...app,
      lobby: { tick: () => ({ started: [], changedSlugs: ["pending-lobby"] }) },
      broadcaster: { draft: () => new Promise(() => {}) } as any,
    });
    try {
      const tick = timer.tick(new Date(Date.now() + 60_000));
      expect(app.drafts.findById(draft.id).currentPickStep).toBe(2);
      await vi.advanceTimersByTimeAsync(15_000);
      await tick;
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); vi.useRealTimers(); app.db.close(); }
  });

});
