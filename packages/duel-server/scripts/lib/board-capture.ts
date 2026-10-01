/**
 * Pure helpers: turn the engine views of a replayed duel into a Layer 1 `BoardSpec`, and print a scenario file.
 * No engine access here. `describe` maps a passcode to a card name (or undefined when the catalog has no entry).
 */
import type { DuelCard, DuelDeck, DuelEngineView, DuelEvent, DuelFormat, DuelMasterRule, DuelMode } from "@yugidraft/shared/duels";
import type { BoardSpec, CardEntry, CardSpec, DuelistSetup } from "../../tests/support/board.js";
import { FILLER_CARD } from "../../tests/support/board.js";

const LOC = { deck: 0x01, hand: 0x02, mzone: 0x04, szone: 0x08, grave: 0x10, banished: 0x20, extra: 0x40 } as const;
const TYPE = { spell: 0x2, trap: 0x4, continuous: 0x20000, equip: 0x40000, field: 0x80000, pendulum: 0x1000000, xyz: 0x800000 } as const;

export interface CardLookup {
  /** The catalog card for a passcode, or null when the DSL cannot place it (token, alias, unknown). */
  describe(code: number): { name: string; unique: boolean } | null;
}

/** A Layer 1 board, widened for 3 and 4 seats (the preset board format: `format`, `p2`, `p3`). */
export type NBoardSpec = BoardSpec & { format?: DuelFormat; p2?: DuelistSetup; p3?: DuelistSetup };

const SEAT_IDS = ["p0", "p1", "p2", "p3"] as const;

export interface CaptureSource {
  /** One view per seat (2 to 4), read with that seat as the viewer (a seat sees all of its own cards). */
  seats: DuelEngineView[];
  /** Table format. Default "1v1". Written to the board when it is not "1v1". */
  format?: DuelFormat;
  /** The spectator view. Only the event list is used. */
  spectator?: DuelEngineView;
  mode: DuelMode;
  masterRule: DuelMasterRule;
  /** The decks the duel started with. Used to name the Deck content. */
  decks?: Array<DuelDeck | null>;
}

export interface Capture {
  board: NBoardSpec;
  warnings: string[];
  /** Name, or code when the name is not unique, for every code used. */
  labels: Map<number, string>;
  /** What the replayed state looks like, for the header comment. */
  summary: { turn: number; phase: string; turnSeat: number; prompt: string | null };
}

const isMonsterLocationFaceDown = (position: number) => (position & 0x0a) !== 0;

function take(pool: number[], code: number): boolean {
  const at = pool.indexOf(code);
  if (at < 0) return false;
  pool.splice(at, 1);
  return true;
}

export function captureBoard(source: CaptureSource, lookup: CardLookup): Capture {
  const warnings: string[] = [];
  const labels = new Map<number, string>();
  const placeable = (code: number | undefined, where: string): code is number => {
    if (code == null) {
      warnings.push(`${where}: a card has no visible code. It is skipped.`);
      return false;
    }
    const info = lookup.describe(code);
    if (!info) {
      warnings.push(`${where}: card ${code} is not in the card catalog (token or alias). It is skipped.`);
      return false;
    }
    labels.set(code, info.unique ? info.name : String(code));
    return true;
  };
  const ref = (code: number) => (lookup.describe(code)?.unique ? lookup.describe(code)!.name : code);

  const { mode, masterRule } = source;
  const seatCount = source.seats.length;
  if (seatCount < 2 || seatCount > 4) throw new Error(`captureBoard needs 2 to 4 seat views, got ${seatCount}`);
  const seatList = Array.from({ length: seatCount }, (_, seat) => seat);
  const board: NBoardSpec = { mode, masterRule, deckSize: 1 };
  if (source.format && source.format !== "1v1") board.format = source.format;
  const view = source.seats[0]!;
  const turn = view.turn;
  board.turn = SEAT_IDS[Math.min(Math.max(view.turnSeat, 0), seatCount - 1)]!;
  if (seatCount === 2 && turn > 1 && board.turn === "p0") board.attackFirstTurn = true;

  const leftovers: number[][] = seatList.map(() => []);
  const remainders: Array<{ main: number[]; extra: number[] }> = [];
  let deckSize = 0;
  const deckCounts: number[] = [];

  for (const seat of seatList) {
    const sv = source.seats[seat]!.seats[seat]!;
    const id = SEAT_IDS[seat]!;
    const setup: DuelistSetup = { lp: sv.lp };
    if (sv.eliminated) warnings.push(`${id} is eliminated. Its board is empty in the draft; mark it by hand.`);
    const pool = { main: [...(source.decks?.[seat]?.main ?? [])], extra: [...(source.decks?.[seat]?.extra ?? [])] };
    /** Remove one card from this seat's deck lists; a card from elsewhere goes to the stray pool. */
    const used = (code: number | undefined) => {
      if (code == null) return;
      if (!take(pool.main, code) && !take(pool.extra, code)) leftovers[seat]!.push(code);
    };

    const hand: CardEntry[] = [];
    for (const card of sv.hand) {
      used(card.code);
      if (placeable(card.code, `${id} hand`)) hand.push(ref(card.code));
    }
    if (hand.length) setup.hand = hand;

    const entryFor = (card: DuelCard, where: string): CardSpec | null => {
      used(card.code);
      if (!placeable(card.code, where)) return null;
      return { card: ref(card.code!) };
    };

    const monsters: Array<CardEntry | null> = [];
    sv.monsters.forEach((card, index) => {
      if (!card) return;
      const where = `${id} monster zone ${index}`;
      const entry = entryFor(card, where);
      if (!entry) return;
      if (isMonsterLocationFaceDown(card.position)) entry.pos = "set";
      else if ((card.position & 0x04) !== 0) entry.pos = "def";
      else entry.pos = "atk";
      if (card.materials?.length) {
        const materials: Array<string | number> = [];
        for (const material of card.materials) {
          used(material.code);
          if (placeable(material.code, `${where} material`)) materials.push(ref(material.code!));
        }
        entry.materials = materials;
      }
      if (card.counters?.length) {
        warnings.push(`${where} ${labels.get(card.code!)}: counters ${card.counters.map((c) => `0x${c.type.toString(16)} x${c.count}`).join(", ")} cannot be set in a scenario`);
      }
      while (monsters.length < index) monsters.push(null);
      monsters[index] = entry.pos === "atk" && !entry.materials ? entry.card : entry;
    });
    if (monsters.length) setup.monsters = monsters;

    const spells: Array<CardEntry | null> = [];
    const pendulum: [CardEntry | null, CardEntry | null] = [null, null];
    let field: CardEntry | undefined;
    sv.spells.forEach((card, index) => {
      if (!card) return;
      const where = `${id} spell zone ${index}`;
      const entry = entryFor(card, where);
      if (!entry) return;
      const faceDown = (card.position & 0x0a) !== 0;
      if (faceDown) entry.pos = "set";
      const type = card.type ?? 0;
      if (card.counters?.length) {
        warnings.push(`${where} ${labels.get(card.code!)}: counters ${card.counters.map((c) => `0x${c.type.toString(16)} x${c.count}`).join(", ")} cannot be set in a scenario`);
      }
      if (!faceDown && (type & TYPE.equip) !== 0) {
        warnings.push(`${where} ${labels.get(card.code!)}: an Equip Spell. Its equip target link is lost (the card is placed as a plain face-up Spell).`);
      }
      if (index === 5) {
        field = faceDown ? entry : entry.card;
        return;
      }
      const pendulumIndex: 0 | 1 | -1 = masterRule >= 4 ? (index === 0 ? 0 : index === 4 ? 1 : -1) : index === 6 ? 0 : index === 7 ? 1 : -1;
      if (!faceDown && (type & TYPE.pendulum) !== 0 && pendulumIndex !== -1) {
        pendulum[pendulumIndex] = entry.card;
        return;
      }
      if (index > 4) {
        warnings.push(`${where} ${labels.get(card.code!)}: sequence ${index} has no scenario zone. It is skipped.`);
        return;
      }
      while (spells.length < index) spells.push(null);
      spells[index] = faceDown ? entry : entry.card;
    });
    if (spells.length) setup.spells = spells;
    if (field) setup.field = field;
    if (pendulum[0] || pendulum[1]) setup.pendulum = pendulum;

    const list = (cards: DuelCard[], where: string) => {
      const out: Array<string | number> = [];
      for (const card of cards) {
        used(card.code);
        if (placeable(card.code, where)) out.push(ref(card.code!));
      }
      return out;
    };
    const grave = list(sv.graveyard, `${id} graveyard`);
    if (grave.length) setup.grave = grave;
    const banished = list(sv.banished, `${id} banished`);
    if (banished.length) setup.banished = banished;
    if (sv.banished.some((card) => (card.position & 0x0a) !== 0)) {
      warnings.push(`${id} has face-down banished cards. They are rebuilt face-up.`);
    }

    // Extra Deck: every card still there. A face-up Pendulum Monster in the Extra Deck is rebuilt face-down.
    const extra: Array<string | number> = [];
    for (const card of sv.extra) {
      if (card.code == null) continue;
      used(card.code);
      if (placeable(card.code, `${id} Extra Deck`)) extra.push(ref(card.code));
      if ((card.position & 0x01) !== 0) warnings.push(`${id} Extra Deck: ${labels.get(card.code)} is face-up. It is rebuilt face-down.`);
    }
    if (extra.length) setup.extra = extra;

    if (mode === "domain") {
      const dm = sv.deckMaster;
      if (!dm) {
        warnings.push(`${id}: Domain duel but the view has no Deck Master. Add deckMaster by hand.`);
      } else {
        if (placeable(dm.card.code, `${id} Deck Master`)) setup.deckMaster = ref(dm.card.code);
        if (!dm.inZone) warnings.push(`${id} Deck Master is not in its zone (summoned, or returned). The scenario puts it back in the zone.`);
        if (dm.returns !== 0 || dm.nextCost !== 0) {
          warnings.push(`${id} Domain state: returns ${dm.returns}, next leave cost ${dm.nextCost}. The scenario starts at 0 returns.`);
        }
      }
    }

    remainders.push(pool);
    deckCounts.push(sv.deckCount);
    deckSize = Math.max(deckSize, sv.deckCount);
    board[id] = setup;
  }

  // Stray cards (a card another seat controls now) are taken out of another seat's remainder.
  for (const seat of seatList) {
    for (const code of leftovers[seat]!) {
      for (const other of seatList) {
        if (other === seat) continue;
        if (take(remainders[other]!.main, code) || take(remainders[other]!.extra, code)) break;
      }
    }
  }
  const haveDecks = seatList.every((seat) => !!source.decks?.[seat]);
  for (const seat of seatList) {
    const id = SEAT_IDS[seat]!;
    const setup = board[id]!;
    const count = deckCounts[seat]!;
    const remainder = remainders[seat]!.main;
    if (!haveDecks) {
      warnings.push(`${id} Deck content is unknown (no deck list in the source). It is filler.`);
    } else if (remainder.length !== count) {
      warnings.push(`${id} Deck: the deck list minus the visible cards gives ${remainder.length} cards, the engine has ${count}. Deck content is approximate.`);
    }
    if (haveDecks) {
      const top = remainder.slice(0, count).filter((code) => lookup.describe(code) != null);
      if (top.length) setup.deck = top.map(ref);
      warnings.push(
        `${id} Deck: ${count} cards listed in deck-list order. The real order is shuffled and the views do not show it.`,
      );
    }
  }
  board.deckSize = Math.max(deckSize, 1);
  if (new Set(deckCounts).size > 1) {
    warnings.push(`Deck sizes differ (${deckCounts.join(", ")}). The scenario uses ${board.deckSize} for both and pads with ${FILLER_CARD}.`);
  }

  // State the DSL cannot rebuild.
  const prompt = view.prompt ?? source.seats.map((v) => v.prompt).find(Boolean);
  if (prompt) warnings.push(`An open prompt was pending at this step ("${prompt.title}", seat ${prompt.seat}, ${prompt.kind}). The scenario starts at an idle Main Phase 1 with no prompt.`);
  if (view.chain.length > 0) warnings.push(`A chain with ${view.chain.length} link(s) was open. It is not rebuilt.`);
  if (view.phase !== "main1") warnings.push(`The state was in phase ${view.phase}. The scenario starts in Main Phase 1 of the turn player.`);
  if (turn > 1 && seatCount === 2) warnings.push(`Turn ${turn}: the scenario starts on the first turn of its own clock (attackFirstTurn is set so the turn player can attack). Turn counters of cards are lost.`);
  if (turn > 1 && seatCount > 2) warnings.push(`Turn ${turn}: the draft starts on turn 1 of its own clock. The first-attack rule of the format applies again (no attack before every duelist had a turn). Turn counters of cards are lost.`);
  warnings.push(
    "Every field monster is placed as properly summoned. Summon type (Normal, Special, Xyz, ...) and summon turn are not in the view.",
  );
  const events = source.spectator?.events ?? view.events;
  let startAt = 0;
  events.forEach((e: DuelEvent, index) => {
    if (e.kind === "phase" && /draw/i.test(e.text)) startAt = index;
  });
  const thisTurn = events.slice(startAt);
  const summoned = thisTurn.filter((e) => e.kind === "summon" && e.summonKind && ["normal", "tribute"].includes(e.summonKind)).length;
  const sets = thisTurn.filter((e) => e.kind === "set").length;
  const activations = thisTurn.filter((e) => e.kind === "activate").length;
  if (summoned + sets > 0) warnings.push(`This turn used ${summoned} Normal or Tribute Summon(s) and ${sets} Set(s). The scenario resets the Normal Summon count.`);
  if (activations > 0) warnings.push(`This turn had ${activations} effect activation(s). Once-per-turn usage is not in the view and is reset.`);

  const continuous: string[] = [];
  for (const seat of seatList) {
    const sv = source.seats[seat]!.seats[seat]!;
    for (const card of sv.spells) {
      if (!card || (card.position & 0x0a) !== 0 || card.code == null) continue;
      const type = card.type ?? 0;
      if (type & (TYPE.continuous | TYPE.field | TYPE.equip)) continuous.push(`${labels.get(card.code) ?? card.code} (p${seat})`);
    }
  }
  if (continuous.length) {
    warnings.push(`Face-up continuous, field or equip cards: ${continuous.join(", ")}. The scenario only registers their printed effects. Effects they applied earlier (targets, chosen options, "until" durations) are lost.`);
  }
  warnings.push("Effects applied earlier by a resolved card (stat changes, locks, delayed triggers) are not in the views and are lost.");
  if (source.seats.some((s) => s.seats.some((seat) => seat.monsters.some((card) => card && card.code != null && card.linkMarker)))) {
    warnings.push("Link Monsters are placed in their zone. Their co-linked zones are recalculated by the core.");
  }

  return {
    board,
    warnings,
    labels,
    summary: { turn, phase: view.phase, turnSeat: view.turnSeat, prompt: prompt ? `${prompt.title} (seat ${prompt.seat}, ${prompt.kind})` : null },
  };
}

// ---------- printing ----------

function lit(value: string | number): string {
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}

function cardLit(entry: CardEntry): string {
  if (typeof entry !== "object") return lit(entry);
  const base = lit(entry.card);
  const mats = entry.materials?.length ? `[${entry.materials.map(lit).join(", ")}]` : null;
  if (mats) return `xyz(${base}, ${mats})`;
  if (entry.pos === "set") return `faceDown(${base})`;
  if (entry.pos === "def") return `defense(${base})`;
  return base;
}

function listLit(items: Array<string | number>): string {
  return `[${items.map(lit).join(", ")}]`;
}

function slotsLit(slots: Array<CardEntry | null>): string {
  return `[${slots.map((slot) => (slot ? cardLit(slot) : "null")).join(", ")}]`;
}

function renderSetup(id: string, setup: import("../../tests/support/board.js").DuelistSetup, labels: Map<number, string>, indent: string): string[] {
  const lines: string[] = [];
  const pad = indent + "  ";
  lines.push(`${indent}${id}: {`);
  if (setup.lp != null) lines.push(`${pad}lp: ${setup.lp},`);
  if (setup.hand) lines.push(`${pad}hand: ${listLit(setup.hand.map((e) => (typeof e === "object" ? e.card : e)))},`);
  if (setup.monsters) lines.push(`${pad}monsters: ${slotsLit(setup.monsters)},`);
  if (setup.spells) lines.push(`${pad}spells: ${slotsLit(setup.spells)},`);
  if (setup.field) lines.push(`${pad}field: ${cardLit(setup.field)},`);
  if (setup.pendulum) lines.push(`${pad}pendulum: ${slotsLit(setup.pendulum)},`);
  if (setup.grave) lines.push(`${pad}grave: ${listLit(setup.grave as Array<string | number>)},`);
  if (setup.banished) lines.push(`${pad}banished: ${listLit(setup.banished as Array<string | number>)},`);
  if (setup.deck) lines.push(`${pad}deck: ${listLit(setup.deck as Array<string | number>)},`);
  if (setup.extra) lines.push(`${pad}extra: ${listLit(setup.extra as Array<string | number>)},`);
  if (setup.deckMaster != null) lines.push(`${pad}deckMaster: ${lit(setup.deckMaster)},`);
  lines.push(`${indent}},`);
  void labels;
  return lines;
}

/** `expectBoard` body that rebuilds the same state: a round-trip check that the setup is right. */
function renderExpect(board: BoardSpec): string[] {
  const lines: string[] = [];
  for (const id of ["p0", "p1"] as const) {
    const setup = board[id];
    if (!setup) continue;
    const parts: string[] = [];
    if (setup.lp != null) parts.push(`lp: ${setup.lp}`);
    parts.push(`hand: ${listLit((setup.hand ?? []).map((e) => (typeof e === "object" ? e.card : e)))}`);
    parts.push(`grave: ${listLit((setup.grave ?? []) as Array<string | number>)}`);
    parts.push(`banished: ${listLit((setup.banished ?? []) as Array<string | number>)}`);
    lines.push(`      ${id}: { ${parts.join(", ")} },`);
  }
  return lines;
}

export interface RenderOptions {
  id: string;
  title: string;
  source: string;
  header: string[];
  warnings: string[];
  capture: Capture;
}

export function renderScenario(options: RenderOptions): string {
  const { capture } = options;
  const board = capture.board;
  if (board.format && board.format !== "1v1") throw new Error("renderScenario writes two-seat Layer 1 scenarios. Use renderPresetDraft for 3 or 4 seats.");
  const out: string[] = [];
  out.push(...options.header.map((line) => `// ${line}`));
  out.push("//");
  out.push("// Warnings: state this scenario cannot rebuild");
  for (const warning of options.warnings) out.push(`//  - ${warning}`);
  out.push("");
  const body = JSON.stringify(board);
  const usesXyz = body.includes('"materials"');
  const usesFaceDown = body.includes('"pos":"set"');
  const usesDefense = body.includes('"pos":"def"');
  const names = ["defineScenario", "expectBoard", ...(usesFaceDown ? ["faceDown"] : []), ...(usesDefense ? ["defense"] : []), ...(usesXyz ? ["xyz"] : []), "type Scenario"];
  out.push(`import { ${names.join(", ")} } from "../../support/dsl.js";`);
  out.push("");
  out.push("export const scenarios: Scenario[] = [");
  out.push("  defineScenario({");
  out.push(`    id: ${JSON.stringify(options.id)},`);
  out.push(`    title: ${JSON.stringify(options.title)},`);
  out.push(`    source: ${JSON.stringify(options.source)},`);
  out.push(`    tags: ["generated"${board.mode === "domain" ? ', "domain"' : ""}],`);
  out.push("    setup: {");
  out.push(`      mode: ${JSON.stringify(board.mode)},`);
  out.push(`      masterRule: ${board.masterRule},`);
  out.push(`      turn: ${JSON.stringify(board.turn)},`);
  if (board.attackFirstTurn) out.push("      attackFirstTurn: true,");
  out.push(`      deckSize: ${board.deckSize},`);
  for (const id of ["p0", "p1"] as const) {
    if (board[id]) out.push(...renderSetup(id, board[id]!, capture.labels, "      "));
  }
  out.push("    },");
  out.push("    steps: [");
  out.push("      // TODO expected result: add the actions that reproduce the failure, then the board or event you expect.");
  out.push("      // TODO expected result: set `source` to the ruling that justifies it. Snapshots do not prove a ruling.");
  out.push("      // The step below only checks that the setup rebuilt the captured state.");
  out.push("      expectBoard({");
  out.push(...renderExpect(board));
  out.push("      }),");
  out.push("    ],");
  out.push("  }),");
  out.push("];");
  out.push("");
  return out.join("\n");
}

// ---------- preset draft (3 and 4 seats) ----------

export interface PresetDraftOptions {
  /** Preset id (kebab-case). */
  id: string;
  title: string;
  header: string[];
  warnings: string[];
  capture: Capture;
  /** Checklist lines. Default: one TODO line. */
  checklist?: string[];
}

/**
 * A preset file in the preset contract format (docs/specs/2026-09-30-preset-contract.md, src/presets/types.ts):
 * the captured board, empty bot rule lists (a bot only passes) and a TODO checklist. The human plays seat 0.
 */
export function renderPresetDraft(options: PresetDraftOptions): string {
  const { capture } = options;
  const board = capture.board;
  const format: DuelFormat = board.format ?? "1v1";
  const seatCount = format === "ffa3" ? 3 : format === "1v1" ? 2 : 4;
  const out: string[] = [];
  out.push(...options.header.map((line) => `// ${line}`));
  out.push("//");
  out.push("// Warnings: state this draft cannot rebuild");
  for (const warning of options.warnings) out.push(`//  - ${warning}`);
  out.push("");
  out.push('import type { Preset } from "../types.js";');
  out.push("");
  out.push("export const preset: Preset = {");
  out.push(`  id: ${JSON.stringify(options.id)},`);
  out.push(`  title: ${JSON.stringify(options.title)},`);
  out.push(`  format: ${JSON.stringify(format)},`);
  out.push("  humanSeat: 0,");
  if (seatCount > 2) out.push('  needs: "multi-core",');
  out.push("  rules: [],");
  out.push(`  board: ${JSON.stringify(board, null, 2).replace(/\n/g, "\n  ")},`);
  const bots = Array.from({ length: seatCount - 1 }, (_, i) => `${i + 1}: []`).join(", ");
  out.push(`  bots: { ${bots} },`);
  out.push("  checklist: [");
  for (const line of options.checklist ?? ["TODO: write what the tester must see, in order. The bots only pass until you add rules."]) out.push(`    ${JSON.stringify(line)},`);
  out.push("  ],");
  out.push("};");
  out.push("");
  return out.join("\n");
}
