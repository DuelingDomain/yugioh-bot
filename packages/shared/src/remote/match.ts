import type { DuelDeck } from "../duels/index.js";
import { remoteAssert, type RemoteAction } from "./actions.js";
import { initialDeckChecks, type RemoteReductionContext } from "./deck-checks.js";
import { REMOTE_FIRST_CHOICE_MS, REMOTE_SIDE_DECK_MS, REMOTE_SIDE_MS, remoteBestOfSchema, remoteMatchActionSchema,
  type RemoteGameResult, type RemoteMatch, type RemoteSiding } from "./match-contract.js";
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
    match.firstChooser = winnerSeat === null ? null : (winnerSeat + 1) % state.seatCount;
    if (winnerSeat === null) match.firstSeat = state.startedSeats[0] ?? 0;
    else delete match.firstSeat;
  }
}

export function remoteSideDeadline(siding: RemoteSiding, seat: number): number {
  return siding.seatDeadlines?.[seat] ?? siding.deadline - (siding.extendedFor.length && !siding.extendedFor.includes(seat) ? REMOTE_SIDE_DECK_MS - REMOTE_SIDE_MS : 0);
}

export function remoteSideTimeoutDue(state: Pick<RemoteState, "match" | "seatCount">, at: number): boolean {
  const siding = state.match?.phase === "siding" ? state.match.siding : undefined;
  return !!siding && (at >= siding.deadline ||
    siding.firstChoiceDeadline !== undefined && at >= siding.firstChoiceDeadline ||
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

function advance(state: RemoteState, at: number, initialState: GameModule["initialState"], legacyReplay: boolean): RemoteState {
  const match = state.match, siding = match.siding!;
  const allReady = state.seats.every(s => siding.ready.includes(s.seat));
  if (!legacyReplay && allReady && match.firstSeat === undefined) siding.firstChoiceDeadline ??= Math.min(siding.deadline, at + REMOTE_FIRST_CHOICE_MS);
  else delete siding.firstChoiceDeadline;
  const choiceDue = siding.firstChoiceDeadline !== undefined && at >= siding.firstChoiceDeadline;
  if (at < siding.deadline && !(allReady && (match.firstSeat !== undefined || choiceDue))) return state;
  const firstSeat = match.firstSeat ?? match.firstChooser ?? 0;
  const next = initialState({ seatCount: state.seatCount, firstSeat, bestOf: match.bestOf });
  next.match = match; next.match.phase = "duel";
  delete next.match.siding; delete next.match.firstChooser; delete next.match.firstSeat;
  next.deckChecks = initialDeckChecks(structuredClone(state.deckChecks.format));
  next.deckChecks.registrations = structuredClone(state.deckChecks.registrations);
  for (const seat of next.seats) seat.resources.lp = state.deckChecks.format.settings.startingLP;
  next.showCardsSetFromDeck = state.showCardsSetFromDeck;
  next.revealedHand = state.revealedHand;
  next.updatedAt = at;
  return next;
}

/** Called before game-end/elimination guards: a losing seat must still be able to side and choose. */
export function reduceRemoteMatch(state: RemoteState, input: RemoteAction, initialState: GameModule["initialState"], context?: RemoteReductionContext): RemoteState | null {
  if (!input.type.startsWith("match.") && !input.type.startsWith("side.")) return null;
  const parsed = remoteMatchActionSchema.safeParse(input);
  remoteAssert(parsed.success, "Invalid match action");
  const action = parsed.data, at = action.at ?? state.updatedAt;
  const legacyReplay = !!context?.replay && context.matchFlowVersion !== 1;
  if (action.type === "side.timeout" && !remoteSideTimeoutDue(state, at)) return state;
  const next = structuredClone(state);
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
    remoteAssert(!pending.confirmed.includes(action.actorSeat), "Seat already confirmed this declaration", 409);
    if (!action.accept) { delete match.pendingResult; return next; }
    pending.confirmed.push(action.actorSeat);
    const confirmed = legacyReplay ? pending.confirmed.length === next.seatCount : next.seats.every(s => s.eliminated || pending.confirmed.includes(s.seat));
    if (confirmed) finishRemoteGame(next, pending.winnerSeat, "declared", at);
    return next;
  }
  // Entering siding closes this game's undo window. Declarations keep it intact.
  next.undo = null; delete next.undoHistory;
  if (action.type === "match.continue") {
    remoteAssert(match.phase === "result", "Continue requires a nonfinal game result", 409);
    const extendedFor = next.seats.filter(s => !!next.deckChecks.registrations[s.seat]).map(s => s.seat);
    match.phase = "siding";
    const seatDeadlines = Object.fromEntries(next.seats.map(s => [s.seat, at + (extendedFor.includes(s.seat) ? REMOTE_SIDE_DECK_MS : REMOTE_SIDE_MS)]));
    match.siding = { deadline: Math.max(...Object.values(seatDeadlines)), seatDeadlines, ready: [], extendedFor };
    return next;
  }
  remoteAssert(match.phase === "siding" && match.siding, "Side decking is only available during siding", 409);
  const siding = match.siding;
  if (action.type === "side.timeout") {
    for (const seat of next.seats) if (at >= remoteSideDeadline(siding, seat.seat) && !siding.ready.includes(seat.seat)) siding.ready.push(seat.seat);
    return advance(next, at, initialState, legacyReplay);
  }
  remoteAssert(at < Math.min(siding.firstChoiceDeadline ?? Infinity,
    action.type === "match.first" ? siding.deadline : remoteSideDeadline(siding, action.actorSeat)), "Your siding deadline has elapsed", 409);
  switch (action.type) {
    case "match.first":
      remoteAssert(match.firstChooser === action.actorSeat, "Only the previous loser can choose the first player", 403);
      validSeat(action.seatGoesFirst); match.firstSeat = action.seatGoesFirst; break;
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
  return advance(next, at, initialState, legacyReplay);
}
