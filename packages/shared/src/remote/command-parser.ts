import { parseRemoteHandCommand, searchCandidates } from "./search-candidates.js";
import { remoteUndoHistory } from "./undo.js";
import { remoteActionSchema, type RemoteActionProposal } from "./actions.js";
import type { GameModule } from "./types.js";
import { parsePhaseCommand } from "./phases.js";

const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const zones: Record<string, string> = { monster: "monster", "extra monster": "extra-monster", "spell trap": "spell-trap", field: "field", graveyard: "graveyard", banished: "banished" };

/** Small explicit speech grammar. Produces proposals only; the reducer remains authoritative. */
export const parseRemoteCommand: GameModule["parseCommand"] = ({ text, actorSeat, state }) => {
  const seat = state.seats.find(s => s.seat === actorSeat);
  if (!seat || text.length > 500) return null;
  const raw = text.trim().replace(/[.!?]+$/, ""); const words = fold(raw);
  const searches = state.effectTracking?.origins.filter(o => o.seat === actorSeat && o.destination === 'hand') ?? [];
  const hand = parseRemoteHandCommand({text, actorSeat, candidates: searches.flatMap(o => searchCandidates(state, actorSeat, o.source.cardId))});
  if (hand) return hand;
  let proposal: RemoteActionProposal | null = null;
  const draw=words.match(/^(?:i )?draw(?: (\d+)(?: cards?)?)?$/);
  if(draw) return {type:'hand.draw',actorSeat,count:Number(draw[1]??1)};
  const phase = parsePhaseCommand(text, state);
  if (phase?.kind === "undo") {
    const entry = remoteUndoHistory(state, actorSeat)[0];
    if (entry && !entry.reason) proposal = { type: "undo", actorSeat, targetActionId: entry.actionId };
  }
  if (phase?.kind === "phase") proposal = { type: "phase.set", actorSeat, phase: phase.phase };
  if (phase?.kind === "turn") proposal = { type: "turn.end", actorSeat };
  // A recognized table command must not fall through into the card-edit grammar.
  if (phase) return proposal;
  if (words === "next phase") proposal = { type: "phase.advance", actorSeat };
  if (words === "concede") proposal = { type: "player.concede", actorSeat };
  const lp = words.match(/^(lose|gain|set lp to) (\d+)(?: lp| life points)?$/);
  if (lp) {
    const amount = Number(lp[2]);
    const delta = lp[1] === "set lp to" ? amount - seat.resources.lp : amount * (lp[1] === "lose" ? -1 : 1);
    proposal = { type: "lp.change", actorSeat, seat: actorSeat, delta, reason: "Voice adjustment" };
  }
  if (words === "resolve attack" || words === "cancel attack") {
    if (state.attack) proposal = { type: "attack.resolve", actorSeat, attackId: state.attack.id, outcome: words === "resolve attack" ? "resolved" : "cancelled" };
  }
  const activate = raw.match(/^(?:I\s+)?activate(?:\s+(.+))?$/i);
  if (activate) {
    const query = activate[1]?.replace(/^(?:the )?effect (?:of )?/i, "").trim();
    const cards = query ? seat.twin.filter(c=>fold(c.name ?? "")===fold(query) || fold(c.ref)===fold(query)) : [];
    const identified = !query && state.identified?.seat===actorSeat ? state.identified : undefined;
    const card = cards.length===1 ? cards[0] : undefined;
    const code=card?.cardId ?? card?.passcode ?? identified?.cardId ?? identified?.passcode;
    proposal = {type:"effect.activated",actorSeat,source:{...(code ? {cardId:code} : {}), ...(card ? {cardRef:card.ref} : {}), ...(query ? {name:query} : {})}};
  }
  const identified = words.match(/^identify (\d{1,10})$/);
  if (identified) proposal = { type: "card.identified", actorSeat, seat: actorSeat, cardId: Number(identified[1]), source: "voice" };
  if (/^note /i.test(raw)) proposal = { type: "log.note", actorSeat, text: raw.slice(5).trim() };
  const place = raw.match(/^(?:place|add|summon) (.+?) (?:in|to) (extra[- ]monster|monster|spell[- /]trap|field|graveyard|banished)(?: (?:slot|zone) ([1-5]))?$/i);
  if (place) {
    let n = 1; while (seat.twin.some(c => c.ref === `voice-${actorSeat}-${n}`)) n++;
    proposal = { type: "twin.place", actorSeat, seat: actorSeat, zone: zones[fold(place[2])], card: {
      ref: `voice-${actorSeat}-${n}`, name: place[1].trim(), faceUp: true, position: "attack", ...(place[3] ? { slot: Number(place[3]) } : {}),
    } };
  }
  // "detach" / "detach a material" / "detach material from <Xyz name>": the bottom material of the only (or the named) Xyz with materials.
  const detach = words.match(/^detach(?: (?:a|one|the))?(?: material)?(?: (?:from|of) (.+))?$/);
  if (detach) {
    const holders = seat.twin.filter(c => c.materials?.length && (!detach[1] || fold(c.name ?? "") === detach[1] || fold(c.ref) === detach[1]));
    if (holders.length !== 1) return null;
    proposal = { type: "twin.detach", actorSeat, seat: actorSeat, cardRef: holders[0].ref, materialRef: holders[0].materials![0], zone: "graveyard" };
  }
  const edit = raw.match(/^(flip|move|remove) (.+?)(?: face (up|down)| to (extra[- ]monster|monster|spell[- /]trap|field|graveyard|banished)(?: (?:slot|zone) ([1-5]))?)?$/i);
  if (edit) {
    const query = fold(edit[2]); const slot = query.match(/^(?:slot|zone) ([1-5])$/);
    const cards = seat.twin.filter(c => slot ? c.slot === Number(slot[1]) : fold(c.ref) === query || fold(c.name ?? "") === query);
    if (cards.length !== 1) return null;
    const cardRef = cards[0].ref;
    if (edit[1].toLowerCase() === "remove") proposal = { type: "twin.remove", actorSeat, seat: actorSeat, cardRef };
    if (edit[1].toLowerCase() === "flip" && edit[3]) proposal = { type: "twin.flip", actorSeat, seat: actorSeat, cardRef, faceUp: edit[3].toLowerCase() === "up" };
    if (edit[1].toLowerCase() === "move" && edit[4]) proposal = { type: "twin.move", actorSeat, seat: actorSeat, cardRef, zone: zones[fold(edit[4])], ...(edit[5] ? { slot: Number(edit[5]) } : {}) };
  }
  return proposal && remoteActionSchema.safeParse({ ...proposal, idempotencyKey: "proposal" }).success ? proposal : null;
};
