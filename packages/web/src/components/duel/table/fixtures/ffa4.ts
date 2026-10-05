import type { DuelChainLink, DuelEngineView, DuelEvent, DuelPrompt, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import { ev, MZ, SZ } from "../../fx-lab/board";
import { LOCATION_HAND, LOCATION_MZONE, LOCATION_SZONE, POS_FACEDOWN_DEFENSE, zoneKey } from "../../constants";
import {
  fixtureEngine,
  fixtureRoom,
  link,
  newSeat,
  putMonster,
  putSpell,
  TABLE_CARDS as C,
  withHiddenHands,
  type TableFixtureSet,
  type TableFixtureState,
  type TableStateId,
} from "./common";

/**
 * 4-way free-for-all, "Battle Royal at the Plaza" (BRIEF-MODES 5.1). Aster is you (seat 0, Violet, 8000 LP), Rook is Ice
 * (seat 1, west, 5400 LP), Juniper is Verdant (seat 2, across, 3100 LP after a 1200 hit), Mirelle is Rose (seat 3, east,
 * 6600 LP). It is turn 7 and Aster plays; attacks have been open since turn 5 (first round lock over), so the battle
 * states are real. Hand-made for the table stage: every state edits one shared board.
 */
const NAMES = ["Aster", "Rook", "Juniper", "Mirelle"] as const;
const CLOCK_MS = [192_000, 240_000, 205_000, 230_000] as const;
const ASTER = 0;
const ROOK = 1;
const JUNIPER = 2;
const MIRELLE = 3;
const FOES = [ROOK, JUNIPER, MIRELLE] as const;

/** The last plays of turns 5 to 7, the rows of the history rail. Each carries the seat that did it. */
function history(): DuelEvent[] {
  const specs = [
    ev.phase("Turn 5"),
    ev.summon(ROOK, C.blueEyes, MZ(ROOK, 1), "tribute"),
    ev.set(ROOK, C.mirrorForce, SZ(ROOK, 1)),
    ev.phase("Turn 6"),
    ev.summon(JUNIPER, C.redEyes, MZ(JUNIPER, 0)),
    ev.summon(JUNIPER, C.gaia, MZ(JUNIPER, 2)),
    ev.summon(MIRELLE, C.summonedSkull, MZ(MIRELLE, 0)),
    ev.attack(ROOK, MZ(ROOK, 1), MZ(JUNIPER, 0)),
    ev.damage(JUNIPER, 1200),
    ev.phase("Turn 7"),
    ev.summon(ASTER, C.darkMagician, MZ(ASTER, 0)),
  ];
  return specs.map((spec, index) => ({ ...spec, id: index + 1 }) as DuelEvent);
}

const MASTERS = [
  { seat: ASTER, card: C.envoy, returns: 1, nextCost: 1000 },
  { seat: ROOK, card: C.chaosEmperor, returns: 0, nextCost: 0 },
  { seat: JUNIPER, card: C.cyberDragon, returns: 2, nextCost: 1500 },
  { seat: MIRELLE, card: C.blackChaos, returns: 0, nextCost: 0 },
] as const;

function board(): DuelSeatView[] {
  const aster = newSeat(ASTER, { lp: 8000, hand: [C.raigeki, C.potOfGreed, C.celtic, C.solemn, C.heavyStorm], deck: 29, extra: [C.darkPaladin, C.stardust] });
  putMonster(aster, 0, C.darkMagician);
  putMonster(aster, 1, C.celtic);
  putSpell(aster, 0, null);
  const rook = newSeat(ROOK, { lp: 5400, hand: [null, null, null, null], deck: 30, extra: [null, null] });
  putMonster(rook, 1, C.blueEyes);
  putSpell(rook, 0, null);
  putSpell(rook, 1, null);
  const juniper = newSeat(JUNIPER, { lp: 3100, hand: [null, null, null], deck: 27, extra: [null] });
  putMonster(juniper, 0, C.redEyes);
  putMonster(juniper, 2, C.gaia);
  putSpell(juniper, 0, null);
  putSpell(juniper, 1, null);
  const mirelle = newSeat(MIRELLE, { lp: 6600, hand: [null, null, null, null], deck: 28, extra: [null] });
  putMonster(mirelle, 0, C.summonedSkull);
  putMonster(mirelle, 1, C.sangan, POS_FACEDOWN_DEFENSE);
  putSpell(mirelle, 0, null);
  putSpell(mirelle, 1, null);
  const views = [aster, rook, juniper, mirelle];
  for (const master of MASTERS) views[master.seat].deckMaster = { card: { ...master.card }, inZone: false, returns: master.returns, nextCost: master.nextCost };
  return views;
}

const handOption = (sequence: number, label: string): DuelPromptOption => ({
  id: `h${sequence}`,
  label: `Activate ${label}`,
  controller: ASTER,
  location: LOCATION_HAND,
  sequence,
});

function foeMonsterOptions(seats: DuelSeatView[]): DuelPromptOption[] {
  return FOES.flatMap((seat) =>
    seats[seat].monsters.flatMap((card, sequence) =>
      card && sequence < 7 ? [{ id: `m${seat}-${sequence}`, label: card.name ?? "Monster", controller: seat, location: LOCATION_MZONE, sequence }] : [],
    ),
  );
}

interface Spec {
  viewerSeat?: number | null;
  turnSeat?: number;
  phase?: string;
  battleStep?: DuelEngineView["battleStep"];
  edit?: (seats: DuelSeatView[]) => void;
  prompt?: (seats: DuelSeatView[]) => DuelPrompt | null;
  chain?: DuelChainLink[];
  result?: DuelEngineView["result"];
  ui?: TableFixtureState["ui"];
}

function make(id: TableStateId, label: string, spec: Spec = {}): TableFixtureState {
  const viewerSeat = spec.viewerSeat === undefined ? ASTER : spec.viewerSeat;
  let seats = board();
  spec.edit?.(seats);
  // A rival, or a spectator, never sees a hand: the engine sends hidden cards. Only the viewer's own hand stays face up.
  seats = viewerSeat == null ? withHiddenHands(seats) : seats;
  const engine = fixtureEngine({
    format: "ffa4",
    seats,
    turn: 7,
    turnSeat: spec.turnSeat ?? ASTER,
    phase: spec.phase ?? "main1",
    battleStep: spec.battleStep,
    prompt: spec.prompt?.(seats) ?? null,
    chain: spec.chain,
    events: history(),
    result: spec.result,
  });
  return { id, label, room: fixtureRoom({ format: "ffa4", names: NAMES, viewerSeat, engine, clockMs: CLOCK_MS, mode: "domain" }), ui: spec.ui };
}

const attackerKey = zoneKey(ASTER, LOCATION_MZONE, 0);
const gaiaKey = zoneKey(JUNIPER, LOCATION_MZONE, 2);

/** The rival fields of a seat swept clean: the state of a duelist who left. */
function leave(view: DuelSeatView): void {
  view.lp = 0;
  view.eliminated = true;
  view.hand = [];
  view.monsters = view.monsters.map(() => null);
  view.spells = view.spells.map(() => null);
}

const states = {
  main: make("main", "Main Phase", {
    prompt: () => ({
      id: "main-action",
      seat: ASTER,
      kind: "choice",
      title: "Main Phase 1",
      context: { type: "action", phase: "main" },
      options: [
        handOption(0, C.raigeki.name),
        handOption(1, C.potOfGreed.name),
        { id: "to_bp", label: "Battle Phase" },
        { id: "to_ep", label: "End Phase" },
      ],
    }),
  }),
  "battle-aim": make("battle-aim", "Battle: aim an attack", {
    phase: "battle",
    battleStep: "battle",
    prompt: (seats) => ({
      id: "attack-target",
      seat: ASTER,
      kind: "cards",
      title: "Select an attack target",
      min: 1,
      max: 1,
      options: foeMonsterOptions(seats),
    }),
    ui: { aim: { mode: "aim", from: attackerKey, to: { zones: [gaiaKey] } } },
  }),
  "chain-2": make("chain-2", "Chain link 2: respond", {
    phase: "battle",
    battleStep: "battle",
    edit: (seats) => {
      putSpell(seats[JUNIPER], 0, C.sakuretsu);
      putSpell(seats[MIRELLE], 0, C.mst);
      // Your own Set card is known to you: the engine sends its identity face down.
      seats[ASTER].spells[0] = { ...seats[ASTER].spells[0]!, code: C.callOfTheHaunted.code, name: C.callOfTheHaunted.name, type: C.callOfTheHaunted.type };
    },
    chain: [link(1, JUNIPER, C.sakuretsu), link(2, MIRELLE, C.mst)],
    prompt: () => ({
      id: "chain-2",
      seat: ASTER,
      kind: "choice",
      title: `${NAMES[MIRELLE]} activated ${C.mst.name}. Respond?`,
      context: { type: "chain", forced: false },
      cancelable: true,
      options: [{ id: "activate", label: `Activate ${C.callOfTheHaunted.name}`, card: C.callOfTheHaunted }, { id: "pass", label: "Pass" }],
    }),
    ui: { aim: { mode: "locked", from: attackerKey, to: { zones: [gaiaKey] } } },
  }),
  "target-pick": make("target-pick", "Pick a target", {
    prompt: (seats) => ({
      id: "target-pick",
      seat: ASTER,
      kind: "cards",
      title: "Select 1 monster to destroy",
      min: 1,
      max: 1,
      options: foeMonsterOptions(seats),
    }),
  }),
  "choose-opponent": make("choose-opponent", "Choose an opponent", {
    prompt: () => ({
      id: "choose-opponent",
      seat: ASTER,
      kind: "choice",
      title: "Choose an opponent",
      context: { type: "opponent" },
      options: FOES.map((seat) => ({ id: `opp-${seat}`, label: `Choose ${NAMES[seat]} as the opponent`, controller: seat })),
    }),
  }),
  "direct-attack": make("direct-attack", "Direct attack", {
    phase: "battle",
    battleStep: "battle",
    edit: (seats) => {
      for (const seat of FOES) seats[seat].monsters.fill(null);
    },
    prompt: () => ({
      id: "direct-attack",
      seat: ASTER,
      kind: "choice",
      title: "Select a duelist to attack",
      options: FOES.map((seat) => ({ id: `direct-${seat}`, label: `Attack Player ${seat + 1} directly`, controller: seat })),
    }),
    ui: { aim: { mode: "aim", from: attackerKey, to: { lpSeat: ROOK } } },
  }),
  elimination: make("elimination", "Elimination", {
    phase: "battle",
    battleStep: "damage",
    edit: (seats) => leave(seats[JUNIPER]),
  }),
  spectator: make("spectator", "Spectator", { viewerSeat: null }),
  result: make("result", "Result", {
    edit: (seats) => {
      for (const seat of FOES) leave(seats[seat]);
    },
    result: { winnerSeat: ASTER, winnerTeam: null, reason: "Last duelist standing" },
    // Juniper left first (4th), then Mirelle (3rd), then Rook (2nd).
    ui: { initialOutOrder: [[JUNIPER], [MIRELLE], [ROOK]] },
  }),
} satisfies Record<TableStateId, TableFixtureState>;

export const FFA4_FIXTURES: TableFixtureSet = { format: "ffa4", title: "4-way free-for-all", states };

/**
 * A preview variant of the 4-way fixtures for the pair-lift review (`?out=2,3&pick=field`). Every state of the set gets
 * the seats in `out` swept clean and eliminated (the first one went out first); `pick` replaces the prompt with a pick
 * among your own field cards (`field`) or your hand (`hand`), which the room answers on the board.
 */
export function ffa4Variant(set: TableFixtureSet, opts: { out: readonly number[]; pick?: "field" | "hand" | null }): TableFixtureSet {
  if (opts.out.length === 0 && !opts.pick) return set;
  const states = Object.fromEntries(
    Object.entries(set.states).map(([id, state]) => {
      const engine = state.room.engine!;
      const seats = engine.seats.map((view) => ({ ...view }));
      for (const seat of opts.out) leave(seats[seat]);
      let prompt = engine.prompt;
      if (opts.pick && state.room.mySeat === ASTER) {
        const own = seats[ASTER];
        const options: DuelPromptOption[] = opts.pick === "hand"
          ? own.hand.map((card, sequence) => ({ id: `h${sequence}`, label: card.name ?? "Card", controller: ASTER, location: LOCATION_HAND, sequence }))
          : [
              ...own.monsters.flatMap((card, sequence) => (card && sequence < 7 ? [{ id: `om${sequence}`, label: card.name ?? "Monster", controller: ASTER, location: LOCATION_MZONE, sequence }] : [])),
              ...own.spells.flatMap((card, sequence) => (card && sequence < 5 ? [{ id: `os${sequence}`, label: card.name ?? "Set card", controller: ASTER, location: LOCATION_SZONE, sequence }] : [])),
            ];
        prompt = { id: `pick-${opts.pick}`, seat: ASTER, kind: "cards", title: opts.pick === "hand" ? "Select 1 card in your hand" : "Select 1 card you control", min: 1, max: 1, options };
      }
      const room = { ...state.room, engine: { ...engine, seats, prompt, eliminationOrder: opts.out.map((seat) => [seat]) } };
      const ui = opts.out.length > 0 ? { ...state.ui, initialOutOrder: opts.out.map((seat) => [seat]) } : state.ui;
      return [id, { ...state, room, ui }];
    }),
  ) as unknown as TableFixtureSet["states"];
  return { ...set, states };
}
