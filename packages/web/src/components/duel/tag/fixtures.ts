import type { DuelChainLink, DuelEngineView, DuelEvent, DuelPrompt, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import { ev, MZ } from "../fx-lab/board";
import { LOCATION_HAND, LOCATION_MZONE, LOCATION_SZONE, zoneKey } from "../constants";
import {
  cardAt,
  fixtureEngine,
  fixtureLog,
  hiddenAt,
  fixtureRoom,
  link,
  newSeat,
  putMonster,
  putSpell,
  SZ,
  TABLE_CARDS as C,
  withHiddenHands,
  type TableFixtureSet,
  type TableFixtureState,
  type TableStateId,
} from "../table/fixtures/common";

/**
 * 2v2 tag, "Starfall vs Thornveil" (BRIEF-MODES 5.2). Turn order: Aster Vale 1A (seat 0, you), Mirelle Quay 2A (seat 1),
 * Corvin Hale 1B (seat 2, your partner), Juniper Rook 2B (seat 3). Team LP is shared, so both seats of a team hold the
 * same number. It is turn 5 and Aster plays. Your team sees Corvin's hand and Set cards; rival hands are hidden.
 * Hand-made for the tag stage: every state edits one shared board.
 */
export const TAG_NAMES = ["Aster Vale", "Mirelle Quay", "Corvin Hale", "Juniper Rook"] as const;
export const TAG_TEAM_NAMES = ["Starfall", "Thornveil"] as const;
const CLOCK_MS = [168_000, 211_000, 300_000, 245_000] as const;
const ASTER = 0;
const MIRELLE = 1;
const CORVIN = 2;
const JUNIPER = 3;
const RIVALS = [MIRELLE, JUNIPER] as const;

const POS_SET = 0x0a;

/** The last plays of turns 2 to 5, the rows of the Log. Each carries the seat that did it. Corvin's Set card is his team's to see. */
function history(): DuelEvent[] {
  const specs = [
    ev.phase("Turn 2"),
    ev.summon(MIRELLE, C.summonedSkull, MZ(MIRELLE, 0)),
    ev.phase("Turn 3"),
    ev.set(CORVIN, C.torrential, SZ(CORVIN, 0)),
    ev.phase("Turn 4"),
    ev.summon(JUNIPER, C.gaia, MZ(JUNIPER, 2)),
    ev.attack(JUNIPER, MZ(JUNIPER, 0), MZ(CORVIN, 0)),
    { kind: "damage", seat: CORVIN, amount: 1_200, cause: "battle", text: `${TAG_NAMES[CORVIN]} took 1200 damage` } as const,
    ev.phase("Turn 5"),
    ev.summon(ASTER, C.darkMagician, MZ(ASTER, 0)),
  ];
  return specs.map((spec, index) => ({ ...spec, id: index + 1 }) as DuelEvent);
}

/** The Text log of the same plays, as the engine words them. Aster is Player 1, Mirelle Player 2, Corvin Player 3, Juniper Player 4. */
function textLog(): DuelEngineView["log"] {
  return fixtureLog(
    "Turn 2 — Player 2", "main1",
    "Player 2 Normal Summons Summoned Skull",
    "Turn 3 — Player 3", "main1",
    "Player 3 Sets a card",
    "Turn 4 — Player 4", "main1",
    "Player 4 Normal Summons Gaia The Fierce Knight",
    "battle", "A monster declares an attack",
    "Player 3 takes 1200 damage",
    "Turn 5 — Player 1", "draw",
    "Player 1 drew 1 card(s)", "You drew Pot of Greed",
    "main1",
    "Player 1 Normal Summons Dark Magician",
  );
}

function board(): DuelSeatView[] {
  const aster = newSeat(ASTER, { lp: 11800, hand: [C.darkHole, C.featherDuster, C.celtic, C.solemn, C.potOfGreed], deck: 30, extra: [C.darkPaladin] });
  putMonster(aster, 0, C.darkMagician);
  putMonster(aster, 1, C.celtic);
  // The shared Extra Monster Zones of both facing pairs, one cell held by each side: 1A and 2A (Aster left, Mirelle right) and
  // 1B and 2B (Juniper left, Corvin right). Seat 5 and the facing seat's 6 are one cell, and so are 6 and 5.
  putMonster(aster, 5, C.darkPaladin);
  aster.spells[0] = cardAt(C.callOfTheHaunted, SZ(ASTER, 0), POS_SET);
  putSpell(aster, 1, null);
  const mirelle = newSeat(MIRELLE, { lp: 9400, hand: [null, null, null], deck: 28, extra: [null] });
  putMonster(mirelle, 0, C.summonedSkull);
  putMonster(mirelle, 2, C.envoy);
  putMonster(mirelle, 5, C.jinzo);
  putSpell(mirelle, 0, null);
  putSpell(mirelle, 1, null);
  const corvin = newSeat(CORVIN, { lp: 11800, hand: [C.jinzo, C.torrential, C.darkMagician, C.potOfGreed], deck: 29, extra: [null] });
  putMonster(corvin, 0, C.blueEyes);
  putMonster(corvin, 6, C.celtic);
  corvin.spells[0] = cardAt(C.torrential, SZ(CORVIN, 0), POS_SET);
  putSpell(corvin, 1, null);
  const juniper = newSeat(JUNIPER, { lp: 9400, hand: [null, null, null, null], deck: 28, extra: [null] });
  putMonster(juniper, 0, C.redEyes);
  putMonster(juniper, 2, C.gaia);
  putMonster(juniper, 6, C.gaia);
  putSpell(juniper, 0, null);
  return [aster, mirelle, corvin, juniper];
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
  controller: ASTER,
  location: LOCATION_HAND,
  sequence,
});

function rivalMonsterOptions(seats: DuelSeatView[]): DuelPromptOption[] {
  return RIVALS.flatMap((seat) =>
    seats[seat].monsters.flatMap((card, sequence) => (card && sequence < 5 ? [monsterOption(seat, sequence, card.name ?? "Monster")] : [])),
  );
}

/** Every duelist of one team holds the same LP. */
function setTeamLp(seats: DuelSeatView[], team: number, lp: number): void {
  for (const view of seats) if (view.seat % 2 === team) view.lp = lp;
}

interface Spec {
  viewerSeat?: number | null;
  turnSeat?: number;
  phase?: string;
  battleStep?: DuelEngineView["battleStep"];
  edit?: (seats: DuelSeatView[]) => void;
  prompt?: (seats: DuelSeatView[]) => DuelPrompt | null;
  chain?: DuelChainLink[];
  events?: DuelEvent[];
  log?: DuelEngineView["log"];
  result?: DuelEngineView["result"];
  ui?: TableFixtureState["ui"];
}

function make(id: TableFixtureState["id"], label: string, spec: Spec = {}): TableFixtureState {
  const viewerSeat = spec.viewerSeat === undefined ? ASTER : spec.viewerSeat;
  let seats = board();
  spec.edit?.(seats);
  // Each seat shares its Extra Monster Zones with the seat it faces: 1A-2A and 1B-2B (a Tag core reports it per seat).
  // A seat that is out shares nothing (null), and neither does the seat that faced it.
  for (const view of seats) view.sharedExtraWith = view.eliminated || seats[view.seat ^ 1]?.eliminated ? null : view.seat ^ 1;
  if (viewerSeat == null) {
    // A spectator sees no hand and no Set card identity.
    seats = withHiddenHands(seats).map((view) => ({
      ...view,
      spells: view.spells.map((card) => (card && card.code != null && (card.position & POS_SET) !== 0 ? hiddenAt(SZ(view.seat, card.sequence), card.position) : card)),
    }));
  } else {
    // The viewer and the partner see their own hands. A rival hand arrives face-down, and so does a rival Set card.
    const hidden = withHiddenHands(seats);
    seats = seats.map((view, seat) => (seat % 2 === viewerSeat % 2 ? view : hidden[seat]));
  }
  const engine = fixtureEngine({
    format: "tag",
    seats,
    turn: 5,
    turnSeat: spec.turnSeat ?? ASTER,
    phase: spec.phase ?? "main1",
    battleStep: spec.battleStep,
    prompt: spec.prompt?.(seats) ?? null,
    chain: spec.chain,
    events: spec.events,
    log: spec.log ?? textLog(),
    result: spec.result,
  });
  return { id, label, room: fixtureRoom({ format: "tag", names: TAG_NAMES, viewerSeat, engine, clockMs: CLOCK_MS }), ui: spec.ui };
}

const attackerKey = zoneKey(ASTER, LOCATION_MZONE, 0);

const states = {
  main: make("main", "Main Phase: usable cards", {
    // The last plays of turns 3 and 4 (the Log), ending with last turn's battle damage: the red chip on the Starfall plate.
    events: history(),
    prompt: () => ({
      id: "main-action",
      seat: ASTER,
      kind: "choice",
      title: "Main Phase 1",
      context: { type: "action", phase: "main" },
      // The engine lists the phase moves in the same action prompt; the station track turns them into its buttons.
      options: [
        handOption(0, C.darkHole.name),
        handOption(1, C.featherDuster.name),
        handOption(4, C.potOfGreed.name),
        { id: "to_bp", label: "Go to the Battle Phase" },
        { id: "to_ep", label: "End the turn" },
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
      options: rivalMonsterOptions(seats),
    }),
    ui: { aim: { mode: "aim", from: attackerKey, to: { zones: [zoneKey(JUNIPER, LOCATION_MZONE, 0)] } } },
  }),
  "chain-2": make("chain-2", "Battle: chain of 2", {
    phase: "battle",
    battleStep: "battle",
    edit: (seats) => {
      seats[MIRELLE].spells[1] = cardAt(C.mirrorForce, SZ(MIRELLE, 1));
      seats[CORVIN].spells[0] = cardAt(C.mst, SZ(CORVIN, 0));
    },
    chain: [link(1, MIRELLE, C.mirrorForce), link(2, CORVIN, C.mst)],
    prompt: () => ({
      id: "chain-2",
      seat: ASTER,
      kind: "choice",
      title: `${TAG_NAMES[CORVIN]} activated ${C.mst.name}. Your team may respond.`,
      context: { type: "chain", forced: false },
      options: [
        {
          id: "activate",
          label: `Activate ${C.callOfTheHaunted.name}`,
          card: C.callOfTheHaunted,
          controller: ASTER,
          location: LOCATION_SZONE,
          sequence: 0,
        },
        { id: "pass", label: "Pass" },
      ],
    }),
  }),
  "target-pick": make("target-pick", "Pick a target", {
    prompt: (seats) => ({
      id: "target-pick",
      seat: ASTER,
      kind: "cards",
      title: "Select 1 monster to destroy",
      min: 1,
      max: 1,
      options: [
        ...rivalMonsterOptions(seats),
        // The partner's monster is a legal tribute / target too: Aster tributes Corvin's Blue-Eyes.
        monsterOption(CORVIN, 0, seats[CORVIN].monsters[0]?.name ?? "Monster"),
        // Rival monsters in the shared Extra Monster Zones: each is one legal target on its own seat and sequence.
        monsterOption(MIRELLE, 5, seats[MIRELLE].monsters[5]?.name ?? "Monster"),
        monsterOption(JUNIPER, 6, seats[JUNIPER].monsters[6]?.name ?? "Monster"),
      ],
    }),
  }),
  "choose-opponent": make("choose-opponent", "Choose an opponent", {
    prompt: () => ({
      id: "choose-opponent",
      seat: ASTER,
      kind: "choice",
      title: "Choose an opponent",
      context: { type: "opponent" },
      options: RIVALS.map((seat) => ({ id: `opp-${seat}`, label: `Choose ${TAG_NAMES[seat]} as the opponent`, controller: seat })),
    }),
  }),
  "direct-attack": make("direct-attack", "Direct attack: Juniper is open", {
    phase: "battle",
    battleStep: "battle",
    edit: (seats) => {
      seats[JUNIPER].monsters = seats[JUNIPER].monsters.map(() => null);
    },
    prompt: () => ({
      id: "direct-attack",
      seat: ASTER,
      kind: "choice",
      title: "Select a duelist to attack",
      options: [{ id: `direct-${JUNIPER}`, label: `Attack ${TAG_NAMES[JUNIPER]} directly`, controller: JUNIPER }],
    }),
    ui: { aim: { mode: "aim", from: attackerKey, to: { lpSeat: JUNIPER } } },
  }),
  elimination: make("elimination", "Team loss: Thornveil", {
    phase: "battle",
    battleStep: "damage",
    events: [{ id: 1, kind: "damage", seat: MIRELLE, amount: 9_400, cause: "battle", text: `${TAG_NAMES[MIRELLE]} took 9400 damage` }],
    edit: (seats) => {
      setTeamLp(seats, 1, 0);
      for (const seat of RIVALS) seats[seat].pendingElimination = true;
    },
  }),
  spectator: make("spectator", "Spectator view", { viewerSeat: null }),
  result: make("result", "Result: team win", {
    edit: (seats) => {
      setTeamLp(seats, 1, 0);
      for (const seat of RIVALS) {
        seats[seat].eliminated = true;
        seats[seat].hand = [];
      }
    },
    result: { winnerSeat: ASTER, winnerTeam: 0, reason: "The other team reached 0 LP" },
  }),
} satisfies Record<TableStateId, TableFixtureState>;

/** States only the Rooftop previews (`?state=emz-place`). */
const extra: Record<string, TableFixtureState> = {
  // Aster Special Summons Dark Paladin: the left cell shared with Mirelle is free, the right one holds her monster.
  "emz-place": make("emz-place", "Place in a shared Extra Monster Zone", {
    edit: (seats) => {
      seats[ASTER].monsters[5] = null;
    },
    prompt: () => ({
      id: "emz-place",
      seat: ASTER,
      kind: "places",
      title: `Select a zone for ${C.darkPaladin.name}`,
      min: 1,
      max: 1,
      options: [{ id: "place:5", label: "Extra Monster Zone, left", controller: ASTER, location: LOCATION_MZONE, sequence: 5 }],
    }),
  }),
};

export const TAG_FIXTURES: TableFixtureSet = { format: "tag", title: "2v2 tag duel", states, extra };
