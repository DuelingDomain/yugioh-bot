import Database from "better-sqlite3";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { defaultDuelSettings, seatCountFor, type DuelDeck, type DuelDeckValidation, type DuelRoom } from "@yugidraft/shared/duels";
import { signedRequestHeaders } from "@yugidraft/shared/internal-auth";
import { createDuelService } from "@yugidraft/shared/services";
import { banlistLimitsFor } from "../src/banlists/index.js";
import { MULTIPLAYER_FORBIDDEN } from "../src/banlists/multiplayer.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { seedIdentity } from "./helpers/identity.js";
import { describeWithCores, needs } from "./support/cores.js";
import { createTestDuelHost, finishTestDiceOpening } from "./support/test-opening.js";

const PIECES = [33396948, 7902349, 8124921, 44519536, 70903634];
const MASTER = 48305365; // EARTH Warrior Axe Raider shares no Domain with the DARK Spellcaster pieces.
const SECRET = "domain-exodia-integration";
const BANLIST = "tcg-2026-10-19";

function decks(): DuelDeck[] {
  const catalog = new Database(join(DATA, "cards.cdb"), { readonly: true, fileMustExist: true });
  try {
    const forbidden = new Set(MULTIPLAYER_FORBIDDEN.map(card => card.code));
    const limits = banlistLimitsFor(BANLIST)!;
    const rows = catalog.prepare(`SELECT id FROM datas JOIN texts USING(id)
      WHERE type & 2 != 0 AND type & 1 = 0 AND alias = 0 AND (ot & 3) = 3
        AND desc NOT LIKE '%always treated as%' ORDER BY id`).all() as { id: number }[];
    const filler = rows.map(card => card.id).filter(code => !forbidden.has(code) && limits[code] !== 0).slice(0, 60);
    expect(filler).toHaveLength(60);
    return [
      { main: [...PIECES, ...filler.slice(0, 55)], extra: [], side: [], deckMaster: MASTER },
      { main: filler, extra: [], side: [], deckMaster: MASTER },
    ];
  } finally { catalog.close(); }
}

const tables = [
  { format: "1v1", engine: "legacy" }, { format: "1v1", engine: "pinned" },
  { format: "ffa3", engine: "pinned" }, { format: "ffa4", engine: "pinned" }, { format: "tag", engine: "pinned" },
] as const;

describeWithCores("Exodia Domain admission through the real host and engine", [needs.cards(DATA), needs.domain(DATA),
  needs.file("legacy Domain core", join(DATA, "ocgcore.domain.legacy.wasm")), needs.installedMulti(DATA),
  ...needs.domainMulti(DATA, join(DATA, "ocgcore.multi-domain.wasm"))], () => {
  it.each(tables.flatMap(table => [false, true].map(genesys => ({ ...table, genesys }))))(
    "$format $engine (Genesys: $genesys): editor, saved deck and start accept all five singleton pieces",
    async ({ format, engine, genesys }) => {
      vi.stubEnv("DUEL_1V1_ENGINE", engine);
      const db = new Database(":memory:"); migrate(db);
      const [winningDeck, otherDeck] = decks();
      const actors = Array.from({ length: seatCountFor(format) }, (_, seat) => seedIdentity(db, { userId: 100 + seat }));
      const service = createDuelService(db);
      const settings = { ...defaultDuelSettings("domain", format), banlist: BANLIST, shuffleDeck: false, turnSeconds: 0,
        ...(genesys ? { genesys: { pointCap: 100 } } : {}) };
      // A current, known points snapshot isolates Domain membership from Genesys point admission.
      db.prepare("INSERT INTO genesys_points_meta VALUES(1, 'exodia-fixture', '2026-10-05', 'fixture', CURRENT_TIMESTAMP)").run();
      const insert = db.prepare(`INSERT INTO card_catalog (ygoprodeck_id, name, type, frame_type, image_url,
        image_url_small, card_sets_json, cached_at, genesys_points, genesys_revision)
        VALUES(?, ?, 'Normal Monster', 'normal', '', '', '[]', CURRENT_TIMESTAMP, 0, 'exodia-fixture')`);
      for (const code of new Set([...winningDeck!.main, ...otherDeck!.main, MASTER, 94212438, 49003308])) insert.run(code, `Card ${code}`);
      const session = service.create({ guildId: "g", organizerPlayerId: actors[0]!.playerId,
        name: "Domain Exodia", mode: "domain", format, settings });
      for (const actor of actors.slice(1)) service.takeSeat(session.slug, "g", actor.playerId);
      const host = createTestDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000 });
      async function post<T>(body: Record<string, unknown>, seat = 0): Promise<{ status: number; data: T }> {
        const raw = JSON.stringify({ guildId: "g", slug: session.slug, ...actors[seat], ...body });
        const url = "http://localhost/internal/duel";
        const response = await host.handle(new Request(url, { method: "POST", body: raw,
          headers: signedRequestHeaders({ url, method: "POST", body: raw, secret: SECRET, purpose: "duel-host" }) }));
        return finishTestDiceOpening(host, { ...body, slug: session.slug },
          { status: response.status, data: await response.json() as T }, next => post<T>(next, seat));
      }
      const check = async (deck: DuelDeck, mode = "domain") => {
        const { firstTurnDraw: _domainDraw, ...normalSettings } = settings;
        const result = await post<{ report: DuelDeckValidation }>({ op: "check-deck", mode, format,
          settings: mode === "normal" ? normalSettings : settings, deck });
        expect(result.status, JSON.stringify(result.data)).toBe(200);
        return result.data.report.issues;
      };
      try {
        // Standard already allows these cards; Domain must allow the same five copies.
        const { deckMaster: _master, ...normal } = winningDeck!;
        expect(await check(normal, "normal")).toEqual([]);
        expect(await check(winningDeck!)).toEqual([]);
        expect((await post<DuelDeckValidation>({ op: "validate-deck", deck: winningDeck })).data.issues).toEqual([]);
        const scope = await post<{ allowed: number[] }>({ op: "suggestion-scope", deckMaster: MASTER,
          suggestionFormat: genesys ? "genesys-domain" : "domain", banlist: BANLIST });
        expect(scope.status).toBe(200);
        expect(scope.data.allowed).toEqual(expect.arrayContaining(PIECES));
        expect(scope.data.allowed).not.toContain(49003308); // Unrelated WATER Reptile still needs a Domain match.
        for (const code of PIECES) {
          const duplicate = { ...winningDeck!, main: [...winningDeck!.main.slice(0, -1), code] };
          expect((await check(duplicate)).some(issue => issue.cards.some(card => card.code === code) && /Duplicate|at most 1/.test(issue.message))).toBe(true);
          const master = { ...winningDeck!, main: [...winningDeck!.main.filter(card => card !== code), otherDeck!.main[59]!], deckMaster: code };
          expect(await check(master)).toEqual([]);
        }
        const destinyBoard = { ...winningDeck!, main: [94212438, ...winningDeck!.main.slice(1)] };
        expect((await check(destinyBoard)).some(issue => /forbidden in/.test(issue.message))).toBe(format !== "1v1");
        for (let seat = 0; seat < actors.length; seat++) {
          const saved = await post({ op: "deck", deck: seat === 0 ? winningDeck : otherDeck }, seat);
          expect(saved.status, JSON.stringify(saved.data)).toBe(200);
        }
        const started = await post<DuelRoom>({ op: "start" });
        expect(started.status, JSON.stringify(started.data)).toBe(200);
        const finished = await post<DuelRoom>({ op: "view" });
        expect(finished.data.session).toMatchObject({ status: "completed", winnerSeat: 0 });
        expect(finished.data.engine?.result).toMatchObject({ winnerSeat: 0,
          reason: 'Victory by the effect of "Exodia the Forbidden One"' });
        if (format !== "1v1") expect(finished.data.engine?.result).toMatchObject({ victory: "exodia" });
      } finally { await host.close(); db.close(); vi.unstubAllEnvs(); }
    }, 30_000);
});
