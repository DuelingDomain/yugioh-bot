import { matchCardsByName } from "./attack-resolver.js";
import type { TwinCard } from "./actions.js";
import { remoteFieldZone } from "./twin-placement.js";
import type { GameModule } from "./types.js";

type CommandInput = Parameters<GameModule["parseCommand"]>[0];
const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const codeOf = (card: Pick<TwinCard, "cardId" | "passcode">) => card.cardId ?? card.passcode;

/** Whole effect commands only. Named sources must resolve against the speaker's own field. */
export function parseEffectCommand({ text, actorSeat, state, now = state.updatedAt, lookupCard }: CommandInput) {
  const field = state.seats.find(seat => seat.seat === actorSeat)?.twin.filter(card => remoteFieldZone(card.zone)) ?? [];
  const nameOf = (card: TwinCard) => card.name ?? (codeOf(card) ? lookupCard?.(codeOf(card)!)?.name : undefined);
  let raw = text.trim().replace(/[.!?]+$/, "").trim();
  // Strip leading fillers only, preserving field card names that begin with one.
  while (/^(?:um|uh|okay|so|alright|and)\b[\s,]*/i.test(raw)) {
    const words = fold(raw);
    if (field.some(card => { const name = fold(nameOf(card) ?? ""); return name && (words === name || words.startsWith(`${name} `)); })) break;
    raw = raw.replace(/^(?:um|uh|okay|so|alright|and)\b[\s,]*/i, "");
  }
  const bare = /^(?:(?:i\s+)?activate(?:\s+(?:the\s+)?effect)?|effect|(?:i\s+)?use\s+(?:the\s+)?effect)$/i.test(raw);
  const named = raw.match(/^(?:i\s+)?activate\s+(?:the\s+)?effect\s+of\s+(.+)$/i)
    ?? raw.match(/^(?:(?:i\s+)?(?:activate|use)\s+)?(.+?)(?:['’]s)?\s+effect$/i)
    ?? raw.match(/^(?:i\s+)?activate\s+(.+)$/i);
  if (!bare && !named) return null;

  let card: TwinCard | undefined;
  if (!bare) {
    const query = named![1].trim();
    let matches: { card: TwinCard; score: number }[] = [];
    for (const faceUp of [true, false]) {
      const candidates = field.filter(card => card.faceUp === faceUp);
      // Only this actor's known face-down names participate; attack matching keeps its public-only rule.
      matches = matchCardsByName(candidates.map(card => ({ ...card, faceUp: true })), query, nameOf, { keepFillers: true });
      const refs = candidates.filter(card => fold(card.ref) === fold(query));
      if (refs.length) matches = refs.map(card => ({ card, score: 1 }));
      if (matches.length) break;
    }
    // Unknown names are not evidence of a command: normal speech must not create an activation.
    if (!matches.length) return null;
    if (!matches[1] || matches[0].score > matches[1].score) card = matches[0].card;
  } else {
    const faceUp = field.filter(card => card.faceUp);
    // History carries the event time and survives unrelated LP/phase updates. Never date an identification by updatedAt.
    const recent = (state.undoHistory ?? []).filter(entry => !entry.undone && entry.actorSeat === actorSeat &&
      now >= entry.at && now - entry.at <= 20_000).sort((a, b) => b.order - a.order);
    for (const entry of recent) {
      const action = entry.action;
      if (!("seat" in action) || action.seat !== actorSeat) continue;
      const sights: { cardRef?: string; cardId?: number; passcode?: number; zone?: string }[] = action.type === "twin.place" ? [{ cardRef: action.fromRef ?? action.card.ref }] :
        action.type === "card.identified" ? [action] : action.type === "cards.identified" ? action.cards : [];
      let candidates = faceUp.filter(card => sights.some(sight => sight.cardRef ? sight.cardRef === card.ref :
        (!sight.zone || remoteFieldZone(sight.zone)) && !!codeOf(card) && codeOf(card) === (sight.cardId ?? sight.passcode)));
      if (action.type === "twin.place" && !action.fromRef && !candidates.length) {
        // The placement guard can retain an older physical ref. Undo records the refs actually changed.
        const touched = new Set(entry.cards.filter(ref => ref.startsWith(`${actorSeat}:`)).map(ref => ref.slice(`${actorSeat}:`.length)));
        const code = codeOf(action.card);
        candidates = faceUp.filter(card => touched.has(card.ref) && (code ? codeOf(card) === code :
          !!action.card.name && fold(nameOf(card) ?? "") === fold(action.card.name)));
      }
      if (!candidates.length) continue;
      if (candidates.length === 1) card = candidates[0];
      // A simultaneous read of several cards is a choice, never an arbitrary last card.
      return activation(card);
    }
    const typed = faceUp.map(card => ({ card, type: codeOf(card) ? lookupCard?.(codeOf(card)!)?.type : undefined }));
    if (typed.some(({ type }) => !type || /\bUnknown\b/i.test(type))) return activation();
    const effects = typed.filter(({ type }) => /\bEffect\b/i.test(type!)).map(({ card }) => card);
    if (effects.length === 1) card = effects[0];
  }
  return activation(card);

  function activation(card?: TwinCard): ReturnType<GameModule["parseCommand"]> {
    // An incomplete proposal is deliberate: the UI asks "Which card?" without sending an action.
    if (card && !codeOf(card) && !nameOf(card)) card = undefined;
    return { type: "effect.activated", actorSeat, source: card ? {
      cardRef: card.ref, ...(codeOf(card) ? { cardId: codeOf(card) } : {}), ...(nameOf(card) ? { name: nameOf(card) } : {}),
    } : {} };
  }
}
