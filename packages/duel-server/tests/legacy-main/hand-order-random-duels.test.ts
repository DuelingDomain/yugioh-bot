// MAIN'S TEST, run against the legacy 1v1 engine (src/legacy). A copy of packages/duel-server/tests/hand-order-random-duels.test.ts from origin/main (09b4196a)
// with only the import paths changed. Do not edit it to make the legacy engine pass: the legacy engine must match the approved legacy pin. See legacy-1v1/README.md.
import { describe, expect, it, vi } from "vitest";
import { OcgLocation as L, OcgMessageType as M, type OcgCoreSync, type OcgMessage } from "ocgcore-wasm";
import type { DuelAnswer, DuelEngineView, DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../../src/legacy/engine.js";
import { HandIdentities } from "../../src/hand-identities.js";
import { choosePracticeBotAnswer } from "../../src/practice-bot.js";
import { engineDataDirectory } from "../engine-data-dir.js";

// Observe the actual cores, including Domain's custom wasm; no query or message is fabricated.
const observed = vi.hoisted(() => ({
  hands: new Map<number, Array<number | undefined>>(),
  messages: [] as OcgMessage[],
}));
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (options: Parameters<typeof actual.default>[0]) => {
    const core = await actual.default(options) as OcgCoreSync;
    const query = core.duelQueryLocation.bind(core);
    core.duelQueryLocation = (handle, request) => {
      const result = query(handle, request);
      if (request.location === actual.OcgLocation.HAND) observed.hands.set(request.controller, result.map((card) => card?.code));
      return result;
    };
    const getMessages = core.duelGetMessage.bind(core);
    core.duelGetMessage = (handle) => {
      const messages = getMessages(handle);
      observed.messages.push(...messages);
      return messages;
    };
    return core;
  } };
});

const C = {
  exchange: 5556668, confiscation: 17375316, rota: 32807846, jar: 33508719,
  tradeIn: 38120068, duo: 44763025, destruction: 72892473, dealings: 74117290,
  handDestruction: 74519184, sarcophagus: 75500286, charity: 79571449,
  mallet: 85852291, duality: 98645731,
  warrior: 91152256, dragon: 89631139, raider: 48305365,
} as const;
const profiles = [
  { name: "disruption", cards: [C.exchange, C.confiscation, C.duo, C.charity, C.handDestruction, C.dealings, C.destruction] },
  { name: "search and recycle", cards: [C.sarcophagus, C.rota, C.duality, C.tradeIn, C.mallet, C.jar] },
] as const;

function checkEffectActivity(targets: readonly number[]) {
  const chain = new Map<number, number>();
  const effects = new Map<number, { draws: number; departures: number; arrivals: number; transfers: number; shuffles: number; banished: number; resolved: boolean }>();
  let resolving: number | undefined;
  for (const message of observed.messages) {
    if (message.type === M.CHAINING) chain.set(message.chain_size, message.code);
    if (message.type === M.CHAIN_SOLVING) {
      resolving = chain.get(message.chain_size);
      if (resolving != null && !effects.has(resolving)) effects.set(resolving, { draws: 0, departures: 0, arrivals: 0, transfers: 0, shuffles: 0, banished: 0, resolved: false });
    }
    const effect = resolving != null ? effects.get(resolving) : undefined;
    if (effect) {
      if (message.type === M.DRAW) effect.draws += message.drawn.length;
      if (message.type === M.SHUFFLE_HAND) effect.shuffles++;
      if (message.type === M.MOVE) {
        if (message.from.location === L.HAND) effect.departures++;
        if (message.to.location === L.HAND) effect.arrivals++;
        if (message.to.location === L.REMOVED) effect.banished++;
        if (message.from.location === L.HAND && message.to.location === L.HAND && message.from.controller !== message.to.controller) effect.transfers++;
      }
      if (message.type === M.CHAIN_SOLVED) effect.resolved = true;
    }
    if (message.type === M.CHAIN_SOLVED || message.type === M.CHAIN_END) resolving = undefined;
  }
  for (const code of targets) {
    const effect = effects.get(code);
    expect(effect?.resolved, `card ${code} resolved in the actual core`).toBe(true);
    switch (code) {
      case C.exchange: expect(effect!.transfers).toBe(2); break;
      case C.confiscation: expect(effect!.departures).toBe(1); break;
      case C.duo: expect(effect!.departures).toBe(2); break;
      case C.charity: expect([effect!.draws, effect!.departures]).toEqual([3, 2]); break;
      case C.handDestruction: expect([effect!.draws, effect!.departures]).toEqual([4, 4]); break;
      case C.dealings: expect([effect!.draws, effect!.departures]).toEqual([2, 2]); break;
      case C.destruction:
        expect(effect!.departures).toBeGreaterThan(0);
        expect(effect!.draws).toBe(effect!.departures); break;
      case C.rota: expect(effect!.arrivals).toBe(1); break;
      case C.duality: expect([effect!.arrivals, effect!.shuffles]).toEqual([1, 1]); break;
      case C.sarcophagus: expect(effect!.banished).toBe(1); break;
      case C.tradeIn: expect(effect!.draws).toBe(2); break;
      case C.mallet:
        expect(effect!.departures).toBeGreaterThan(0);
        expect(effect!.draws).toBe(effect!.departures); break;
      case C.jar:
        expect(effect!.draws).toBe(10);
        expect(effect!.departures).toBeGreaterThan(0); break;
    }
  }
}

/** A small reproducible PRNG also varies legal action order and effect selections, not just the core seed. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function shuffled<T>(values: readonly T[], next: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

function checkHands(game: EngineGame, tracker: () => HandIdentities | undefined, label: string) {
  const views = [0, 1, null].map((viewer) => ({ viewer, view: game.view(viewer) }));
  const owners = views.slice(0, 2).map(({ viewer, view }) => view.seats[viewer!]!.hand);
  // Check the actual sleeve arrays too: projecting only queried slots would miss stale tail sleeves.
  const sleeves = Reflect.get(tracker()!, "sleeves") as Array<Array<{ id: string }>>;
  for (const seat of [0, 1]) {
    const raw = observed.hands.get(seat)!;
    expect(owners[seat]!.map((card) => card.code), `${label}: owner ${seat} engine order`).toEqual(raw);
    expect(sleeves[seat]!.length, `${label}: sleeve ${seat} length`).toBe(raw.length);
  }
  for (const { viewer, view } of views) {
    const ids = view.seats.flatMap((seat) => seat.hand.map((card) => card.handId));
    expect(ids.every((id) => typeof id === "string"), `${label}: viewer ${viewer} missing identity`).toBe(true);
    expect(new Set(ids).size, `${label}: viewer ${viewer} duplicate identities`).toBe(ids.length);
    for (const seat of view.seats) {
      const raw = observed.hands.get(seat.seat)!;
      expect(seat.hand.length, `${label}: viewer ${viewer} hand size`).toBe(raw.length);
      expect(seat.hand.map((card) => card.sequence), `${label}: engine coordinates`).toEqual(raw.map((_, index) => index));
      for (const card of seat.hand) {
        expect(card.handId).toMatch(seat.seat === viewer ? /^hand-/ : /^sleeve-/);
        if (card.code != null) expect(card.code, `${label}: visible card's engine code`).toBe(raw[card.sequence]);
      }
    }
    for (const event of view.events.filter((event) => event.kind === "move" && event.zone?.location === L.HAND)) {
      const seat = view.seats[event.zone!.controller]!;
      expect(event.handId, `${label}: arrival ${event.id} identity`).toBeDefined();
      if (event.handId!.startsWith("departed-")) {
        const tracked = Reflect.get(tracker()!, seat.seat === viewer ? "own" : "sleeves") as Array<Array<{ id: string; arrival?: number }>>;
        expect(tracked[seat.seat]!.some((entry) => {
          if (entry.arrival !== event.id) return false;
          const card = seat.hand.find((card) => card.handId === entry.id);
          return card && (card.code == null || event.card == null || card.code === event.card.code);
        }),
          `${label}: viewer ${viewer} departed arrival ${event.id} still in hand`).toBe(false);
        expect(event.handId).toBe(`departed-${event.id}`);
        expect(seat.hand.some((card) => card.handId === event.handId)).toBe(false);
        continue;
      }
      const card = seat.hand.find((card) => card.handId === event.handId);
      expect(card, `${label}: live arrival ${event.id} destination`).toBeDefined();
      if (seat.seat !== viewer) expect(event.handId, `${label}: private arrival leaked`).toMatch(/^sleeve-/);
      else expect(event.card, `${label}: owner arrival ${event.id} missing card code`).toBeDefined();
      // Anonymous sleeves do not reveal a private shuffle. Owners and currently visible cards
      // must resolve an arrival to its code, including after compaction and controller changes.
      if (event.card && (seat.seat === viewer || card!.code != null)) {
        expect(card!.code, `${label}: viewer ${viewer} arrival ${event.id} (${event.card.name}) attached to seat ${seat.seat} slot ${card!.sequence} ${event.handId}`).toBe(event.card.code);
      }
    }
  }
  return views[0]!.view;
}

function choose(prompt: DuelPrompt, view: DuelEngineView, targets: readonly number[], resolved: Set<number>, next: () => number): DuelAnswer {
  const action = prompt.context?.type === "action";
  if (action) {
    if (prompt.seat === 0) {
      // Keep Jar outside the hand before any recycling effect; turn three then flips it normally.
      const jar = prompt.options.find((option) => option.card?.code === C.jar &&
        (option.id.startsWith("mset:") || (view.turn >= 3 && !resolved.has(C.jar) && option.id.startsWith("pos:"))));
      if (jar) return { choice: jar.id };
      const pending = targets.filter((code) => code !== C.jar && !resolved.has(code));
      const candidates = prompt.options.filter((option) => option.id.startsWith("activate:") && pending.includes(option.card?.code ?? 0));
      // These effects replace/return the remaining hand, so exhaust the other coverage cards first.
      const ordinary = candidates.filter((option) => option.card?.code !== C.destruction && option.card?.code !== C.mallet);
      const legal = ordinary.length > 0 ? ordinary : candidates;
      if (legal.length > 0) return { choice: legal[Math.floor(next() * legal.length)]!.id };
    }
    const end = prompt.options.find((option) => option.id === "to_ep");
    if (end) return { choice: end.id };
  }
  if (prompt.kind === "cards") {
    const min = prompt.min ?? 0;
    if (min === 0 && prompt.cancelable) return { cancel: true };
    const candidates = shuffled(prompt.options, next);
    const preserve = (option: DuelPromptOption) => targets.includes(option.card?.code ?? 0) && !resolved.has(option.card!.code);
    // Choose filler cards for costs, discards and Exchange so randomized play cannot destroy
    // unexercised effects. Trade-In's level-eight cost has only its engine-legal choices.
    candidates.sort((a, b) => Number(preserve(a)) - Number(preserve(b)));
    const max = Math.min(prompt.max ?? min, candidates.filter((option) => !preserve(option)).length);
    const count = Math.max(min, Math.min(max, min + Math.floor(next() * 3)));
    return { selected: candidates.slice(0, count).map((option) => option.id) };
  }
  return choosePracticeBotAnswer(prompt);
}

describe("seeded random real-duel hand identity invariants", () => {
  it.each(["normal", "domain"] as const)("%s: exercises hand-changing cards across two seeds", async (mode) => {
    let identityTracker: HandIdentities | undefined;
    const originalAt = HandIdentities.prototype.at;
    const spy = vi.spyOn(HandIdentities.prototype, "at").mockImplementation(function (this: HandIdentities, ...args) {
      identityTracker = this;
      return originalAt.apply(this, args);
    });
    try {
      for (const seed of [17, 91]) {
        for (const profile of profiles) {
          observed.hands.clear(); observed.messages.length = 0;
          const next = random(seed);
          const head = profile.name === "disruption"
            ? [...profile.cards, ...Array<number>(6).fill(C.warrior)]
            : [...profile.cards, C.dragon, C.warrior, C.raider];
          const count = mode === "domain" ? 60 : 40;
          const main = [...head, ...Array.from({ length: count - head.length }, (_, index) => [C.warrior, C.raider, C.dragon][index % 3]!)];
          const game = await createEngineGame({
            mode, dataDirectory: engineDataDirectory,
            seed: [seed, seed + 1, seed + 2, seed + 3].map(String),
            decks: [0, 1].map(() => ({ main, extra: [], side: [], deckMaster: C.raider })),
            settings: { visibility: "public", banlist: "none", cardPool: "both", turnSeconds: 240,
              startingLP: 8000, startingHand: head.length, drawPerTurn: 1, timeout: "loss", validateDeck: false, shuffleDeck: false },
          });
          const resolved = new Set<number>();
          let answers = 0;
          let view: DuelEngineView;
          try {
            view = checkHands(game, () => identityTracker, `${mode}/${seed}/${profile.name}/opening`);
            for (; answers < 120; answers++) {
              const returned = view.events.some((event) => event.zone?.location === L.HAND && event.from?.location === L.REMOVED);
              if (profile.cards.every((code) => resolved.has(code)) && (profile.name === "disruption" || returned)) break;
              const seat = view.prompt ? 0 : 1;
              const waiting = seat === 0 ? view : game.view(1);
              expect(waiting.prompt, `${mode}/${seed}/${profile.name}: no progressing prompt`).toBeTruthy();
              const answer = choose(waiting.prompt!, waiting, profile.cards, resolved, next);
              game.answer(seat, waiting.prompt!.id, answer);
              view = checkHands(game, () => identityTracker, `${mode}/${seed}/${profile.name}/answer ${answers + 1}`);
              for (const event of view.events) if (event.kind === "chain-resolved" && event.card) resolved.add(event.card.code);
            }
            expect(answers, `${mode}/${seed}/${profile.name}: bounded walk; unresolved ${profile.cards.filter((code) => !resolved.has(code)).join(",")}`).toBeLessThan(120);
            expect(answers, "real answers were exercised").toBeGreaterThan(10);
            expect(profile.cards.filter((code) => !resolved.has(code)), "every configured hand-changing effect resolved").toEqual([]);
            checkEffectActivity(profile.cards);
            expect(observed.messages.filter((message) => message.type === M.SHUFFLE_HAND).length, "real hidden permutations").toBeGreaterThan(0);
            expect(view.events.some((event) => event.from?.location === L.HAND), "real hand departures").toBe(true);
            expect(view.events.some((event) => event.handId?.startsWith("departed-")), "departed arrivals remain unresolvable").toBe(true);
            expect(view.events.filter((event) => event.zone?.location === L.HAND).length, "real hand arrivals").toBeGreaterThan(head.length * 2);
            if (profile.name === "disruption") {
              expect(observed.messages.some((message) => message.type === M.MOVE && message.from.location === L.HAND &&
                message.to.location === L.HAND && message.from.controller !== message.to.controller), "Exchange really changed hand control").toBe(true);
            } else {
              expect(view.events.some((event) => event.kind === "summon" && event.summonKind === "flip" && event.card?.code === C.jar), "Jar flipped through normal engine actions").toBe(true);
              expect(view.events.some((event) => event.addedToHand && event.from?.location === L.REMOVED), "Sarcophagus's delayed hand return").toBe(true);
            }
          } finally { game.close(); }
        }
      }
    } finally { spy.mockRestore(); }
  });
});
