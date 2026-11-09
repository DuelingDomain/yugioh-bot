import { cloneRemoteCurrent } from "./position.js";
import type { DuelDeck } from "../duels/index.js";
import { remoteAssert, type RemoteAction } from "./actions.js";
import { initialDeckChecks, type RemoteReductionContext } from "./deck-checks.js";
import { initializeRemoteHandCounts } from "./hand.js";
import { REMOTE_FIRST_CHOICE_MS, REMOTE_OPENING_ROUND_MS, REMOTE_SIDE_DECK_MS, REMOTE_SIDE_MS, REMOTE_SIDE_START_MS, remoteBestOfSchema, remoteMatchActionSchema,
  type RemoteGameResult, type RemoteMatch, type RemoteOpening, type RemoteSiding } from "./match-contract.js";
import type { GameModule, RemoteState } from "./types.js";

export function initialRemoteMatch(seatCount: number, bestOf: unknown = seatCount === 2 ? 3 : 1): RemoteMatch {
  const parsed = remoteBestOfSchema.safeParse(bestOf);
  remoteAssert(parsed.success, "Match bestOf must be 1 or 3");
  return { bestOf: parsed.data, games: [], phase: "duel" };
}

/** Legacy rooms retain single-game semantics. No state or event rows need rewriting. */
export function ensureRemoteMatch(state: RemoteState): RemoteState {
  if (!state.match) {
    state.match = initialRemoteMatch(state.seatCount, 1);
    if (state.ended) finishRemoteGame(state, state.winnerSeat, "lp", state.updatedAt);
  }
  const siding = state.match.siding;
  if (siding && !siding.seatDeadlines) {
    siding.seatDeadlines = Object.fromEntries(state.seats.map(s => [s.seat, remoteSideDeadline(siding, s.seat)]));
  }
  return state;
}

export function finishRemoteGame(state: RemoteState, winnerSeat: number | null, reason: RemoteGameResult["reason"], at: number): void {
  const match = state.match;
  match.games.push({ n: match.games.length + 1, winnerSeat, reason, endedAt: at });
  delete match.pendingResult;
  state.ended = true; state.winnerSeat = winnerSeat; state.attack = null;
  const wins = winnerSeat === null ? 0 : match.games.filter(g => g.winnerSeat === winnerSeat).length;
  if (match.bestOf === 1 || wins >= Math.ceil(match.bestOf / 2)) {
    match.phase = "done"; match.winnerSeat = winnerSeat;
    delete match.firstChooser; delete match.firstSeat;
  } else {
    match.phase = "result";
    const contenders = state.seats.filter(s => !s.accountDeleted);
    match.firstChooser = winnerSeat === null ? null : Array.from({length:state.seatCount},(_,i)=>(winnerSeat+i+1)%state.seatCount)
      .find(seat=>contenders.some(s=>s.seat===seat)) ?? null;
    if (winnerSeat === null) match.firstSeat = state.startedSeats[0] ?? 0;
    else delete match.firstSeat;
  }
}

export function remoteSideDeadline(siding: RemoteSiding, seat: number): number {
  return siding.seatDeadlines?.[seat] ?? siding.deadline - (siding.extendedFor.length && !siding.extendedFor.includes(seat) ? REMOTE_SIDE_DECK_MS - REMOTE_SIDE_MS : 0);
}

/**
 * Rolls one die per seat; the tied top seats roll again until a single seat is highest. `rollDie` returns 1 to 6
 * and must be a fair source on the server. The winner chooses who goes first before the returned deadline.
 */
export function rollRemoteOpening(seatCount: number, at: number, rollDie: () => number): RemoteOpening {
  const rounds: (number | null)[][] = [];
  let contenders = Array.from({ length: seatCount }, (_, seat) => seat);
  while (contenders.length > 1) {
    remoteAssert(rounds.length < 100, "The opening roll did not settle");
    const round = Array.from({ length: seatCount }, (_, seat) => contenders.includes(seat) ? rollDie() : null);
    const top = Math.max(...round.filter((roll): roll is number => roll !== null));
    contenders = contenders.filter(seat => round[seat] === top);
    rounds.push(round);
  }
  return { rounds, winnerSeat: contenders[0], startedAt: at, deadline: at + rounds.length * REMOTE_OPENING_ROUND_MS + REMOTE_FIRST_CHOICE_MS };
}

/** Game 1 waits for the die-roll winner. Tables without an opening never wait. */
export function remoteOpeningPending(match: RemoteMatch | undefined): match is RemoteMatch & { opening: RemoteOpening } {
  return match?.phase === "duel" && match.opening !== undefined && match.opening.chosenSeat === undefined;
}

/**
 * The seat that chooses who goes first: the die-roll winner, or, when the winner is out of the game, the next living seat by
 * roll order (highest latest roll first, lower seat number on equal rolls).
 */
export function remoteOpeningChooser(opening: RemoteOpening, seats: readonly { eliminated?: boolean }[]): number {
  const latest = (seat: number) => { for (let r = opening.rounds.length - 1; r >= 0; r--) { const roll = opening.rounds[r]?.[seat]; if (roll != null) return roll; } return 0; };
  const order = seats.map((_, seat) => seat).sort((a, b) => latest(b) - latest(a) || a - b);
  if (!seats[opening.winnerSeat]?.eliminated) return opening.winnerSeat;
  return order.find(seat => !seats[seat]?.eliminated) ?? opening.winnerSeat;
}

/** Nothing has been played before the choice, so the opening hands can be counted again for the seat that now goes first. */
function startWithSeat(state: RemoteState, seat: number): void {
  state.turnSeat = seat; state.startedSeats = [seat];
  for (const s of state.seats) { delete s.handCount; delete s.deckCount; }
  initializeRemoteHandCounts(state);
}

/** Writes the roll into a fresh state (table start, and every replay of the table.started event). */
export function applyRemoteOpening(state: RemoteState, opening: RemoteOpening): void {
  state.match.opening = structuredClone(opening);
  if (opening.chosenSeat !== undefined) startWithSeat(state, opening.chosenSeat);
}

function chooseRemoteOpening(state: RemoteState, seat: number): RemoteState {
  state.match.opening!.chosenSeat = seat;
  startWithSeat(state, seat);
  return state;
}

export function remoteSideTimeoutDue(state: Pick<RemoteState, "match" | "seatCount">, at: number): boolean {
  if (remoteOpeningPending(state.match)) return at >= state.match.opening.deadline;
  const siding = state.match?.phase === "siding" ? state.match.siding : undefined;
  return !!siding && (at >= siding.deadline ||
    siding.firstChoiceDeadline !== undefined && at >= siding.firstChoiceDeadline ||
    siding.startAt !== undefined && at >= siding.startAt ||
    Array.from({ length: state.seatCount }, (_, seat) => seat).some(seat => !siding.ready.includes(seat) && at >= remoteSideDeadline(siding, seat)));
}

/** Same cards and section sizes as the simulator's side-deck model. Deck Master stays fixed. */
export function validateRemoteSideChange(before: DuelDeck, after: DuelDeck): void {
  remoteAssert(after.main.length >= 40 && after.main.length <= 60 && after.extra.length <= 15 && after.side.length <= 15,
    "Main deck must have 40–60 cards; Extra and Side decks at most 15", 409, "DECK_INVALID");
  remoteAssert((["main", "extra", "side"] as const).every(section => before[section].length === after[section].length),
    "Each deck section must keep the same number of cards", 409, "DECK_INVALID");
  const counts = (deck: DuelDeck) => {
    const result = new Map<number, number>();
    for (const code of [...deck.main, ...deck.extra, ...deck.side]) result.set(code, (result.get(code) ?? 0) + 1);
    return result;
  };
  const left = counts(before), right = counts(after);
  remoteAssert(before.deckMaster === after.deckMaster && left.size === right.size && [...left].every(([code, n]) => right.get(code) === n),
    "A sided deck must use the same cards", 409, "DECK_INVALID");
}

/** Match flow 2: a seat that left while the others were already ready starts the countdown (or cancels it). */
export function syncRemoteSideStart(state: RemoteState, at: number): void {
  const siding = state.match.siding;
  if (!siding) return;
  if (state.seats.every(s => siding.ready.includes(s.seat))) siding.startAt ??= Math.min(siding.deadline, at + REMOTE_SIDE_START_MS);
  else delete siding.startAt;
}

function advance(state: RemoteState, at: number, initialState: GameModule["initialState"], legacyReplay: boolean, countdown: boolean): RemoteState {
  const match = state.match, siding = match.siding!;
  const allReady = state.seats.every(s => siding.ready.includes(s.seat));
  let startDue: boolean;
  if (countdown) {
    // Everyone ready starts a short visible countdown. Un-ready or a side change removes it. The chooser may still pick during it.
    delete siding.firstChoiceDeadline;
    if (allReady) siding.startAt ??= Math.min(siding.deadline, at + REMOTE_SIDE_START_MS); else delete siding.startAt;
    startDue = allReady && siding.startAt !== undefined && at >= siding.startAt;
  } else {
    if (!legacyReplay && allReady && match.firstSeat === undefined) siding.firstChoiceDeadline ??= Math.min(siding.deadline, at + REMOTE_FIRST_CHOICE_MS);
    else delete siding.firstChoiceDeadline;
    const choiceDue = siding.firstChoiceDeadline !== undefined && at >= siding.firstChoiceDeadline;
    startDue = allReady && (match.firstSeat !== undefined || choiceDue);
  }
  if (at < siding.deadline && !startDue) return state;
  const chosen = match.firstSeat ?? match.firstChooser ?? 0;
  const firstSeat = state.seats[chosen].accountDeleted ? state.seats.find(s=>!s.accountDeleted)!.seat : chosen;
  const next = initialState({ seatCount: state.seatCount, firstSeat, bestOf: match.bestOf, tournament: state.tournament });
  next.match = match; next.match.phase = "duel";
  delete next.match.siding; delete next.match.firstChooser; delete next.match.firstSeat; delete next.match.opening;
  next.deckChecks = initialDeckChecks(structuredClone(state.deckChecks.format));
  next.deckChecks.registrations = structuredClone(state.deckChecks.registrations);
  for (const seat of next.seats) {
    seat.resources.lp = state.deckChecks.format.settings.startingLP;
    if (state.seats[seat.seat].accountDeleted) { seat.accountDeleted = true; seat.eliminated = true; }
  }
  next.showCardsSetFromDeck = state.showCardsSetFromDeck;
  next.revealedHand = state.revealedHand;
  next.detection = structuredClone(state.detection ?? {});
  next.updatedAt = at;
  return next;
}

/** Called before game-end/elimination guards: a losing seat must still be able to side and choose. */
export function reduceRemoteMatch(state: RemoteState, input: RemoteAction, initialState: GameModule["initialState"], context?: RemoteReductionContext): RemoteState | null {
  if (!input.type.startsWith("match.") && !input.type.startsWith("side.")) return null;
  const parsed = remoteMatchActionSchema.safeParse(input);
  remoteAssert(parsed.success, "Invalid match action");
  const action = parsed.data, at = action.at ?? state.updatedAt;
  const legacyReplay = !!context?.replay && !context.matchFlowVersion;
  const countdown = context?.matchFlowVersion === 2;
  if (action.type === "side.timeout" && !remoteSideTimeoutDue(state, at)) return state;
  const next = cloneRemoteCurrent(state);
  next.updatedAt = at;
  if (legacyReplay) { next.undo = null; delete next.undoHistory; }
  const match = next.match;
  const validSeat = (seat: number) => remoteAssert(next.seats[seat], "Invalid match seat");
  if (!legacyReplay && (action.type === "match.declare" || action.type === "match.confirm")) {
    remoteAssert(!next.seats[action.actorSeat].eliminated, "Actor seat is eliminated", 403);
  }
  if (action.type === "match.declare") {
    remoteAssert(match.phase === "duel" && !next.ended && !match.pendingResult, "A result declaration is already pending or the game has ended", 409);
    if (action.winnerSeat !== null) { validSeat(action.winnerSeat); remoteAssert(!next.seats[action.winnerSeat].eliminated, "Winner seat is eliminated", 409); }
    match.pendingResult = { id: action.idempotencyKey, winnerSeat: action.winnerSeat, confirmed: [action.actorSeat] };
    return next;
  }
  if (action.type === "match.confirm") {
    const pending = match.pendingResult;
    remoteAssert(match.phase === "duel" && pending?.id === action.declarationId, "Result declaration is no longer pending", 409);
    if (pending.lpSeat !== undefined) {
      remoteAssert(action.actorSeat === pending.lpSeat, "Only the LP seat owner can confirm or reject this declaration", 403);
      delete match.pendingResult;
      if (!action.accept) return next;
      const loser = next.seats[pending.lpSeat];
      remoteAssert(!loser.eliminated && loser.resources.lp === 0, "LP declaration is no longer valid", 409);
      loser.eliminated = true; loser.twin = [];
      if (next.attack && [next.attack.attackerSeat, next.attack.targetSeat].includes(loser.seat)) next.attack = null;
      const living = next.seats.filter(s => !s.eliminated);
      if (living.length <= 1) finishRemoteGame(next, living[0]?.seat ?? null, "lp", at);
      return next;
    }
    remoteAssert(!pending.confirmed.includes(action.actorSeat), "Seat already confirmed this declaration", 409);
    if (!action.accept) { delete match.pendingResult; return next; }
    pending.confirmed.push(action.actorSeat);
    const confirmed = legacyReplay ? pending.confirmed.length === next.seatCount : next.seats.every(s => s.eliminated || pending.confirmed.includes(s.seat));
    if (confirmed) finishRemoteGame(next, pending.winnerSeat, "declared", at);
    return next;
  }
  if (remoteOpeningPending(match)) {
    const opening = match.opening;
    const chooser = remoteOpeningChooser(opening, next.seats);
    if (action.type === "side.timeout") return chooseRemoteOpening(next, chooser);
    if (action.type === "match.first") {
      remoteAssert(chooser === action.actorSeat, "Only the die-roll winner can choose the first player", 403);
      validSeat(action.seatGoesFirst);
      remoteAssert(!next.seats[action.seatGoesFirst].eliminated, "That seat is out of the game", 409);
      remoteAssert(at < opening.deadline, "The choice deadline has elapsed", 409);
      return chooseRemoteOpening(next, action.seatGoesFirst);
    }
  }
  // Entering siding closes this game's undo window. Declarations keep it intact.
  next.undo = null; delete next.undoHistory;
  if (action.type === "match.continue") {
    remoteAssert(match.phase === "result", "Continue requires a nonfinal game result", 409);
    const extendedFor = next.seats.filter(s => !!next.deckChecks.registrations[s.seat]).map(s => s.seat);
    match.phase = "siding";
    const seatDeadlines = Object.fromEntries(next.seats.map(s => [s.seat, at + (extendedFor.includes(s.seat) ? REMOTE_SIDE_DECK_MS : REMOTE_SIDE_MS)]));
    match.siding = { deadline: Math.max(...Object.values(seatDeadlines)), seatDeadlines, ready: next.seats.filter(s=>s.accountDeleted).map(s=>s.seat), extendedFor };
    return next;
  }
  remoteAssert(match.phase === "siding" && match.siding, "Side decking is only available during siding", 409);
  const siding = match.siding;
  if (action.type === "side.timeout") {
    for (const seat of next.seats) if (at >= remoteSideDeadline(siding, seat.seat) && !siding.ready.includes(seat.seat)) siding.ready.push(seat.seat);
    return advance(next, at, initialState, legacyReplay, countdown);
  }
  remoteAssert(at < Math.min(siding.firstChoiceDeadline ?? Infinity, siding.startAt ?? Infinity,
    action.type === "match.first" ? siding.deadline : remoteSideDeadline(siding, action.actorSeat)), "Your siding deadline has elapsed", 409);
  switch (action.type) {
    case "match.first":
      remoteAssert(match.firstChooser === action.actorSeat, "Only the previous loser can choose the first player", 403);
      validSeat(action.seatGoesFirst);
      remoteAssert(!next.seats[action.seatGoesFirst].accountDeleted, "That seat has left the match", 409);
      match.firstSeat = action.seatGoesFirst; break;
    case "side.ready": case "side.unready":
      remoteAssert(action.seat === action.actorSeat, "Only your own seat can change Ready", 403);
      siding.ready = siding.ready.filter(seat => seat !== action.seat);
      if (action.type === "side.ready") siding.ready.push(action.seat);
      if (action.type === "side.ready") for (const botSeat of context?.soloBotSeats ?? []) {
        if (!siding.ready.includes(botSeat)) siding.ready.push(botSeat);
      }
      break;
    case "side.swap": {
      const registration = next.deckChecks.registrations[action.actorSeat];
      remoteAssert(registration, "Select an attached deck before side decking", 409);
      const deck = { ...registration.deck, ...action.deckChanges };
      validateRemoteSideChange(registration.deck, deck);
      for (const section of ["main", "extra"] as const) for (const code of deck[section]) {
        const fact = context?.facts?.[code];
        remoteAssert(!fact || fact.section === section, "Card is in the wrong main or extra deck section", 409, "DECK_INVALID");
      }
      registration.deck = structuredClone(deck);
      if (context?.registration) registration.validation = structuredClone(context.registration.validation);
      siding.ready = siding.ready.filter(seat => seat !== action.actorSeat);
      break;
    }
  }
  return advance(next, at, initialState, legacyReplay, countdown);
}
