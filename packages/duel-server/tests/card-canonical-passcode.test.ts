import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { OcgLocation, OcgPosition } from "ocgcore-wasm";
import { loadCardDatabase, type CardDatabase } from "../src/cards.js";
import * as merged from "../src/views.js";
import * as legacy from "../src/legacy/views.js";

let directory: string;
let cards: CardDatabase;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "canonical-passcode-"));
  mkdirSync(join(directory, "card-scripts"));
  writeFileSync(join(directory, "strings.conf"), "");
  const db = new Database(join(directory, "cards.cdb"));
  try {
    db.exec(`
      CREATE TABLE datas (id integer primary key, ot integer, alias integer, setcode integer, type integer,
        atk integer, def integer, level integer, race integer, attribute integer);
      CREATE TABLE texts (id integer primary key, name text, desc text);
      INSERT INTO datas VALUES
        (10,3,11,0,17,1000,1000,4,1,1), (11,3,12,0,17,1000,1000,4,1,1),
        (12,3,0,0,17,1000,1000,4,1,1), (20,3,12,0,17,1000,1000,4,1,1),
        (30,3,12,0,33,1000,1000,4,1,1), (40,3,41,0,17,1000,1000,4,1,1),
        (41,3,40,0,17,1000,1000,4,1,1), (50,3,999,0,17,1000,1000,4,1,1);
      INSERT INTO texts VALUES (10,' dragon ',''), (11,'Dragon',''), (12,'Dragon',''),
        (20,'Other Dragon',''), (30,'Dragon',''), (40,'Cycle',''), (41,'Cycle',''), (50,'Orphan','');
    `);
  } finally { db.close(); }
  cards = loadCardDatabase(directory);
});
afterAll(() => {
  cards?.close();
  rmSync(directory, { recursive: true, force: true });
});

it("exposes canonical artwork identity without replacing the selected passcode", () => {
  for (const code of [10, 11, 12, 20, 30, 40, 41, 50]) {
    const expected = { code, canonicalPasscode: code <= 12 ? 12 : code };
    expect(cards.get(code)).toMatchObject(expected);
    expect(cards.search(String(code))[0]).toMatchObject(expected);
    expect(cards.deckCard(code)).toMatchObject(expected);
    expect([...cards.all()].find(card => card.code === code)).toMatchObject(expected);
  }
  expect(cards.get(999)).toBeUndefined();
});

it.each([
  ["legacy", "1v1", legacy], ["pinned", "1v1", merged], ["multi", "ffa3", merged],
] as const)("%s projects canonical identity only for visible cards", (_engine, format, views) => {
  const count = seatCountFor(format);
  for (const viewer of [0, null]) {
    const view = views.projectView({
      lib: {
        duelQueryField: () => ({ players: Array(count).fill({ deck_size: 20, extra_size: 0 }), chain: [] }),
        duelQueryCount: () => 20,
        duelQueryLocation: (_handle: unknown, { location }: { location: number }) =>
          location === OcgLocation.HAND ? [{ code: 10, position: OcgPosition.FACEDOWN_DEFENSE }]
            : location === OcgLocation.MZONE ? [{ code: 10, position: OcgPosition.FACEUP_ATTACK, overlayCards: [11] },
              { code: 12, position: OcgPosition.FACEUP_ATTACK }]
              : [],
      } as never,
      handle: {} as never, cards, viewer, format,
      revision: 1, turn: 1, turnSeat: 0, phase: "main1", lp: Array(count).fill(8000) as [number, number],
      prompt: null, promptSeat: null, result: null, mode: "domain", reveals: views.createRevealMap(count),
      domainState: Array.from({ length: count }, () => ({ code: 10, inZone: true, returns: 0, nextCost: 0 })),
      events: [], log: [],
    });
    expect(view.seats).toHaveLength(count);
    for (const seat of view.seats) {
      expect(seat.monsters[0]).toMatchObject({ code: 10, canonicalPasscode: 12 });
      expect(seat.monsters[0]?.materials?.[0]).toMatchObject({ code: 11, canonicalPasscode: 12 });
      expect(seat.monsters[1]).toMatchObject({ code: 12, canonicalPasscode: 12 });
      expect(seat.deckMaster?.card).toMatchObject({ code: 10, canonicalPasscode: 12 });
      if (viewer === seat.seat) {
        expect(seat.hand[0]).toMatchObject({ code: 10, canonicalPasscode: 12 });
      } else {
        expect(seat.hand[0]).not.toHaveProperty("code");
        expect(seat.hand[0]).not.toHaveProperty("canonicalPasscode");
      }
    }
  }
});
