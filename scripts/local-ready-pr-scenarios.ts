/**
 * Local review fixtures. This script never loads .env, migrates a database, creates
 * identities, or replaces unrelated scenarios. See docs/testing/local-ready-pr-scenarios.md.
 */
import Database from "better-sqlite3";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  parseSandboxBoard,
  parseSandboxRun,
  type SandboxBoard,
  type SandboxDuelistSetup,
  type SandboxRun,
} from "../packages/shared/src/duels/sandbox-board.js";
import { createSandboxScenarioService } from "../packages/shared/src/services/sandbox-scenarios.js";
import { validateRuntimeBoard } from "../packages/duel-server/src/presets/runtime-board.js";

const OWNER_DISCORD_ID = "196382407044235264";
const PREFIX = "Local PR review | ";
const C = {
  elf: 15025844, ox: 5053103, celtic: 91152256, axe: 48305365, beaver: 32452818,
  blueEyes: 89631139, redEyes: 74677422, magician: 46986414, skull: 70781052,
  silverFang: 90357090, stone: 13039848, neo: 50930991, laJinn: 97590747,
  battleWarrior: 55550921, doriado: 62312469, greed: 55144522,
  harpie: 76812113, aqua: 85639257, flame: 34460851,
  honest: 37742478, alexandrite: 43096270, chicken: 67616300,
  tarantula: 90162951, nightExpress: 51126152, bulletTrain: 52481437,
  cyberDragon: 70095154, myriad: 81758313, coordius: 70219023,
  stardust: 44508094, utopia: 84013237, spider: 98978921, poly: 24094653,
  pig: 46497537, slash: 25334372,
} as const;

// Forty real, script-free Normal Monsters; no compiler filler or empty Decks.
const FIXED_DECK = [
  C.elf, C.ox, C.celtic, C.axe, C.beaver, C.blueEyes, C.redEyes,
  C.magician, C.skull, C.silverFang, C.stone, C.neo, C.laJinn,
].flatMap<number>(code => [code, code, code]).concat(C.battleWarrior);

function deck(top: number[] = []): number[] {
  const rest = [...FIXED_DECK];
  for (const code of top) {
    const index = rest.indexOf(code);
    if (index >= 0) rest.splice(index, 1);
  }
  return [...top, ...rest].slice(0, 40);
}

function board(input: SandboxBoard): SandboxBoard {
  const count = input.format === "ffa3" ? 3 : input.format === "ffa4" || input.format === "tag" ? 4 : 2;
  const result: SandboxBoard = {
    mode: "normal", masterRule: 5, turn: "p0", startAt: "main1",
    attackFirstTurn: true, deckSize: 40, ...input,
  };
  for (let seat = 0; seat < count; seat++) {
    const id = `p${seat}` as "p0" | "p1" | "p2" | "p3";
    result[id] = { deck: deck(), ...input[id] };
  }
  return parseSandboxBoard(result);
}

const MANUAL: SandboxRun = parseSandboxRun({
  bots: { "1": "manual", "2": "manual", "3": "manual" },
  seed: ["1", "2", "3", "4"],
});

export interface LocalReadyScenario {
  name: string;
  board: SandboxBoard;
  run: SandboxRun;
}

function scenario(name: string, input: SandboxBoard): LocalReadyScenario {
  return { name: PREFIX + name, board: board(input), run: structuredClone(MANUAL) };
}

function statsSeat(attack: number, defense: number): SandboxDuelistSetup {
  return { monsters: [{ card: attack, pos: "atk" }, { card: defense, pos: "def" }] };
}

/** Names are the stable upsert keys, scoped to the existing owner's guild/player. */
export const LOCAL_READY_PR_SCENARIOS: LocalReadyScenario[] = [
  scenario("Chicken Game FFA4 mixed LP protection #458", {
    format: "ffa4", turn: "p1", startAt: "battle",
    p0: { lp: 7000 },
    p1: { lp: 8000, monsters: [C.redEyes, C.redEyes] },
    p2: { lp: 7000, field: C.chicken },
    p3: { lp: 1850 },
  }),
  scenario("Dark Doriado non-inverse topdeck order #457", {
    format: "1v1",
    p0: {
      hand: [C.doriado, C.greed, C.greed],
      // The opening draw consumes Magician, leaving all four named choices in Deck.
      deck: deck([C.magician, C.silverFang, C.harpie, C.aqua, C.flame]),
    },
  }),
  scenario("Honest Auto Damage Step #455", {
    format: "1v1", startAt: "battle",
    p0: { monsters: [C.blueEyes] },
    p1: { hand: [C.honest], monsters: [C.alexandrite] },
  }),
  scenario("Tarantula FFA4 summon opponent choice #464", {
    format: "ffa4",
    p0: { lp: 5000, monsters: [C.nightExpress, C.bulletTrain], extra: [C.tarantula] },
    p1: { lp: 7000, monsters: [C.ox] },
    p2: { lp: 10000, monsters: [C.celtic] },
    p3: { lp: 12000 },
  }),
  scenario("Tarantula FFA4 remembered-opponent burn #464", {
    // Keep Draw as the starting phase: Tarantula's initial choice must be answered
    // before a phase walk. Starting at Main 1 would stop on that choice anyway.
    format: "ffa4", startAt: "draw",
    p0: { lp: 5000, monsters: [{ card: C.tarantula, materials: [C.elf] }] },
    p1: { lp: 7000, hand: [C.cyberDragon] },
    p2: { lp: 10000, hand: [C.cyberDragon] },
    p3: { lp: 12000 },
  }),
  scenario("Myriaday FFA4 chosen LP counters #464", {
    format: "ffa4", p0: { lp: 5000, monsters: [C.myriad] },
    p1: { lp: 7000 }, p2: { lp: 10000 }, p3: { lp: 12000 },
  }),
  scenario("Coordius FFA4 destruction and post-cost ATK #464", {
    format: "ffa4",
    p0: { lp: 20000, hand: [C.poly], monsters: [C.stardust, C.utopia, C.spider], extra: [C.coordius] },
    p1: { lp: 22000, monsters: [C.ox, C.celtic, C.elf] },
    p2: { lp: 26000, monsters: [C.blueEyes, C.axe, C.beaver] },
    p3: { lp: 12000 },
  }),
  scenario("Pig Iron FFA4 equal-LP opponents #464", {
    format: "ffa4", p0: { lp: 5000, grave: [C.pig] },
    p1: { lp: 5000 }, p2: { lp: 5000 }, p3: { lp: 12000 },
  }),
  scenario("Tsukumo Slash FFA4 actual defender LP #464", {
    format: "ffa4", startAt: "battle",
    p0: { lp: 5000, monsters: [C.ox], spells: [{ card: C.slash, pos: "set" }] },
    p1: { lp: 7000, monsters: [C.blueEyes] },
    p2: { lp: 10000 }, p3: { lp: 12000 },
  }),
  scenario("Honest FFA4 turned rival seat #460", {
    format: "ffa4", startAt: "battle",
    p0: { monsters: [C.axe] },
    p1: { monsters: [C.celtic] },
    p2: { hand: [C.honest], monsters: [C.elf] },
    p3: { hand: [C.honest], monsters: [C.elf] },
  }),
  ...(["ffa3", "ffa4", "tag"] as const).map(format => scenario(`Visible monster ATK DEF ${format.toUpperCase()} #462`, {
    format,
    p0: statsSeat(C.ox, C.elf),
    p1: statsSeat(C.blueEyes, C.celtic),
    p2: statsSeat(C.axe, C.stone),
    ...(format !== "ffa3" ? { p3: statsSeat(C.redEyes, C.beaver) } : {}),
  })),
  scenario("FFA4 eliminate to two and click movement #463", {
    format: "ffa4",
    p0: { hand: [C.ox], monsters: [C.axe] },
    p1: { monsters: [C.celtic] },
    p2: { hand: [C.elf], monsters: [C.blueEyes] },
    p3: { monsters: [C.beaver] },
  }),
];

function explicitPath(variable: "DATABASE_PATH" | "DUEL_DATA_DIR"): string {
  const value = process.env[variable];
  if (!value || !isAbsolute(value)) throw new Error(`${variable} must explicitly name an existing absolute local path; there is no default.`);
  return realpathSync(value);
}

/** Catalog and compiler validation only: no application DB is opened. */
export function validateLocalReadyScenarios(): void {
  const dataDirectory = explicitPath("DUEL_DATA_DIR");
  const names = new Set<string>();
  for (const fixture of LOCAL_READY_PR_SCENARIOS) {
    if (names.has(fixture.name) || fixture.name.length > 80) throw new Error(`Invalid or duplicate fixture name: ${fixture.name}`);
    names.add(fixture.name);
    parseSandboxRun(fixture.run);
    const result = validateRuntimeBoard(fixture.board, dataDirectory);
    if (!result.ok) throw new Error(`${fixture.name}: ${result.errors.map(error => `${error.path}: ${error.message}`).join("; ")}`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== "--validate" && arg !== "--help")) {
    throw new Error("Usage: local-ready-pr-scenarios.ts [--validate|--help]");
  }
  if (args[0] === "--help") {
    console.log("Seed only the named local review sandbox scenarios for the existing owner's player.\nRequires explicit DATABASE_PATH and DUEL_DATA_DIR. Optional DISCORD_GUILD_ID disambiguates guilds.\n--validate checks the boards/catalog/compiler without opening the application database.");
    return;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Local review seeding is disabled when NODE_ENV=production.");
  validateLocalReadyScenarios();
  if (args[0] === "--validate") {
    console.log(`Validated ${LOCAL_READY_PR_SCENARIOS.length} local review scenarios; application database was not opened.`);
    return;
  }

  const db = new Database(explicitPath("DATABASE_PATH"), { fileMustExist: true });
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    const guildId = process.env.DISCORD_GUILD_ID ?? null;
    const owners = db.prepare<[string, string | null, string | null], { id: number; guild_id: string }>(`
      select p.id, p.guild_id from players p join users u on u.id = p.user_id
      where u.discord_user_id = ? and (? is null or p.guild_id = ?)
      order by p.id
    `).all(OWNER_DISCORD_ID, guildId, guildId);
    if (owners.length !== 1) throw new Error(`Expected exactly one existing owner player, found ${owners.length}. Sign in as the owner first; set DISCORD_GUILD_ID if the owner belongs to multiple guilds.`);
    const owner = owners[0]!;
    const service = createSandboxScenarioService(db);
    const preserved = db.prepare("select * from sandbox_scenarios where id between 1 and 4 order by id");
    const output = db.transaction(() => {
      const before = JSON.stringify(preserved.all());
      const rows = service.list(owner.guild_id).filter(row => row.ownerPlayerId === owner.id);
      const saved = LOCAL_READY_PR_SCENARIOS.map(fixture => {
        const matches = rows.filter(row => row.name === fixture.name);
        if (matches.length > 1) throw new Error(`Duplicate named owner scenarios require manual review: ${fixture.name}`);
        const existing = matches[0];
        if (existing && existing.id <= 4) throw new Error(`Refusing to replace protected /sandbox/${existing.id}.`);
        const unchanged = existing && JSON.stringify(existing.board) === JSON.stringify(fixture.board)
          && JSON.stringify(existing.run) === JSON.stringify(fixture.run);
        const result = unchanged ? existing : existing
          ? service.update(existing.id, owner.guild_id, owner.id, fixture)
          : service.create(owner.guild_id, owner.id, fixture);
        return { id: result.id, status: unchanged ? "unchanged" : existing ? "updated" : "created", name: result.name };
      });
      if (JSON.stringify(preserved.all()) !== before) throw new Error("Protected scenarios 1–4 changed; rolling back.");
      return saved;
    }).immediate();
    for (const row of output) console.log(`${row.status.padEnd(9)} http://localhost:3000/sandbox/${row.id}  ${row.name}`);
  } finally {
    db.close();
  }
}

// Exporting fixtures for read-only validation must not run the seeder.
if (typeof require !== "undefined" && require.main === module) {
  try { main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
