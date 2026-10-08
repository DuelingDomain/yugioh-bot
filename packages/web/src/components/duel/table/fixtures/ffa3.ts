import type { DuelChainLink, DuelEngineView, DuelEvent, DuelPrompt, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import { ev, MZ, SZ } from "../../fx-lab/board";
import { LOCATION_HAND, LOCATION_MZONE, POS_FACEDOWN_DEFENSE, POS_FACEUP_DEFENSE, zoneKey } from "../../constants";
import {
  fixtureEngine,
  fixtureLog,
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
 * 3-way free-for-all, the "3way-final" mock. Ren Arata is you (seat 0, Violet, 8000 LP), Ryo Sato is Ice (seat 1, 5400 LP),
 * Mika Hana is Verdant (seat 2, 2100 LP). It is turn 5 and Ren plays; attacks have been open since turn 3, so the
 * battle states are real. Hand-made for the table stage: every state edits one shared board.
 */
const NAMES = ["Ren Arata", "Ryo Sato", "Mika Hana"] as const;
const CLOCK_MS = [192_000, 240_000, 205_000] as const;
const REN = 0;
const RYO = 1;
const MIKA = 2;

/** The last plays of turns 3 to 5, the rows of the history rail. Each carries the seat that did it. */
function history(): DuelEvent[] {
  const specs = [
    ev.phase("Main Phase 1"),
    ev.summon(RYO, C.blueEyes, MZ(RYO, 1), "tribute"),
    ev.set(RYO, C.mirrorForce, SZ(RYO, 1)),
    ev.phase("Main Phase 1"),
    ev.summon(MIKA, C.redEyes, MZ(MIKA, 0)),
    ev.summon(MIKA, C.gaia, MZ(MIKA, 2)),
    ev.attack(MIKA, MZ(MIKA, 0), MZ(RYO, 1)),
    ev.damage(MIKA, 1200),
    ev.phase("Main Phase 1"),
    ev.summon(REN, C.darkMagician, MZ(REN, 0)),
    ev.destroy(MIKA, C.gaia, MZ(MIKA, 2), { cause: "effect", sourceCode: C.raigeki.code, sourceKind: "spell", sourceSeat: REN }),
    ev.toGrave(MIKA, C.gaia, MZ(MIKA, 2), 0, { cause: "effect", sourceCode: C.raigeki.code, sourceKind: "spell", sourceSeat: REN }),
  ];
  return specs.map((spec, index) => ({ ...spec, id: index + 1 }) as DuelEvent);
}

/** The Text log of the same plays, as the engine words them. Ren is Player 1, Ryo Player 2, Mika Player 3. */
function textLog(): DuelEngineView["log"] {
  return fixtureLog(
    "Turn 3 — Player 2", "main1",
    "Player 2 Tribute Summons Blue-Eyes White Dragon",
    "Player 2 Sets a card",
    "Turn 4 — Player 3", "main1",
    "Player 3 Normal Summons Red-Eyes Black Dragon",
    "Player 3 Normal Summons Gaia The Fierce Knight",
    "battle", "A monster declares an attack",
    "Player 3 takes 1200 damage",
    "Turn 5 — Player 1", "draw",
    "Player 1 drew 1 card(s)", "You drew Heavy Storm",
    "main1",
    "Player 1 Normal Summons Dark Magician",
    "Raigeki is activating",
    "Gaia The Fierce Knight was destroyed",
  );
}

const MASTERS = [
  { seat: REN, card: C.envoy, returns: 1, nextCost: 1000 },
  { seat: RYO, card: C.blueEyes, returns: 0, nextCost: 0 },
  { seat: MIKA, card: C.redEyes, returns: 2, nextCost: 1500 },
] as const;

function board(): DuelSeatView[] {
  const ren = newSeat(REN, { lp: 8000, hand: [C.raigeki, C.potOfGreed, C.celtic, C.solemn, C.heavyStorm], deck: 29, extra: [C.darkPaladin, C.stardust] });
  putMonster(ren, 0, C.darkMagician);
  putMonster(ren, 1, C.celtic);
  putMonster(ren, 5, C.jinzo);
  putSpell(ren, 0, null);
  putSpell(ren, 1, null);
  const ryo = newSeat(RYO, { lp: 5400, hand: [null, null, null, null], deck: 30, extra: [null, null] });
  putMonster(ryo, 1, C.blueEyes);
  putMonster(ryo, 3, C.envoy);
  putSpell(ryo, 0, null);
  putSpell(ryo, 1, null);
  putSpell(ryo, 2, null);
  const mika = newSeat(MIKA, { lp: 2100, hand: [null, null, null], deck: 27, extra: [null] });
  putMonster(mika, 0, C.redEyes);
  putMonster(mika, 2, C.gaia);
  putSpell(mika, 0, null);
  putSpell(mika, 1, null);
  const views = [ren, ryo, mika];
  for (const master of MASTERS) views[master.seat].deckMaster = { card: { ...master.card }, inZone: false, returns: master.returns, nextCost: master.nextCost };
  return views;
}

const monsterOption = (seat: number, sequence: number, label: string): DuelPromptOption => ({
  id: `m${seat}-${sequence}`,
  label,
  controller: seat,
  location: LOCATION_MZONE,
  sequence,
});

const handOption = (sequence: number, label: string): DuelPromptOption => ({
  id: `h${sequence}`,
  label: `Activate ${label}`,
  controller: REN,
  location: LOCATION_HAND,
  sequence,
});

function foeMonsterOptions(seats: DuelSeatView[]): DuelPromptOption[] {
  return [RYO, MIKA].flatMap((seat) =>
    seats[seat].monsters.flatMap((card, sequence) => (card && sequence < 7 ? [monsterOption(seat, sequence, card.name ?? "Monster")] : [])),
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
  const viewerSeat = spec.viewerSeat === undefined ? REN : spec.viewerSeat;
  let seats = board();
  spec.edit?.(seats);
  // A rival, or a spectator, never sees a hand: the engine sends hidden cards. Only the viewer's own hand stays face up.
  seats = viewerSeat == null ? withHiddenHands(seats) : seats;
  const engine = fixtureEngine({
    format: "ffa3",
    seats,
    turn: 5,
    turnSeat: spec.turnSeat ?? REN,
    phase: spec.phase ?? "main1",
    battleStep: spec.battleStep,
    prompt: spec.prompt?.(seats) ?? null,
    chain: spec.chain,
    events: history(),
    log: textLog(),
    result: spec.result,
  });
  return { id, label, room: fixtureRoom({ format: "ffa3", names: NAMES, viewerSeat, engine, clockMs: CLOCK_MS, mode: "domain" }), ui: spec.ui };
}

const attackerKey = zoneKey(REN, LOCATION_MZONE, 0);

const states = {
  main: make("main", "Main Phase", {
    prompt: () => ({
      id: "main-action",
      seat: REN,
      kind: "choice",
      title: "Main Phase 1",
      context: { type: "action", phase: "main" },
      options: [
        handOption(0, C.raigeki.name),
        handOption(2, C.celtic.name),
        handOption(4, C.heavyStorm.name),
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
      seat: REN,
      kind: "cards",
      title: "Select an attack target",
      min: 1,
      max: 1,
      options: foeMonsterOptions(seats),
    }),
    ui: { aim: { mode: "aim", from: attackerKey, to: { zones: [zoneKey(RYO, LOCATION_MZONE, 1)] } } },
  }),
  "chain-2": make("chain-2", "Chain link 2: respond", {
    phase: "battle",
    battleStep: "battle",
    edit: (seats) => {
      putSpell(seats[RYO], 1, C.mirrorForce);
      putSpell(seats[MIKA], 0, C.callOfTheHaunted);
    },
    chain: [link(1, RYO, C.mirrorForce), link(2, MIKA, C.callOfTheHaunted)],
    prompt: () => ({
      id: "chain-2",
      seat: REN,
      kind: "choice",
      title: `${NAMES[MIKA]} activated ${C.callOfTheHaunted.name}. Respond?`,
      context: { type: "chain", forced: false },
      cancelable: true,
      options: [{ id: "activate", label: `Activate ${C.solemn.name}`, card: C.solemn }],
    }),
  }),
  "target-pick": make("target-pick", "Pick a target", {
    prompt: (seats) => ({
      id: "target-pick",
      seat: REN,
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
      seat: REN,
      kind: "choice",
      title: "Choose an opponent",
      context: { type: "opponent" },
      options: [RYO, MIKA].map((seat) => ({ id: `opp-${seat}`, label: `Choose ${NAMES[seat]} as the opponent`, controller: seat })),
    }),
  }),
  "direct-attack": make("direct-attack", "Direct attack", {
    phase: "battle",
    battleStep: "battle",
    edit: (seats) => {
      seats[RYO].monsters = seats[RYO].monsters.map(() => null);
    },
    prompt: () => ({
      id: "direct-attack",
      seat: REN,
      kind: "choice",
      title: "Select a duelist to attack",
      options: [{ id: `direct-${RYO}`, label: `Attack ${NAMES[RYO]} directly`, controller: RYO }],
    }),
    ui: { aim: { mode: "aim", from: attackerKey, to: { lpSeat: RYO } } },
  }),
  elimination: make("elimination", "Elimination", {
    phase: "battle",
    battleStep: "damage",
    edit: (seats) => {
      const mika = seats[MIKA];
      mika.lp = 0;
      mika.eliminated = true;
      mika.hand = [];
      mika.monsters = mika.monsters.map(() => null);
      mika.spells = mika.spells.map(() => null);
    },
  }),
  spectator: make("spectator", "Spectator", { viewerSeat: null }),
  result: make("result", "Result", {
    edit: (seats) => {
      for (const seat of [RYO, MIKA]) {
        seats[seat].lp = 0;
        seats[seat].eliminated = true;
      }
    },
    result: { winnerSeat: REN, winnerTeam: null, reason: "Last duelist standing" },
    // Mika left first (3rd), then Ryo (2nd).
    ui: { initialOutOrder: [[MIKA], [RYO]] },
  }),
} satisfies Record<TableStateId, TableFixtureState>;

export const FFA3_FIXTURES: TableFixtureSet = { format: "ffa3", title: "3-way free-for-all", states };

/** Monsters in Defense Position on every field (the `?def=1` preview): face-up and set, side by side, so a turned card next to an upright one shows the zone it keeps. */
const DEFENSE_ROWS = [
  [C.darkMagician, C.celtic, C.envoy, C.jinzo, C.sangan],
  [C.blueEyes, C.sangan, C.gaia, C.summonedSkull, C.redEyes],
  [C.redEyes, C.gaia, C.cyberDragon, C.sangan, C.blackChaos],
] as const;

export type Ffa3PreviewPick = "def";

/**
 * A preview variant of the 3-way fixtures: `out` sweeps those seats (as the engine does: no LP, an empty board, the
 * elimination order); `defense` lays Defense Position monsters on every field; `pick: "def"` asks you to pick one monster
 * on any field (yours included), so the turned cards are the targets.
 */
export function ffa3Variant(set: TableFixtureSet, opts: { out: readonly number[]; defense?: boolean; pick?: Ffa3PreviewPick | null }): TableFixtureSet {
  if (opts.out.length === 0 && !opts.defense && !opts.pick) return set;
  const states = Object.fromEntries(
    Object.entries(set.states).map(([id, state]) => {
      const engine = state.room.engine!;
      const seats = engine.seats.map((view) => ({ ...view }));
      for (const seat of opts.out) {
        const view = seats[seat];
        view.lp = 0;
        view.eliminated = true;
        view.hand = [];
        view.monsters = view.monsters.map(() => null);
        view.spells = view.spells.map(() => null);
      }
      if (opts.defense || opts.pick === "def") {
        for (const view of seats) {
          if (view.eliminated) continue;
          view.monsters = [...view.monsters];
          DEFENSE_ROWS[view.seat].forEach((card, sequence) => putMonster(view, sequence, card, sequence % 2 === 0 ? POS_FACEUP_DEFENSE : POS_FACEDOWN_DEFENSE));
        }
      }
      let prompt = engine.prompt;
      if (opts.pick === "def" && state.room.mySeat === REN) {
        const options = seats.flatMap((view) =>
          view.eliminated ? [] : view.monsters.flatMap((card, sequence) => (card && sequence < 5 ? [monsterOption(view.seat, sequence, card.name ?? "Monster")] : [])),
        );
        prompt = { id: "pick-def", seat: REN, kind: "cards", title: "Select 1 monster to destroy", min: 1, max: 1, options };
      }
      const order = opts.out.map((seat) => [seat]);
      const room = { ...state.room, engine: { ...engine, seats, prompt, ...(order.length > 0 ? { eliminationOrder: order } : {}) } };
      const ui = order.length > 0 ? { ...state.ui, initialOutOrder: order } : state.ui;
      return [id, { ...state, room, ui }];
    }),
  ) as unknown as TableFixtureSet["states"];
  return { ...set, states };
}
