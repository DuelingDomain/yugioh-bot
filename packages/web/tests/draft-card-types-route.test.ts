import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDraftDeck } from "./helpers/draft-deck-fixture";

const callDuelHost = vi.fn();
const dirs: string[] = [];
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/duel-host", () => ({ callDuelHost }));

const QUICK_PLAY_SPELL = 0x2 | 0x10000;
const COUNTER_TRAP = 0x4 | 0x100000;

function engine(cards: Record<number, { type: number; race: string }>) {
  callDuelHost.mockImplementation(async (input: { op: string; codes: number[] }) => {
    if (input.op === "card-details") {
      return {
        ok: true,
        data: {
          cards: input.codes.filter((c) => cards[c]).map((code) => ({ code, ...cards[code] })),
          missing: input.codes.filter((c) => !cards[c]),
        },
      };
    }
    return { ok: true, data: { codes: Object.fromEntries(input.codes.map((id) => [String(id), null])) } };
  });
}

async function draftWith(picks: number[]) {
  vi.stubEnv("DATABASE_PATH", process.env.DATABASE_PATH);
  vi.stubEnv("DISCORD_GUILD_ID", process.env.DISCORD_GUILD_ID);
  const fixture = await seedDraftDeck({ picks });
  dirs.push(fixture.dir);
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(join(fixture.dir, "test.sqlite"));
  db.prepare("update card_catalog set type = 'Spell Card', frame_type = 'spell' where ygoprodeck_id = 12").run();
  db.prepare("update card_catalog set type = 'Trap Card', frame_type = 'trap' where ygoprodeck_id = 13").run();
  db.close();
  return fixture;
}

describe("draft card types from the duel engine", () => {
  beforeEach(() => {
    vi.resetModules();
    callDuelHost.mockReset();
  });
  afterEach(async () => {
    if (dirs.length) {
      const { getDb } = await import("../src/lib/db");
      getDb().close();
    }
    vi.unstubAllEnvs();
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("sends the monster type and the spell or trap kind with each card, in one batched call", async () => {
    await draftWith([11, 12, 13]);
    engine({
      11: { type: 0x1 | 0x20, race: "Spellcaster" },
      12: { type: QUICK_PLAY_SPELL, race: "unknown" },
      13: { type: COUNTER_TRAP, race: "unknown" },
    });
    const { buildDraftResponse } = await import("../app/api/drafts/[slug]/helpers");

    const response = await buildDraftResponse("slug-1", "drafter");

    expect(response?.myPool).toMatchObject([
      { passcode: 11, race: "Spellcaster", spellTrapType: null },
      { passcode: 12, race: null, spellTrapType: "Quick-Play" },
      { passcode: 13, race: null, spellTrapType: "Counter" },
    ]);
    expect(callDuelHost).toHaveBeenCalledTimes(1);
    expect(callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "card-details", codes: [11, 12, 13] }));

    await buildDraftResponse("slug-1", "drafter");
    expect(callDuelHost).toHaveBeenCalledTimes(1);
  });

  it("still loads the room when the duel engine cannot be reached; cards just carry no types", async () => {
    await draftWith([11, 12]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    callDuelHost.mockResolvedValue({ ok: false, response: { status: 503 } });
    const { buildDraftResponse } = await import("../app/api/drafts/[slug]/helpers");

    const response = await buildDraftResponse("slug-1", "drafter");

    expect(response?.myPool).toMatchObject([
      { passcode: 11, race: null, spellTrapType: null },
      { passcode: 12, race: null, spellTrapType: null },
    ]);
    expect(response?.myPool[0]).toMatchObject({ name: "Card 11" });
    warn.mockRestore();
  });
});
