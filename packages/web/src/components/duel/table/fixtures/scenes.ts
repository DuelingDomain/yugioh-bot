import type { DuelCardInfo, DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";
import { applyEdits, edit, ev, EXTRA, GY, HAND, link, MZ, SZ, withHandIds, type Edit, type EventSpec, type LabBoard, type LabStep } from "../../fx-lab/board";
import { TABLE_CARDS as C } from "./common";
import { POS_FACEDOWN_DEFENSE, POS_FACEUP_ATTACK } from "../../constants";

/**
 * Timed event scripts for the table previews (`?scene=<id>`). A scene is the same kind of step the FX lab plays on the
 * 1v1 board: events and board edits arrive together, as one engine batch does. The preview harness feeds them into a
 * fixture state, so the real table layers (MoveFx, ChainFx, BattleFx, the crumble) play them on a grid seat.
 */
export type SceneId = "smf" | "ko" | "mirror" | PlaySceneId;

/** `<play>-<seat>`: that seat Normal Summons, Special Summons, Fusion Summons, Sets or Flip Summons a monster in its zone 4 (`?scene=normal-1`). */
export type PlaySceneId = `${"normal" | "special" | "fusion" | "set" | "flip"}-${0 | 1 | 2 | 3}`;

const STORMING_MIRROR_FORCE: DuelCardInfo = {
  code: 5650082,
  name: "Storming Mirror Force",
  description: "When an opponent's monster declares an attack: Return all Attack Position monsters your opponents control to the hand.",
  type: 0x4 | 0x20000, // trap, normal
  attack: 0,
  defense: 0,
  level: 0,
  attribute: 0,
  race: "",
};

const REN = 0;
const RYO = 1;
const MIKA = 2;

/** The seat is out: the engine empties its board and flags it. */
const eliminate = (seat: number): Edit => (board) => {
  const view = board.seats[seat];
  view.eliminated = true;
  view.lp = 0;
  view.monsters = view.monsters.map(() => null);
  view.spells = view.spells.map(() => null);
  view.hand = [];
  view.graveyard = [];
  view.banished = [];
};

/** Ren (the viewer) holds Storming Mirror Force; Ryo attacks Ren's monster. Every rival Attack Position monster returns to its hand. */
function smf(): LabStep[] {
  const smfInfo = STORMING_MIRROR_FORCE;
  const hands = [RYO, MIKA];
  const returns = [
    { seat: RYO, info: C.blueEyes, from: MZ(RYO, 1) },
    { seat: RYO, info: C.envoy, from: MZ(RYO, 3) },
    { seat: MIKA, info: C.redEyes, from: MZ(MIKA, 0) },
    { seat: MIKA, info: C.gaia, from: MZ(MIKA, 2) },
  ];
  const sizes = new Map<number, number>(hands.map((seat) => [seat, 4]));
  const moves: EventSpec[] = [];
  const edits: Edit[] = [];
  returns.forEach((entry, index) => {
    const to = sizes.get(entry.seat) ?? 0;
    sizes.set(entry.seat, to + 1);
    moves.push(ev.move(entry.seat, entry.info, entry.from, HAND(entry.seat, to), "return", { handId: `sleeve-9${index}` }));
    edits.push(edit.monster(entry.seat, entry.from.sequence, null), edit.addHand(entry.seat, null), (board) => {
      const hand = board.seats[entry.seat].hand;
      hand[hand.length - 1].handId = `sleeve-9${index}`;
    });
  });
  const set = edit.setSpell(REN, 0, smfInfo);
  return [
    { at: 0, edits: [set] },
    { at: 600, events: [ev.attack(RYO, MZ(RYO, 1), MZ(REN, 0))] },
    { at: 1800, events: [ev.activate(REN, smfInfo, SZ(REN, 0), 1)], edits: [edit.spell(REN, 0, smfInfo)], chain: [link(1, REN, smfInfo)] },
    { at: 4200, events: [ev.chain("chain-resolving", REN, smfInfo, 1), ...moves], edits },
    {
      at: 6200,
      events: [ev.chain("chain-resolved", REN, smfInfo, 1), ev.chainEnd(), ev.move(REN, smfInfo, SZ(REN, 0), GY(REN, 0), "other")],
      edits: [edit.spell(REN, 0, null), edit.grave(REN, smfInfo)],
      chain: [],
    },
  ];
}

/** Ren attacks Mika's Red-Eyes; Mika is at 100 LP and goes out. The attack, the damage and the LP change come before the crumble. */
function knockOut(): LabStep[] {
  return [
    { at: 0, edits: [edit.lp(MIKA, 100)] },
    { at: 600, events: [ev.attack(REN, MZ(REN, 0), MZ(MIKA, 0))] },
    {
      at: 1500,
      events: [
        ev.damage(MIKA, 100),
        ev.destroy(MIKA, C.redEyes, MZ(MIKA, 0), { cause: "battle" }),
        ev.toGrave(MIKA, C.redEyes, MZ(MIKA, 0), 0, { cause: "battle" }),
      ],
      edits: [eliminate(MIKA)],
    },
  ];
}

/** The same fight as the 1v1 lab (an attacker beats a monster in Attack Position), on a grid seat, for the timing reference. */
function mirror(): LabStep[] {
  return [
    { at: 600, events: [ev.attack(REN, MZ(REN, 0), MZ(RYO, 1))] },
    {
      at: 1500,
      events: [
        ev.damage(RYO, 100),
        ev.destroy(RYO, C.blueEyes, MZ(RYO, 1), { cause: "battle" }),
        ev.toGrave(RYO, C.blueEyes, MZ(RYO, 1), 0, { cause: "battle" }),
      ],
      edits: [edit.monster(RYO, 1, null), edit.grave(RYO, C.blueEyes), edit.lp(RYO, 4900)],
    },
  ];
}

const PLAY_SCENE = /^(normal|special|fusion|set|flip)-([0-3])$/;

/**
 * One seat plays a monster from its hand (or flips one up) into its zone 4: the card must face its controller from the
 * first frame of the flight to the last. The play comes after a quiet first step, so the layers have drawn the board.
 */
function playMonster(play: "normal" | "special" | "fusion" | "set" | "flip", seat: number): LabStep[] {
  const fusion = play === "fusion";
  const info = C.celtic; // a light card: a heavy one takes the slam path, not the typed summon
  const zone = MZ(seat, 4);
  const handIndex = 0;
  const events: EventSpec[] =
    play === "set"
      ? [ev.move(seat, null, HAND(seat, handIndex), zone, "set", { faceDown: true }), ev.set(seat, info, zone)]
      : play === "flip"
        ? [ev.position(seat, info, zone, POS_FACEDOWN_DEFENSE, POS_FACEUP_ATTACK, true), ev.summon(seat, info, zone, "flip")]
        : [ev.move(seat, info, fusion ? EXTRA(seat, 0) : HAND(seat, handIndex), zone, "summon"), ev.summon(seat, info, zone, play)];
  const edits: Edit[] = [play === "set" ? edit.hiddenMonster(seat, 4) : edit.monster(seat, 4, info)];
  if (play !== "flip" && !fusion) edits.push(edit.removeHand(seat, handIndex));
  return [
    { at: 0, edits: play === "flip" ? [edit.hiddenMonster(seat, 4)] : [] },
    { at: 600, events, edits: play === "flip" ? [edit.monster(seat, 4, info)] : edits },
  ];
}

export function isSceneId(value: string | null | undefined): value is SceneId {
  return value === "smf" || value === "ko" || value === "mirror" || (value != null && PLAY_SCENE.test(value));
}

export function sceneSteps(id: SceneId): LabStep[] {
  const play = PLAY_SCENE.exec(id);
  if (play) return playMonster(play[1] as "normal" | "special" | "fusion" | "set" | "flip", Number(play[2]));
  return id === "smf" ? smf() : id === "ko" ? knockOut() : mirror();
}

/** The engine view after the first `count` steps of a scene. Event ids continue the fixture's own history. */
export function engineAtStep(base: DuelEngineView, steps: readonly LabStep[], count: number, viewer: number | null): DuelEngineView {
  let board: LabBoard = { seats: base.seats, chain: base.chain ?? [], phase: base.phase, turnSeat: base.turnSeat };
  let events: DuelEvent[] = [...base.events];
  let nextId = Math.max(0, ...events.map((event) => event.id)) + 1000;
  let chain = base.chain;
  let battleStep = base.battleStep;
  steps.slice(0, count).forEach((step, index) => {
    board = applyEdits(board, step.edits ?? []);
    const numbered = (step.events ?? []).map((spec) => ({ ...spec, id: ++nextId }) as DuelEvent);
    if (index === 0) {
      const dealt = withHandIds(board, numbered, viewer);
      board = dealt.board;
      events = [...events, ...dealt.events];
    } else {
      events = [...events, ...numbered];
    }
    if (step.chain) chain = step.chain;
    if (numbered.some((event) => event.kind === "attack")) battleStep = "battle";
  });
  return { ...base, seats: board.seats, chain, events, battleStep, phase: steps.slice(0, count).some((step) => step.events?.some((e) => e.kind === "attack")) ? "battle" : base.phase };
}

