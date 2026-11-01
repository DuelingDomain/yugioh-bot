import {
  parseSandboxBoard, parseSandboxRun, SandboxBoardError, SANDBOX_START_PHASES, seatCountFor,
  type DuelEngineView, type SandboxBoard, type SandboxCardSpec, type SandboxDuelistId,
  type SandboxDuelistSetup, type SandboxRun, type SandboxSnapshotResult, type SandboxStartPhase,
} from "@yugidraft/shared/duels";
import {
  OcgLocation as L, OcgPosition as P, OcgQueryFlags as Q, OcgType,
  type OcgCardQueryInfo, type OcgCoreSync, type OcgDuelHandle,
} from "ocgcore-wasm";

import type { DuelGameWorker } from "./worker-client.js";

/** Optional until the worker supplies a private raw-state query. */
export interface SandboxSnapshotWorker extends DuelGameWorker {
  sandboxSnapshot?(): Promise<SandboxEngineSnapshot>;
}

const SEATS: SandboxDuelistId[] = ["p0", "p1", "p2", "p3"];
const DECK_MASTER = 0x4000;
const PROC_COMPLETE = 0x8;
type QueryCard = Partial<OcgCardQueryInfo>;

/** Private worker data. Never put this unredacted state in a room or broadcast. */
export interface SandboxEngineSnapshot {
  view: DuelEngineView;
  locations: Array<Record<number, Array<QueryCard | null>>>;
}

class SnapshotError extends Error {
  readonly status = 409;
}

/** Query every physical zone, with no viewer filter. Overlays belong to their parent query. */
export function readSandboxEngineSnapshot(lib: OcgCoreSync, handle: OcgDuelHandle,
  view: DuelEngineView, domain: boolean, cardType: (code: number) => number | undefined): SandboxEngineSnapshot {
  const flags = (Q.CODE | Q.POSITION | Q.OVERLAY_CARD | Q.COUNTERS | Q.EQUIP_CARD
    | Q.OWNER | Q.STATUS | Q.IS_PUBLIC | Q.IS_HIDDEN | Q.TARGET_CARD) as Q;
  const zones: number[] = [L.DECK, L.HAND, L.MZONE, L.SZONE, L.GRAVE, L.REMOVED, L.EXTRA];
  if (domain) zones.push(DECK_MASTER);
  return { view, locations: view.seats.map(({ seat }) => Object.fromEntries(zones.map((location) => [location,
    // The installed wrapper cannot skip TYPE queries. Read static types from the same card
    // database as the duel; ongoing type-changing effects are part of the reported restore losses.
    lib.duelQueryLocation(handle, { flags, controller: seat as 0 | 1, location: location as L }).map((card) => {
      if (!card) return null;
      const type = cardType(card.code!);
      if (type === undefined) throw new SnapshotError(`Cannot capture card ${card.code}: card type is unavailable`);
      return { ...card, type: type as OcgType };
    }),
  ]))) };
}

/** Build only contract fields; reject states which cannot produce a valid board. */
export function buildSandboxSnapshot(raw: SandboxEngineSnapshot, source: SandboxBoard, run: SandboxRun): SandboxSnapshotResult {
  const { view, locations } = raw;
  const format = source.format ?? "1v1";
  if (view.result) throw new SnapshotError("This sandbox duel has ended");
  if (view.seats.length !== seatCountFor(format) || locations.length !== view.seats.length) {
    throw new SnapshotError("The engine snapshot has missing seats");
  }
  const battle = view.phase.startsWith("battle") || view.phase.startsWith("damage");
  const phase = battle ? "battle" : view.phase;
  if (!(SANDBOX_START_PHASES as readonly string[]).includes(phase)) throw new SnapshotError(`Cannot capture engine phase ${view.phase}`);
  if (!Number.isInteger(view.turnSeat) || !SEATS[view.turnSeat]) throw new SnapshotError("Cannot capture the turn player");
  const lost = new Set<string>([
    "Lasting effects, temporary stat changes, card relationships and effect history are not restored (including lasting effects not exposed by engine queries).",
    `The turn count (${view.turn}) and this-turn flags, summon limits, attack history and used effects are not restored.`,
    "Restart visits Draw Phase again: its draw and phase triggers can change the captured hand, Deck and field.",
  ]);
  const board: SandboxBoard = { format, mode: source.mode ?? "normal", masterRule: source.masterRule ?? 5,
    turn: SEATS[view.turnSeat], startAt: phase as SandboxStartPhase, deckSize: 0,
    attackFirstTurn: source.attackFirstTurn ?? false };
  if (battle && !board.attackFirstTurn) {
    board.attackFirstTurn = true;
    lost.add("attackFirstTurn is enabled so the captured Battle Phase can start in the first round.");
  }
  if (battle && view.phase !== "battle") lost.add(`Battle subphase ${view.phase} and the current attack restart at the start of Battle Phase.`);
  if (view.chain.length) lost.add("The open chain, targets and pending resolutions are not restored.");
  if (view.prompt) lost.add("The current prompt, pending choices and response window are not restored.");
  const sizes: number[] = [];
  const eliminated: SandboxDuelistId[] = [];
  for (let seat = 0; seat < view.seats.length; seat++) {
    const live = view.seats[seat];
    const id = SEATS[seat];
    if (live.seat !== seat) throw new SnapshotError("The engine snapshot has invalid seat order");
    if (live.pendingElimination) throw new SnapshotError("Wait for the pending elimination to finish before saving");
    const setup: SandboxDuelistSetup = format === "tag" && seat >= 2 ? {} : { lp: live.lp };
    board[id] = setup;
    if (live.eliminated) {
      eliminated.push(id);
      continue;
    }
    if (live.disabledZones) lost.add(`${id}: disabled zones are not restored.`);
    const zones = locations[seat];
    const zone = (location: number): Array<QueryCard | null> => {
      const cards = zones[location];
      if (!cards) throw new SnapshotError(`${id}: missing engine location ${location}`);
      return cards;
    };
    const code = (card: QueryCard, path: string): number => {
      if (!Number.isInteger(card.code) || !card.code || card.code < 0) throw new SnapshotError(`${path}: engine card has no valid passcode`);
      if ((card.type ?? 0) & OcgType.TOKEN) throw new SnapshotError(`${path}: Tokens cannot be restored by a sandbox board`);
      if (card.counters && Object.values(card.counters).some((count) => count > 0)) lost.add(`${path}: counters are not restored.`);
      if (card.equipCard) lost.add(`${path}: equip links are not restored.`);
      if (card.targetCards?.length) lost.add(`${path}: card target links are not restored.`);
      if (card.owner !== undefined && card.owner !== seat) lost.add(`${path}: original card ownership is replaced by its controller.`);
      if (card.isPublic || card.isHidden) lost.add(`${path}: visibility effects are not restored.`);
      return card.code;
    };
    const entry = (card: QueryCard | null, path: string, monster: boolean): SandboxCardSpec | null => {
      if (!card) return null;
      const position = card.position ?? 0;
      if (!position) throw new SnapshotError(`${path}: engine card has no position`);
      const result: SandboxCardSpec = { card: code(card, path),
        pos: position & P.FACEDOWN ? "set" : monster ? position & P.FACEUP_DEFENSE ? "def" : "atk" : "up" };
      if (monster) {
        if (card.status === undefined) lost.add(`${path}: proper summon status is unavailable; the card is restored as not properly summoned.`);
        result.summoned = ((card.status ?? 0) & PROC_COMPLETE) !== 0;
        if (position & P.FACEDOWN_ATTACK) lost.add(`${path}: face-down Attack Position becomes face-down Defense Position.`);
        if (card.overlayCards?.length) {
          result.materials = [...card.overlayCards];
          lost.add(`${path}: Xyz material ownership, status and effects are not exposed by the overlay query and are not restored.`);
        }
      } else if (card.overlayCards?.length) {
        throw new SnapshotError(`${path}: materials on a non-monster zone cannot be restored`);
      }
      return result;
    };
    const pile = (location: number, name: string, facedown: boolean): number[] => zone(location).flatMap((card, index) => {
      if (!card) throw new SnapshotError(`${id}.${name}[${index}]: missing engine card`);
      const path = `${id}.${name}[${index}]`;
      if (!!((card.position ?? 0) & P.FACEDOWN) !== facedown) lost.add(`${id}.${name}: pile position loss; cards restart ${facedown ? "face-down" : "face-up"}.`);
      if ((card.status ?? 0) & PROC_COMPLETE) lost.add(`${path}: proper summon status in this pile is not restored.`);
      return [code(card, path)];
    });
    setup.hand = zone(L.HAND).map((card, index) => {
      if (!card) throw new SnapshotError(`${id}.hand[${index}]: missing engine card`);
      return code(card, `${id}.hand[${index}]`);
    });
    setup.monsters = zone(L.MZONE).map((card, index) => entry(card, `${id}.monsters[${index}]`, true));
    const spells = zone(L.SZONE);
    if (spells.slice(8).some(Boolean)) throw new SnapshotError(`${id}: unsupported Spell/Trap zone`);
    setup.spells = spells.slice(0, 5).map((card, index) => entry(card, `${id}.spells[${index}]`, false));
    if (spells[5]) setup.field = entry(spells[5], `${id}.field`, false)!;
    if (spells[6] || spells[7]) setup.pendulum = [entry(spells[6] ?? null, `${id}.pendulum[0]`, false), entry(spells[7] ?? null, `${id}.pendulum[1]`, false)];
    if ((board.masterRule ?? 5) >= 4 && [0, 4].some((index) => ((spells[index]?.type ?? 0) & OcgType.PENDULUM) !== 0)) {
      lost.add(`${id}: Pendulum Zone status in shared Spell/Trap slots is not exposed by the query; cards restart as Spell/Trap placements.`);
    }
    setup.deck = pile(L.DECK, "deck", true).reverse(); // Core sequence 0 is the bottom.
    setup.extra = pile(L.EXTRA, "extra", true);
    setup.grave = pile(L.GRAVE, "grave", false);
    setup.banished = pile(L.REMOVED, "banished", false);
    sizes.push(setup.deck.length);
    if (board.mode === "domain") {
      const master = live.deckMaster;
      if (!master?.inZone) throw new SnapshotError(`${id}: a deployed or missing Deck Master cannot be restored without duplicating it`);
      const masters = zone(DECK_MASTER).filter((card): card is QueryCard => card !== null);
      if (masters.length !== 1) throw new SnapshotError(`${id}: the live Deck Master zone is incomplete`);
      setup.deckMaster = code(masters[0], `${id}.deckMaster`);
      if (masters[0].position !== P.FACEUP_ATTACK) lost.add(`${id}.deckMaster: the Deck Master restarts in face-up Attack Position.`);
      if (master.returns) lost.add(`${id}: Deck Master return count and recall cost are reset.`);
    }
  }
  if (eliminated.length) board.eliminated = eliminated;
  board.deckSize = Math.max(0, ...sizes);
  if (new Set(sizes).size > 1) lost.add(`The unequal Deck sizes (${sizes.join(", ")}) use one deckSize; smaller Decks gain filler cards on restart.`);
  if (view.eliminationOrder?.length) lost.add("The order of previous eliminations is not restored.");
  try {
    return { board: parseSandboxBoard(board), run: parseSandboxRun(run), lost: [...lost] };
  } catch (error) {
    if (error instanceof SandboxBoardError) throw new SnapshotError(`Cannot save this state: ${error.path}: ${error.message}`);
    throw error;
  }
}
