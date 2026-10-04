import { defaultDuelSettings } from "@yugidraft/shared/duels";
import type { DuelChainLink, DuelEngineView, DuelEvent, DuelPrompt, DuelPromptOption, DuelRoom, DuelSeatView, DuelZoneRef } from "@yugidraft/shared/duels";
import { LOCATION_DMZONE, LOCATION_HAND, LOCATION_MZONE, LOCATION_SZONE, TYPE_SPELL, TYPE_TRAP } from "../../constants";
import { applyEdits, edit, ev, link, MZ, newBoard, SZ, withHandIds, type Edit, type EventSpec, type LabBoard } from "../../fx-lab/board";
import type { BattleStep } from "../../station-track";
import { SOLID_CARDS as C } from "./cards";

/** The seven states of the 3D mode preview. They mirror the concept states (`app.js` STATES) with the same cards. */
export const SOLID_STATE_IDS = ["m1", "summon", "battle", "chain", "chains", "damage", "m2", "end"] as const;
export type SolidStateId = (typeof SOLID_STATE_IDS)[number];

export const SOLID_STATE_LABEL: Readonly<Record<SolidStateId, string>> = {
  m1: "Main 1", summon: "Summon", battle: "Battle", chain: "Chain", chains: "Chain (2 options)", damage: "Damage", m2: "Main 2", end: "End",
};

export function isSolidStateId(value: string | null | undefined): value is SolidStateId {
  return value != null && (SOLID_STATE_IDS as readonly string[]).includes(value);
}

export type SolidFixtureState = {
  id: SolidStateId;
  label: string;
  room: DuelRoom;
  /** Events for the Log pane only. The field gets none, so no FX or cue plays in the preview. */
  history: DuelEvent[];
  ui: {
    /** Open the card menu on this hand slot once the board is up. */
    menuHand?: number;
    /** Open the attack confirm: from your zone key to the target's zone key. */
    confirm?: { target: string; attacker: string };
    /** The card the inspector shows. */
    inspect: { kind: "info"; card: keyof typeof C };
    pane?: "card" | "log";
  };
};

const ME = 0;
const FOE = 1;
const BASE_HAND = [C.celtic, C.beaver, C.fissure, C.trapHole, C.silverFang];

const edits = {
  base: [
    edit.setSpell(ME, 1, C.solemn),
    edit.hiddenSpell(FOE, 1),
    edit.monster(FOE, 2, C.battleOx),
    edit.deckMaster(ME, C.darkMagician, { inZone: true, returns: 0, nextCost: 0 }),
    edit.deckMaster(FOE, C.blueEyes, { inZone: true, returns: 0, nextCost: 0 }),
  ] as Edit[],
  summon: [
    edit.removeHand(ME, 0),
    edit.monster(ME, 1, C.celtic),
    edit.monster(ME, 2, C.darkMagician),
    edit.deckMaster(ME, C.darkMagician, { inZone: false, returns: 0, nextCost: 0 }),
  ] as Edit[],
  chain: [edit.spell(FOE, 1, C.bookOfMoon)] as Edit[],
  damage: [
    edit.spell(ME, 1, null),
    edit.grave(ME, C.solemn),
    edit.spell(FOE, 1, null),
    edit.monster(FOE, 2, null),
    edit.grave(FOE, C.bookOfMoon),
    edit.grave(FOE, C.battleOx),
    edit.lp(ME, 4000),
    edit.lp(FOE, 7200),
  ] as Edit[],
  m2: [edit.removeHand(ME, 2)] as Edit[],
  end: [edit.setSpell(ME, 2, C.trapHole), edit.drawFromDeck(FOE), edit.addHand(FOE, null)] as Edit[],
};

const STAGES: Record<SolidStateId, SolidStateId[]> = {
  m1: [],
  summon: ["summon"],
  battle: ["summon"],
  chain: ["summon", "chain"],
  chains: ["summon", "chain"],
  damage: ["summon", "chain", "damage"],
  m2: ["summon", "chain", "damage", "m2"],
  end: ["summon", "chain", "damage", "m2", "end"],
};

const HISTORY: Record<SolidStateId, EventSpec[]> = {
  m1: [],
  summon: [
    ev.summon(ME, C.celtic, MZ(ME, 1)),
    ev.summon(ME, C.darkMagician, MZ(ME, 2), "special"),
  ],
  battle: [ev.phase("Battle Phase")],
  chain: [
    ev.attack(ME, MZ(ME, 2), MZ(FOE, 2)),
    ev.activate(FOE, C.bookOfMoon, SZ(FOE, 1), 1),
  ],
  chains: [],
  damage: [
    ev.activate(ME, C.solemn, SZ(ME, 1), 2),
    ev.chain("chain-resolved", ME, C.solemn, 2),
    ev.chain("chain-negated", FOE, C.bookOfMoon, 1),
    ev.chainEnd(),
    ev.damage(FOE, 800),
  ],
  m2: [ev.phase("Main Phase 2")],
  end: [ev.phase("End Phase")],
};

const LOG: Record<SolidStateId, string[]> = {
  m1: [],
  summon: ["Sulman Normal Summons Celtic Guardian to Main Monster Zone 2.", "Sulman Special Summons Dark Magician from the Deck Master Zone to Main Monster Zone 3."],
  battle: ["Battle Phase."],
  chain: ["Dark Magician attacks Battle Ox.", "Practice Bot activates Book of Moon (Chain Link 1), targeting Dark Magician."],
  chains: [],
  damage: ["Sulman activates Solemn Judgment (Chain Link 2) and pays 4000 LP.", "Chain Link 2 resolves: Book of Moon is negated and destroyed.", "Battle Ox is destroyed.", "Practice Bot takes 800 battle damage."],
  m2: ["Main Phase 2."],
  end: ["End Phase.", "Turn 4 · Practice Bot"],
};

const PHASE: Record<SolidStateId, string> = {
  m1: "main1", summon: "main1", battle: "battle", chain: "battle", chains: "battle", damage: "battle", m2: "main2", end: "draw",
};
const STEP: Partial<Record<SolidStateId, BattleStep>> = { battle: "battle", chain: "battle", chains: "battle", damage: "damage" };

const option = (id: string, label: string, ref: DuelZoneRef | null, card?: DuelPromptOption["card"]): DuelPromptOption => ({
  id, label, ...(card ? { card } : {}),
  ...(ref ? { controller: ref.controller, location: ref.location, sequence: ref.sequence } : {}),
});
const phaseMoves = (...ids: Array<"to_bp" | "to_m2" | "to_ep">): DuelPromptOption[] =>
  ids.map((id) => option(id, id === "to_bp" ? "Battle Phase" : id === "to_m2" ? "Main Phase 2" : "End Turn", null));
const handRef = (index: number): DuelZoneRef => ({ controller: ME, location: LOCATION_HAND, sequence: index });

/** The main-phase action prompt: Summon/Set/Activate per hand card, the Deck Master's Special Summon, the phase moves. */
function mainPrompt(seats: DuelSeatView[], dmAction: boolean, moves: Array<"to_bp" | "to_m2" | "to_ep">): DuelPrompt {
  const hand = seats[ME].hand;
  const options: DuelPromptOption[] = [];
  hand.forEach((card, index) => {
    const ref = handRef(index);
    const type = card.type ?? 0;
    if (type & TYPE_SPELL) options.push(option(`activate-${index}`, "Activate", ref, card as never), option(`sset-${index}`, "Set", ref, card as never));
    else if (type & TYPE_TRAP) options.push(option(`sset-${index}`, "Set", ref, card as never));
    else options.push(option(`summon-${index}`, "Normal Summon", ref, card as never), option(`mset-${index}`, "Set", ref, card as never));
  });
  if (dmAction) options.push(option("spsummon-dm", "Special Summon", { controller: ME, location: LOCATION_DMZONE, sequence: 0 }, C.darkMagician));
  options.push(...phaseMoves(...moves));
  return { id: "preview-main", seat: ME, kind: "choice", title: "Your move", context: { type: "action", phase: "main" }, options };
}

function battlePrompt(): DuelPrompt {
  const attack = (sequence: number, name: string, card: DuelPromptOption["card"]) =>
    option(`attack-${sequence}`, `Attack with ${name}`, { controller: ME, location: LOCATION_MZONE, sequence }, card);
  return {
    id: "preview-battle", seat: ME, kind: "choice", title: "Your move", context: { type: "action", phase: "battle" },
    options: [attack(1, C.celtic.name, C.celtic), attack(2, C.darkMagician.name, C.darkMagician), ...phaseMoves("to_m2", "to_ep")],
  };
}

function chainPrompt(): DuelPrompt {
  return {
    id: "preview-chain", seat: ME, kind: "choice", title: "Respond to the chain?", cancelable: true,
    context: { type: "chain", forced: false },
    options: [option("activate-solemn", `Activate ${C.solemn.name}`, SZ(ME, 1), C.solemn)],
  };
}

/** Several answers to one chain link: two Activate tiles, with the chain strip showing the link they answer. */
function chainsPrompt(): DuelPrompt {
  return {
    id: "preview-chains", seat: ME, kind: "choice", title: "Respond to the chain?", cancelable: true,
    context: { type: "chain", forced: false },
    options: [
      option("activate-solemn", `Activate ${C.solemn.name}`, SZ(ME, 1), C.solemn),
      option("activate-fissure", `Activate ${C.fissure.name}`, handRef(2), C.fissure),
    ],
  };
}

function placePrompt(): DuelPrompt {
  return {
    id: "preview-place", seat: ME, kind: "places", title: `Set ${C.trapHole.name}`, min: 1, max: 1, cancelable: true,
    options: [0, 2, 3, 4].map((sequence) => option(`place-${sequence}`, `Spell & Trap Zone ${sequence + 1}`, { controller: ME, location: LOCATION_SZONE, sequence })),
  };
}

function build(id: SolidStateId): SolidFixtureState {
  let board: LabBoard = newBoard(
    { hand: BASE_HAND, deck: 33, extra: new Array(15).fill(null) },
    { hand: [null, null, null, null, null], deck: 32, extra: new Array(15).fill(null) },
    PHASE[id], id === "end" ? FOE : ME,
  );
  board = applyEdits(board, edits.base);
  for (const stage of STAGES[id]) board = applyEdits(board, edits[stage as keyof typeof edits]);
  board = withHandIds(board, [], ME).board;
  const seats = board.seats;
  const turn = id === "end" ? 4 : 3;

  const chain: DuelChainLink[] = id === "chain" || id === "chains" ? [link(1, FOE, C.bookOfMoon)] : [];
  let prompt: DuelPrompt | null = null;
  if (id === "m1") prompt = mainPrompt(seats, true, ["to_bp", "to_ep"]);
  else if (id === "summon") prompt = mainPrompt(seats, false, ["to_bp", "to_ep"]);
  else if (id === "battle" || id === "damage") prompt = battlePrompt();
  else if (id === "chain") prompt = chainPrompt();
  else if (id === "chains") prompt = chainsPrompt();
  else if (id === "m2") prompt = placePrompt();

  let next = 0;
  const history = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(id) + 1).flatMap((stage) => HISTORY[stage])
    .map((spec): DuelEvent => ({ ...spec, id: ++next }) as DuelEvent);
  const logTexts = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(id) + 1).flatMap((stage) => LOG[stage]);

  const engine: DuelEngineView = {
    revision: 1, format: "1v1", turn, turnSeat: board.turnSeat, phase: PHASE[id], battleStep: STEP[id] ?? null,
    seats, prompt, chain, events: [], log: logTexts.map((text, index) => ({ id: index + 1, text })), result: null,
  } as DuelEngineView;

  const ui: SolidFixtureState["ui"] = { inspect: { kind: "info", card: "celtic" } };
  if (id === "m1") ui.menuHand = 0;
  if (id === "summon" || id === "battle") ui.inspect.card = "darkMagician";
  if (id === "chain" || id === "chains") ui.inspect.card = "bookOfMoon";
  if (id === "damage") ui.inspect.card = "solemn";
  if (id === "m2" || id === "end") ui.inspect.card = "trapHole";
  if (id === "battle") ui.confirm = { attacker: "0:4:2", target: "1:4:2" };

  return { id, label: SOLID_STATE_LABEL[id], room: roomOf(engine), history, ui };
}

const STAGE_ORDER: SolidStateId[] = ["m1", "summon", "battle", "chain", "chains", "damage", "m2", "end"];

function roomOf(engine: DuelEngineView): DuelRoom {
  const mode = "domain";
  return {
    session: {
      id: 1, slug: "solid-preview", name: "Solid preview", guildId: "preview", organizerPlayerId: 1, mode, format: "1v1",
      masterRule: 5, status: "active", settings: defaultDuelSettings(mode), createdAt: "", endedAt: null, archivedAt: null,
      winnerPlayerId: null, winnerSeat: null, resultReason: null,
      seats: [
        { seat: 0, playerId: 1, displayName: "Sulman", ready: true, isBot: false },
        { seat: 1, playerId: 2, displayName: "Practice Bot", ready: true, isBot: true },
      ],
    },
    role: "player", mySeat: ME, myDeck: null, engine,
    // 3:12 for you, 3:58 for the bot (the concept's clocks). `startedAt: null` keeps them still.
    clock: { turn: engine.turn, remainingMs: [192_000, 238_000], activeSeat: engine.turnSeat, startedAt: null, serverNow: 0 },
    metadataOnly: false,
  } as DuelRoom;
}

const cache = new Map<SolidStateId, SolidFixtureState>();
/** The fixture of one preview state. Built once per id; the room and its cards are plain data. */
export function solidFixture(id: SolidStateId): SolidFixtureState {
  let state = cache.get(id);
  if (!state) { state = build(id); cache.set(id, state); }
  return state;
}
