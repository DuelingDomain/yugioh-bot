// @vitest-environment jsdom
import React, { useState } from "react";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { migrate } from "../../shared/src/db/schema";
import { importCardEffectArtifact } from "../../shared/src/cards/effects/artifact";
import { DescribePane } from "../src/components/effect-search/describe-pane";
import { EMPTY_BATCH } from "../src/components/effect-search/selection";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, fallback: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@yugidraft/shared/cards/effects/reading-fallback", () => ({ fallbackEffectReading: state.fallback }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(vi.fn().mockResolvedValue({ user: { id: "123", name: "Yugi", discordUserId: null } }));
});

beforeAll(() => {
  state.db = new Database(":memory:"); migrate(state.db); importCardEffectArtifact(state.db);
  const insert = state.db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at) VALUES(?,?,?,?,?,'image','small','[]','now')`);
  insert.run(80101899, "Trap Trick", "Trap Card", "trap", "Banish 1 Normal Trap from your Deck, and Set 1 card with the same name directly from your Deck.");
  insert.run(8240199, "Sage with Eyes of Blue", "Effect Monster", "effect", 'Special Summon 1 "Blue-Eyes" monster from your Deck.');
});
afterAll(() => state.db?.close());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("renders separate Describe lists through the real resolver and keeps selection working", async () => {
  vi.stubEnv("DISCORD_GUILD_ID", "synergy-describe");
  vi.stubEnv("EFFECT_SEARCH", "1");
  vi.stubEnv("DUEL_DATA_DIR", "/tmp/no-synergy-describe-engine");
  const { POST } = await import("../app/api/cards/resolve/route");
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => POST(new Request("http://local/api/cards/resolve", init)));
  function Pane() {
    const [batch, setBatch] = useState(EMPTY_BATCH);
    return <><DescribePane batch={batch} onBatch={setBatch} held={() => 0} kindLine={card => card.type} /><output>{batch.cards.size} selected</output></>;
  }
  render(<Pane />);
  const input = screen.getByRole("combobox", { name: "Describe the cards" });
  fireEvent.change(input, { target: { value: "synergy with Temple of the Kings and Blue-Eyes" } });
  expect(await screen.findByRole("heading", { name: "Works with Temple of the Kings" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Archetype cards — Blue-Eyes" })).toBeVisible();
  expect(screen.getByText("No shared synergy found. Suggestions for each archetype:")).toBeVisible();
  expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(2);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByText("2 selected")).toBeVisible();
  expect(state.fallback).not.toHaveBeenCalled();
});

it("groups a named anchor and outside partners through the resolver without breaking selection", async () => {
  vi.stubEnv("DISCORD_GUILD_ID", "synergy-describe");
  vi.stubEnv("EFFECT_SEARCH", "1");
  vi.stubEnv("DUEL_DATA_DIR", "/tmp/no-synergy-describe-engine");
  state.db!.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
    VALUES(29762407,'Temple of the Kings','Spell Card','spell','You can activate 1 Trap Card the turn it was Set.','image','small','[]','now')`).run();
  try {
    const { POST } = await import("../app/api/cards/resolve/route");
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => POST(new Request("http://local/api/cards/resolve", init)));
    function Pane() {
      const [batch, setBatch] = useState(EMPTY_BATCH);
      return <><DescribePane batch={batch} onBatch={setBatch} held={() => 0} kindLine={card => card.type} /><output>{batch.cards.size} selected</output></>;
    }
    render(<Pane />);
    const input = screen.getByRole("combobox", { name: "Describe the cards" });
    fireEvent.change(input, { target: { value: "Temple of the Kings synergy" } });
    expect(await screen.findByRole("heading", { name: "Archetype cards" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Works with" })).toBeVisible();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2 selected")).toBeVisible();
  } finally { state.db!.prepare("DELETE FROM card_catalog WHERE ygoprodeck_id=29762407").run(); }
});
